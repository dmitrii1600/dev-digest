import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentVersionConfig, AgentVersionOrigin, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order + enabled flag), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
  enabled: boolean;
}

/** One `agent_skills` binding as stored. */
export interface AgentSkillBinding {
  skillId: string;
  order: number;
  enabled: boolean;
}

/** The slice of an eval run a promotion needs; `skills` is raw jsonb (the service parses it). */
export interface PromotionRun {
  agentVersion: number;
  skills: unknown;
}

/**
 * The primitives of one promotion transaction. Each is a single read or write with no policy;
 * the order they are called in, and every decision between them, belongs to the service.
 */
export interface PromotionTx {
  /** Workspace-scoped `SELECT … FOR UPDATE` on the agent. */
  lockAgent(workspaceId: string, agentId: string): Promise<AgentRow | undefined>;
  /**
   * The agent's OWN suite run. A skill run hosted on this agent also has `agent_id = agentId`,
   * but its skill set is `[skill]`, so `agent_id` alone is never matched.
   */
  findAgentSuiteRun(workspaceId: string, agentId: string, runId: string): Promise<PromotionRun | undefined>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined>;
  /** Which of `skillIds` still exist in the workspace. */
  existingSkillIds(workspaceId: string, skillIds: string[]): Promise<Set<string>>;
  currentLinks(agentId: string): Promise<AgentSkillBinding[]>;
  replaceLinks(agentId: string, links: AgentSkillBinding[]): Promise<void>;
  /** Write a snapshot's configuration onto the agent row at `version`. */
  applyConfig(workspaceId: string, agentId: string, config: AgentVersionConfig, version: number): Promise<AgentRow>;
  /** Plain insert of the new `agent_versions` row, with its origin. */
  insertVersion(
    agentId: string,
    version: number,
    config: AgentVersionConfig,
    skills: string[],
    origin: AgentVersionOrigin,
  ): Promise<void>;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function promotionTx(tx: Tx): PromotionTx {
  return {
    async lockAgent(workspaceId, agentId) {
      const [agent] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      return agent;
    },

    async findAgentSuiteRun(workspaceId, agentId, runId) {
      const [run] = await tx
        .select({ agentVersion: t.evalRuns.agentVersion, skills: t.evalRuns.skills })
        .from(t.evalRuns)
        .where(
          and(
            eq(t.evalRuns.workspaceId, workspaceId),
            eq(t.evalRuns.id, runId),
            eq(t.evalRuns.kind, 'suite'),
            eq(t.evalRuns.ownerKind, 'agent'),
            eq(t.evalRuns.ownerId, agentId),
          ),
        );
      return run;
    },

    async getVersion(agentId, version) {
      const [row] = await tx
        .select()
        .from(t.agentVersions)
        .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
      return row;
    },

    async existingSkillIds(workspaceId, skillIds) {
      if (skillIds.length === 0) return new Set();
      const rows = await tx
        .select({ id: t.skills.id })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
      return new Set(rows.map((r) => r.id));
    },

    async currentLinks(agentId) {
      return tx
        .select({ skillId: t.agentSkills.skillId, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agentId));
    },

    async replaceLinks(agentId, links) {
      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (links.length > 0) {
        await tx.insert(t.agentSkills).values(links.map((l) => ({ agentId, ...l })));
      }
    },

    async applyConfig(workspaceId, agentId, c, version) {
      const [updated] = await tx
        .update(t.agents)
        .set({
          provider: c.provider,
          model: c.model,
          systemPrompt: c.system_prompt,
          outputSchema: (c.output_schema as object | null | undefined) ?? null,
          strategy: c.strategy,
          ciFailOn: c.ci_fail_on,
          repoIntel: c.repo_intel,
          version,
        })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .returning();
      return updated!;
    },

    async insertVersion(agentId, version, c, skills, origin) {
      await tx.insert(t.agentVersions).values({
        agentId,
        version,
        configJson: {
          provider: c.provider,
          model: c.model,
          system_prompt: c.system_prompt,
          output_schema: c.output_schema ?? null,
          strategy: c.strategy,
          ci_fail_on: c.ci_fail_on,
          repo_intel: c.repo_intel,
          skills,
        },
        origin,
      });
    },
  };
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. The agent's eval
   *  cases carry no FK to it (`owner_id` is polymorphic), so they are deleted
   *  here in the same transaction; eval runs and their per-case rows go by FK
   *  cascade. Returns false if no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.evalCases)
        .where(
          and(
            eq(t.evalCases.workspaceId, workspaceId),
            eq(t.evalCases.ownerKind, 'agent'),
            eq(t.evalCases.ownerId, id),
          ),
        );
      const rows = await tx
        .delete(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .returning({ id: t.agents.id });
      return rows.length > 0;
    });
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  /**
   * Run `fn` inside ONE transaction and hand it the promotion primitives. The ordered checks and
   * the restore policy live in `AgentsService.promote`; this method only owns the unit of work.
   * The agent row is locked (`FOR UPDATE`) by `lockAgent`, so a concurrent edit or a double submit
   * waits and then sees the new version, and `insertVersion` is a plain insert — a primary-key
   * clash throws and rolls everything back instead of being swallowed. No primitive updates or
   * deletes an existing `agent_versions` or `eval_runs` row.
   */
  async inPromotionTx<T>(fn: (tx: PromotionTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(promotionTx(tx)));
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order, enabled: r.enabled }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(
    agentId: string,
    skillId: string,
    order: number,
    enabled = false,
  ): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order, enabled })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  /** Patch one binding's `enabled` and/or `order` without disturbing the rest. */
  async updateSkillLink(
    agentId: string,
    skillId: string,
    patch: { enabled?: boolean; order?: number },
  ): Promise<void> {
    await this.db
      .update(t.agentSkills)
      .set(patch)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   *
   * Preserves each skill's existing `enabled` flag across the reorder — a bulk
   * delete+insert would otherwise reset every binding to the column default and
   * silently wipe every checkbox the user had set. New ids default to disabled.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    const existing = await this.linkedSkills(agentId);
    const enabledById = new Map(existing.map((l) => [l.skill.id, l.enabled]));
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db.insert(t.agentSkills).values(
      skillIds.map((skillId, i) => ({
        agentId,
        skillId,
        order: i,
        enabled: enabledById.get(skillId) ?? false,
      })),
    );
  }
}
