import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import type { SkillStatsAgg } from './helpers.js';

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface SkillUsageRow {
  agentId: string;
  agentName: string;
  order: number;
  enabled: boolean;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A1 — skills data-access. Owns `skills`, `skill_versions`, and the SKILL side
 * of `agent_skills` (`modules/agents/repository.ts` owns the agent side — see
 * that file's header). Workspace-scoped throughout.
 */
export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions/agent-links cascade. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION, null);
    return row!;
  }

  /**
   * Update a skill. Only a `body` change bumps the version and snapshots
   * `skill_versions` — name/description/type and the `enabled` toggle do not.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    note?: string | null,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion, note ?? null);
    return row;
  }

  private async snapshotVersion(row: SkillRow, version: number, note: string | null): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body, note })
      .onConflictDoNothing();
  }

  // ---- skill_versions -------------------------------------------------

  /** All snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * Restore never rewinds history: it reads version `fromVersion`'s body and
   * writes it as a NEW version (existing.version + 1) with `note`.
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    fromVersion: number,
    note: string,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;
    const source = await this.getVersion(id, fromVersion);
    if (!source) return undefined;

    const nextVersion = existing.version + 1;
    const [row] = await this.db
      .update(t.skills)
      .set({ body: source.body, version: nextVersion })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    if (row) await this.snapshotVersion(row, nextVersion, note);
    return row;
  }

  // ---- agent_skills (skill side) ---------------------------------------

  /** Agents this skill is linked to, ordered by name. */
  async agentsUsing(skillId: string): Promise<SkillUsageRow[]> {
    return this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        order: t.agentSkills.order,
        enabled: t.agentSkills.enabled,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name));
  }

  /**
   * Skills enabled for prompt assembly on one agent — `skills.enabled AND
   * agent_skills.enabled`, ordered by `agent_skills.order`. This IS the prompt
   * path (run-executor calls it via `container.skillsRepo`); the agent editor's
   * unfiltered view is `AgentsRepository.linkedSkills`, which stays unfiltered
   * because it still needs to show disabled links.
   */
  async blocksForAgent(agentId: string): Promise<{ id: string; source: string; body: string }[]> {
    return this.db
      .select({ id: t.skills.id, source: t.skills.source, body: t.skills.body })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      )
      .orderBy(asc(t.agentSkills.order));
  }

  /**
   * Usage aggregates over the last 30 days. Attribution is AGENT-level (a
   * finding can't be proven to come from one skill among several attached to
   * the same agent) — every number here counts the runs/findings of the
   * agents this skill is linked to, regardless of the per-binding `enabled`
   * flag. The service/UI states this caveat.
   */
  async statsFor(skillId: string): Promise<SkillStatsAgg> {
    const links = await this.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    const agentIds = links.map((l) => l.agentId);

    if (agentIds.length === 0) {
      return { agents: 0, runs30d: 0, findings30d: 0, accepted: 0, dismissed: 0, byCategory: [] };
    }

    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const [runsRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.agentRuns)
      .where(and(inArray(t.agentRuns.agentId, agentIds), gte(t.agentRuns.ranAt, since)));

    const findingRows = await this.db
      .select({
        category: t.findings.category,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(inArray(t.reviews.agentId, agentIds), gte(t.reviews.createdAt, since)));

    const accepted = findingRows.filter((f) => f.acceptedAt !== null).length;
    const dismissed = findingRows.filter((f) => f.dismissedAt !== null).length;
    const byCategoryMap = new Map<string, number>();
    for (const f of findingRows) {
      byCategoryMap.set(f.category, (byCategoryMap.get(f.category) ?? 0) + 1);
    }

    return {
      agents: agentIds.length,
      runs30d: runsRow?.count ?? 0,
      findings30d: findingRows.length,
      accepted,
      dismissed,
      byCategory: [...byCategoryMap.entries()].map(([category, count]) => ({ category, count })),
    };
  }
}
