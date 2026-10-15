import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { CiInstallation, CiRun } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { RUNS_LIST_LIMIT } from './constants.js';
import type {
  CiAgentRow,
  CiExportMeta,
  CiRepoRow,
  CiSkillRow,
  CiStore,
  NewCiRun,
  StoredInstallation,
  UpsertInstallation,
} from './types.js';

type InstallationRow = typeof t.ciInstallations.$inferSelect;

/** Reads the untyped jsonb column; a row that does not look like an export record has no meta. */
function toMeta(raw: unknown): CiExportMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Partial<CiExportMeta>;
  const ok =
    Array.isArray(m.triggers) &&
    Array.isArray(m.skills) &&
    typeof m.post_as === 'string' &&
    typeof m.manifest_path === 'string' &&
    typeof m.model === 'string';
  return ok ? (m as CiExportMeta) : null;
}

function toStored(r: InstallationRow, agentName: string): StoredInstallation {
  const installation: CiInstallation = {
    id: r.id,
    agent_id: r.agentId,
    repo: r.repo,
    target_type: r.targetType,
    agent_version: r.agentVersion,
    installed_at: r.installedAt.toISOString(),
  };
  return {
    installation,
    githubRepoId: r.githubRepoId ?? null,
    meta: toMeta(r.exportMeta),
    agentName,
  };
}

/** Ring 3: every query the CI module runs. Reads of other tables are its own. */
export class CiRepository implements CiStore {
  constructor(private readonly db: Db) {}

  async getAgent(workspaceId: string, id: string): Promise<CiAgentRow | null> {
    const [r] = await this.db
      .select({
        id: t.agents.id,
        name: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
        systemPrompt: t.agents.systemPrompt,
        strategy: t.agents.strategy,
        ciFailOn: t.agents.ciFailOn,
        version: t.agents.version,
      })
      .from(t.agents)
      .where(and(eq(t.agents.id, id), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    return r ?? null;
  }

  /** `agent_skills.enabled AND skills.enabled`, in the agent's order (the prompt path's predicate). */
  async enabledSkills(agentId: string): Promise<CiSkillRow[]> {
    return this.db
      .select({ name: t.skills.name, source: t.skills.source, body: t.skills.body })
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

  async findRepo(workspaceId: string, fullName: string): Promise<CiRepoRow | null> {
    const [r] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, defaultBranch: t.repos.defaultBranch })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)))
      .limit(1);
    return r ?? null;
  }

  async getRepoById(workspaceId: string, id: string): Promise<CiRepoRow | null> {
    const [r] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, defaultBranch: t.repos.defaultBranch })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .limit(1);
    return r ?? null;
  }

  async repoMemory(workspaceId: string, repoId: string): Promise<{ kind: string; content: string }[]> {
    return this.db
      .select({ kind: t.memory.kind, content: t.memory.content })
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, workspaceId),
          eq(t.memory.repoId, repoId),
          eq(t.memory.scope, 'repo'),
        ),
      )
      .orderBy(asc(t.memory.createdAt));
  }

  async installationForRepo(workspaceId: string, fullName: string): Promise<StoredInstallation | null> {
    const [r] = await this.db
      .select({ inst: t.ciInstallations, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, fullName)))
      .orderBy(asc(t.ciInstallations.installedAt))
      .limit(1);
    return r ? toStored(r.inst, r.agentName) : null;
  }

  async listInstallations(workspaceId: string, agentId?: string): Promise<StoredInstallation[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          agentId ? eq(t.ciInstallations.agentId, agentId) : undefined,
        ),
      )
      .orderBy(asc(t.ciInstallations.installedAt));
    return rows.map((r) => toStored(r.inst, r.agentName));
  }

  /** One row per (agent, repo): updates it when present, never inserts a second. */
  async upsertInstallation(input: UpsertInstallation): Promise<StoredInstallation> {
    const [agent] = await this.db
      .select({ name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.id, input.agentId))
      .limit(1);
    const values = {
      agentVersion: input.agentVersion,
      exportMeta: input.exportMeta,
      ...(input.githubRepoId !== undefined ? { githubRepoId: input.githubRepoId } : {}),
    };
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId: input.agentId, repo: input.repo, targetType: 'gha', ...values })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: values,
      })
      .returning();
    return toStored(row!, agent?.name ?? '');
  }

  async setGithubRepoId(installationId: string, githubRepoId: number): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ githubRepoId })
      .where(eq(t.ciInstallations.id, installationId));
  }

  async knownRunIds(installationId: string): Promise<Set<number>> {
    const rows = await this.db
      .select({ id: t.ciRuns.githubRunId })
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId));
    return new Set(rows.flatMap((r) => (r.id == null ? [] : [r.id])));
  }

  /**
   * One transaction: the `ci_runs` row (unique on the GitHub run id), its
   * `agent_runs` row (`source='ci'`, `pr_id` NULL so CI stays out of the PR
   * rollups) and the trace. `false` when the run was already stored.
   */
  async recordRun(input: NewCiRun): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [ci] = await tx
        .insert(t.ciRuns)
        .values({
          ciInstallationId: input.installationId,
          prNumber: input.prNumber,
          ranAt: input.ranAt,
          status: input.status,
          findingsCount: input.findingsCount,
          costUsd: input.costUsd,
          githubUrl: input.githubUrl,
          source: 'ci',
          githubRunId: input.githubRunId,
          headSha: input.headSha,
          prTitle: input.prTitle,
          critical: input.critical,
          warning: input.warning,
          suggestion: input.suggestion,
        })
        .onConflictDoNothing({ target: t.ciRuns.githubRunId })
        .returning({ id: t.ciRuns.id });
      if (!ci) return false;
      const [run] = await tx
        .insert(t.agentRuns)
        .values({
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          prId: null,
          ranAt: input.ranAt,
          provider: input.provider,
          model: input.model,
          durationMs: input.durationMs,
          costUsd: input.costUsd,
          status: input.status === 'failed' ? 'failed' : 'done',
          error: input.error,
          source: 'ci',
          findingsCount: input.findingsCount,
          blockers: input.blockers,
        })
        .returning({ id: t.agentRuns.id });
      await tx.insert(t.runTraces).values({ runId: run!.id, trace: input.trace });
      await tx.update(t.ciRuns).set({ agentRunId: run!.id }).where(eq(t.ciRuns.id, ci.id));
      return true;
    });
  }

  async listRuns(
    workspaceId: string,
    filters: { agentId?: string; repo?: string },
  ): Promise<CiRun[]> {
    const rows = await this.db
      .select({
        run: t.ciRuns,
        repo: t.ciInstallations.repo,
        agentId: t.agents.id,
        agentName: t.agents.name,
        durationMs: t.agentRuns.durationMs,
        error: t.agentRuns.error,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .leftJoin(t.agentRuns, eq(t.ciRuns.agentRunId, t.agentRuns.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          filters.agentId ? eq(t.agents.id, filters.agentId) : undefined,
          filters.repo ? eq(t.ciInstallations.repo, filters.repo) : undefined,
        ),
      )
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`, desc(t.ciRuns.id))
      .limit(RUNS_LIST_LIMIT);
    return rows.map((r) => ({
      id: r.run.id,
      ci_installation_id: r.run.ciInstallationId,
      pr_number: r.run.prNumber,
      ran_at: r.run.ranAt ? r.run.ranAt.toISOString() : null,
      status: r.run.status,
      findings_count: r.run.findingsCount,
      cost_usd: r.run.costUsd,
      github_url: r.run.githubUrl,
      source: r.run.source,
      agent: r.agentName,
      duration_s: r.durationMs == null ? null : r.durationMs / 1000,
      repo: r.repo,
      pr_title: r.run.prTitle,
      head_sha: r.run.headSha,
      agent_id: r.agentId,
      critical: r.run.critical,
      warning: r.run.warning,
      suggestion: r.run.suggestion,
      failure_reason:
        r.error === 'result_rejected' || r.error === 'no_result' ? r.error : null,
    }));
  }
}
