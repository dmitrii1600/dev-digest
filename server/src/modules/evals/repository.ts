import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type {
  EvalCase,
  EvalCaseMeta,
  EvalCaseResult,
  EvalExpectedFinding,
  EvalRunCaseRef,
  EvalRunSkill,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseRow, EvalRunCaseRow, EvalRunRow } from '../../db/rows.js';
import type {
  AgentWithCases,
  CasePatch,
  EvalOwner,
  EvalsStore,
  FindingSource,
  InsertRunResult,
  LatestSingle,
  NewCase,
  NewCaseResult,
  NewFindingCase,
  NewRun,
  RunPatch,
} from './types.js';

// ---- row → contract --------------------------------------------------------

function caseRowToDto(r: EvalCaseRow): EvalCase {
  return {
    id: r.id,
    owner_kind: r.ownerKind,
    owner_id: r.ownerId,
    name: r.name,
    expectation: r.expectation,
    target: { file: r.targetFile, start_line: r.targetStartLine, end_line: r.targetEndLine },
    source: r.source,
    source_finding_id: r.sourceFindingId,
    fingerprint: r.fingerprint,
    input_diff: r.inputDiff ?? '',
    input_files: r.inputFiles,
    input_meta: (r.inputMeta ?? { pr_title: '', pr_body: '' }) as EvalCaseMeta,
    expected_output: (r.expectedOutput ?? {
      title: null,
      severity: null,
      category: null,
    }) as EvalExpectedFinding,
    notes: r.notes,
    created_at: r.createdAt.toISOString(),
  };
}

function runRowToDto(r: EvalRunRow): EvalSuiteRun {
  return {
    id: r.id,
    kind: r.kind,
    owner_kind: r.ownerKind,
    owner_id: r.ownerId,
    agent_id: r.agentId,
    agent_version: r.agentVersion,
    provider: r.provider,
    model: r.model,
    status: r.status,
    error: r.error,
    skills: r.skills as EvalRunSkill[],
    cases: r.caseRefs as EvalRunCaseRef[],
    cases_total: r.casesTotal,
    cases_passed: r.casesPassed,
    cases_errored: r.casesErrored,
    metrics: {
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citationAccuracy,
    },
    duration_ms: r.durationMs,
    cost_usd: r.costUsd,
    started_at: r.ranAt.toISOString(),
    finished_at: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

function resultRowToDto(r: EvalRunCaseRow): EvalCaseResult {
  return {
    case_id: r.caseId,
    case_name: r.caseName,
    expectation: r.expectation,
    target: { file: r.targetFile, start_line: r.targetStartLine, end_line: r.targetEndLine },
    fingerprint: r.fingerprint,
    status: r.status,
    error: r.error,
    produced: r.produced,
    kept: r.kept,
    matched: r.matched,
    findings: r.findings as EvalCaseResult['findings'],
    duration_ms: r.durationMs,
    cost_usd: r.costUsd,
  };
}

/** postgres-js sets `code`; newer drizzle wraps the driver error under `cause`. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

/**
 * Every agent-facing run read goes through this: workspace + `kind = 'suite'` + agent-owned.
 * A skill run hosted on agent H has `agent_id = H` but `owner_kind = 'skill'`, so it never
 * shows in H's history, tiles, trend, Compare, banner or the workspace dashboard.
 */
const AGENT_SUITE = (ws: string) =>
  and(eq(t.evalRuns.workspaceId, ws), eq(t.evalRuns.kind, 'suite'), eq(t.evalRuns.ownerKind, 'agent'));

/** The suite runs of one owner: `AGENT_SUITE` for an agent, the skill's own runs for a skill. */
const OWNER_SUITE = (ws: string, owner: EvalOwner) =>
  owner.kind === 'agent'
    ? and(AGENT_SUITE(ws), eq(t.evalRuns.ownerId, owner.id))
    : and(
        eq(t.evalRuns.workspaceId, ws),
        eq(t.evalRuns.kind, 'suite'),
        eq(t.evalRuns.ownerKind, 'skill'),
        eq(t.evalRuns.ownerId, owner.id),
      );

/** Evals persistence (ring 3). Every read and write is scoped by workspace. */
export class EvalsRepository implements EvalsStore {
  constructor(private readonly db: Db) {}

  // ---- source finding ------------------------------------------------------

  async findingSource(workspaceId: string, findingId: string): Promise<FindingSource | undefined> {
    const [row] = await this.db
      .select({
        finding: t.findings,
        agentId: t.reviews.agentId,
        pull: t.pullRequests,
        repoOwner: t.repos.owner,
        repoName: t.repos.name,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(
        and(
          eq(t.findings.id, findingId),
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.pullRequests.workspaceId, workspaceId),
        ),
      );
    if (!row) return undefined;
    return {
      finding: {
        id: row.finding.id,
        title: row.finding.title,
        severity: row.finding.severity,
        category: row.finding.category,
        file: row.finding.file,
        startLine: row.finding.startLine,
        endLine: row.finding.endLine,
        acceptedAt: row.finding.acceptedAt,
        dismissedAt: row.finding.dismissedAt,
      },
      agentId: row.agentId,
      pull: {
        id: row.pull.id,
        number: row.pull.number,
        title: row.pull.title,
        body: row.pull.body,
        base: row.pull.base,
        headSha: row.pull.headSha,
      },
      repo: { owner: row.repoOwner, name: row.repoName },
    };
  }

  async prFilePatch(prId: string, path: string): Promise<string | null> {
    const [row] = await this.db
      .select({ patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, path)));
    return row?.patch ?? null;
  }

  // ---- cases ---------------------------------------------------------------

  async countCases(workspaceId: string, owner: EvalOwner): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(this.ownedBy(workspaceId, owner));
    return row?.n ?? 0;
  }

  /** Insert, or report the case that already exists for this source finding (EC-2). */
  async insertCaseIfAbsent(row: NewFindingCase): Promise<{ case: EvalCase; created: boolean }> {
    const inserted = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: row.workspaceId,
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        name: row.name,
        inputDiff: row.inputDiff,
        inputMeta: row.inputMeta,
        expectedOutput: row.expectedOutput,
        source: 'finding',
        sourceFindingId: row.sourceFindingId,
        expectation: row.expectation,
        targetFile: row.target.file,
        targetStartLine: row.target.start_line,
        targetEndLine: row.target.end_line,
        fingerprint: row.fingerprint,
      })
      .onConflictDoNothing({ target: [t.evalCases.ownerId, t.evalCases.sourceFindingId] })
      .returning();
    if (inserted[0]) return { case: caseRowToDto(inserted[0]), created: true };

    const [existing] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, row.workspaceId),
          eq(t.evalCases.ownerId, row.ownerId),
          eq(t.evalCases.sourceFindingId, row.sourceFindingId),
        ),
      );
    // The conflicting row exists, so this only misses if it was deleted in between.
    if (!existing) throw new Error('eval case vanished after a conflicting insert');
    return { case: caseRowToDto(existing), created: false };
  }

  /** A hand-written case: `source: 'manual'`, no source finding (so the per-finding unique index is free). */
  async insertCase(row: NewCase): Promise<EvalCase> {
    const [inserted] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: row.workspaceId,
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        name: row.name,
        inputDiff: row.inputDiff,
        inputMeta: row.inputMeta,
        expectedOutput: row.expectedOutput,
        source: 'manual',
        sourceFindingId: null,
        expectation: row.expectation,
        targetFile: row.target.file,
        targetStartLine: row.target.start_line,
        targetEndLine: row.target.end_line,
        fingerprint: row.fingerprint,
      })
      .returning();
    return caseRowToDto(inserted!);
  }

  /**
   * Edit in place. Never touches `source`, `source_finding_id`, the owner or `expected_output`
   * (EC-12): a case made from a finding keeps its origin and its link.
   */
  async updateCase(workspaceId: string, id: string, patch: CasePatch): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        name: patch.name,
        inputDiff: patch.inputDiff,
        inputMeta: patch.inputMeta,
        expectation: patch.expectation,
        targetFile: patch.target.file,
        targetStartLine: patch.target.start_line,
        targetEndLine: patch.target.end_line,
        fingerprint: patch.fingerprint,
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row ? caseRowToDto(row) : undefined;
  }

  async caseNames(workspaceId: string, owner: EvalOwner, excludeId?: string): Promise<string[]> {
    const conds = [this.ownedBy(workspaceId, owner)];
    if (excludeId) conds.push(ne(t.evalCases.id, excludeId));
    const rows = await this.db
      .select({ name: t.evalCases.name })
      .from(t.evalCases)
      .where(and(...conds));
    return rows.map((r) => r.name);
  }

  async listCases(workspaceId: string, owner: EvalOwner): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(this.ownedBy(workspaceId, owner))
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.id));
    return rows.map(caseRowToDto);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row ? caseRowToDto(row) : undefined;
  }

  /** Past results keep their rows: `eval_run_cases.case_id` is set null by the FK. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs ----------------------------------------------------------------

  /**
   * A second running suite for the owner, or a second running single-case run of the same
   * case, is a typed result, never a thrown 500 (EC-6, EC-8): the two partial unique indexes
   * back it race-safely.
   */
  async insertRunningRun(row: NewRun): Promise<InsertRunResult> {
    try {
      const [inserted] = await this.db
        .insert(t.evalRuns)
        .values({
          id: row.id,
          workspaceId: row.workspaceId,
          kind: row.kind,
          ownerKind: row.ownerKind,
          ownerId: row.ownerId,
          singleCaseId: row.singleCaseId,
          agentId: row.agentId,
          agentVersion: row.agentVersion,
          provider: row.provider,
          model: row.model,
          status: 'running',
          skills: row.skills,
          caseRefs: row.caseRefs,
          casesTotal: row.casesTotal,
        })
        .returning();
      return { ok: true, run: runRowToDto(inserted!) };
    } catch (err) {
      if (pgErrorCode(err) !== '23505') throw err;
      const sameRun =
        row.kind === 'single' && row.singleCaseId
          ? and(eq(t.evalRuns.kind, 'single'), eq(t.evalRuns.singleCaseId, row.singleCaseId))
          : and(
              eq(t.evalRuns.kind, 'suite'),
              eq(t.evalRuns.ownerKind, row.ownerKind),
              eq(t.evalRuns.ownerId, row.ownerId),
            );
      const [active] = await this.db
        .select({ id: t.evalRuns.id })
        .from(t.evalRuns)
        .where(and(eq(t.evalRuns.workspaceId, row.workspaceId), sameRun, eq(t.evalRuns.status, 'running')));
      return { ok: false, reason: 'already_running', kind: row.kind, runId: active?.id ?? null };
    }
  }

  async insertCaseResult(row: NewCaseResult): Promise<void> {
    await this.db.insert(t.evalRunCases).values({
      runId: row.runId,
      caseId: row.caseId,
      caseName: row.caseName,
      expectation: row.expectation,
      targetFile: row.target.file,
      targetStartLine: row.target.start_line,
      targetEndLine: row.target.end_line,
      fingerprint: row.fingerprint,
      status: row.status,
      error: row.error,
      produced: row.produced,
      kept: row.kept,
      matched: row.matched,
      nmfHits: row.nmfHits,
      findings: row.findings,
      durationMs: row.durationMs,
      costUsd: row.costUsd,
    });
  }

  async finishRun(id: string, patch: RunPatch): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({
        status: patch.status,
        error: patch.error,
        recall: patch.metrics.recall,
        precision: patch.metrics.precision,
        citationAccuracy: patch.metrics.citation_accuracy,
        casesPassed: patch.casesPassed,
        casesErrored: patch.casesErrored,
        durationMs: patch.durationMs,
        costUsd: patch.costUsd,
        finishedAt: patch.finishedAt,
      })
      .where(eq(t.evalRuns.id, id));
  }

  /**
   * Mark every `running` run of the workspace (suite or single, any owner) whose id is not in
   * `activeIds` as failed: the process that owned it is gone (an API restart). An orphaned
   * single run would otherwise block its case forever.
   */
  async failStaleRunning(workspaceId: string, activeIds: readonly string[], reason: string): Promise<void> {
    const conds = [eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.status, 'running')];
    if (activeIds.length > 0) conds.push(notInArray(t.evalRuns.id, [...activeIds]));
    await this.db
      .update(t.evalRuns)
      .set({ status: 'failed', error: reason, finishedAt: sql`now()` })
      .where(and(...conds));
  }

  async listRuns(
    workspaceId: string,
    owner: EvalOwner,
    opts: { limit: number; statuses?: readonly EvalSuiteRun['status'][]; order?: 'asc' | 'desc' },
  ): Promise<EvalSuiteRun[]> {
    const conds = [OWNER_SUITE(workspaceId, owner)];
    if (opts.statuses && opts.statuses.length > 0) {
      conds.push(inArray(t.evalRuns.status, [...opts.statuses]));
    }
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(...conds))
      .orderBy(opts.order === 'asc' ? asc(t.evalRuns.ranAt) : desc(t.evalRuns.ranAt))
      .limit(opts.limit);
    return rows.map(runRowToDto);
  }

  async getRun(workspaceId: string, id: string): Promise<EvalSuiteRun | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(AGENT_SUITE(workspaceId), eq(t.evalRuns.id, id)));
    return row ? runRowToDto(row) : undefined;
  }

  /** Any kind, any owner: a single-case or skill run is polled through here too. */
  async getRunWithResults(workspaceId: string, id: string): Promise<EvalSuiteRunDetail | undefined> {
    const [runRow] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, id)));
    if (!runRow) return undefined;
    const run = runRowToDto(runRow);
    const rows = await this.db
      .select()
      .from(t.evalRunCases)
      .where(eq(t.evalRunCases.runId, id))
      .orderBy(asc(t.evalRunCases.caseName), asc(t.evalRunCases.id));
    return { ...run, results: rows.map(resultRowToDto) };
  }

  async caseStatusesForRun(
    runId: string,
  ): Promise<{ caseId: string; status: 'passed' | 'failed' | 'errored' }[]> {
    const rows = await this.db
      .select({ caseId: t.evalRunCases.caseId, status: t.evalRunCases.status })
      .from(t.evalRunCases)
      .where(eq(t.evalRunCases.runId, runId));
    return rows.flatMap((r) => (r.caseId ? [{ caseId: r.caseId, status: r.status }] : []));
  }

  /** Newest first; `partial` runs have metrics, `failed` and `running` ones do not. */
  async latestCompletedRuns(workspaceId: string, owner: EvalOwner, n: number): Promise<EvalSuiteRun[]> {
    return this.listRuns(workspaceId, owner, { limit: n, statuses: ['completed', 'partial'] });
  }

  // ---- dashboard -----------------------------------------------------------

  async agentsWithCases(workspaceId: string): Promise<AgentWithCases[]> {
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        name: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
        casesTotal: sql<number>`count(${t.evalCases.id})::int`,
      })
      .from(t.evalCases)
      .innerJoin(t.agents, eq(t.evalCases.ownerId, t.agents.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.agents.id, t.agents.name, t.agents.provider, t.agents.model)
      .orderBy(asc(t.agents.name));
    return rows;
  }

  async recentRuns(workspaceId: string, limit: number): Promise<EvalSuiteRun[]> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(AGENT_SUITE(workspaceId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map(runRowToDto);
  }

  // ---- single-case runs ----------------------------------------------------

  async latestSingleByCase(
    workspaceId: string,
    caseIds: readonly string[],
  ): Promise<Map<string, LatestSingle>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([t.evalRunCases.caseId], {
        caseId: t.evalRunCases.caseId,
        runId: t.evalRuns.id,
        status: t.evalRunCases.status,
        startedAt: t.evalRuns.ranAt,
      })
      .from(t.evalRunCases)
      .innerJoin(t.evalRuns, eq(t.evalRunCases.runId, t.evalRuns.id))
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.kind, 'single'),
          inArray(t.evalRunCases.caseId, [...caseIds]),
        ),
      )
      .orderBy(t.evalRunCases.caseId, desc(t.evalRuns.ranAt));
    const out = new Map<string, LatestSingle>();
    for (const r of rows) {
      if (r.caseId) out.set(r.caseId, { runId: r.runId, status: r.status, startedAt: r.startedAt.toISOString() });
    }
    return out;
  }

  async latestCaseResult(
    workspaceId: string,
    caseId: string,
  ): Promise<{ run: EvalSuiteRun; result: EvalCaseResult } | undefined> {
    const [row] = await this.db
      .select({ run: t.evalRuns, result: t.evalRunCases })
      .from(t.evalRunCases)
      .innerJoin(t.evalRuns, eq(t.evalRunCases.runId, t.evalRuns.id))
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRunCases.caseId, caseId)))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(1);
    return row ? { run: runRowToDto(row.run), result: resultRowToDto(row.result) } : undefined;
  }

  async runningSingle(workspaceId: string, caseId: string): Promise<EvalSuiteRun | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.kind, 'single'),
          eq(t.evalRuns.singleCaseId, caseId),
          eq(t.evalRuns.status, 'running'),
        ),
      );
    return row ? runRowToDto(row) : undefined;
  }

  private ownedBy(workspaceId: string, owner: EvalOwner) {
    return and(
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerKind, owner.kind),
      eq(t.evalCases.ownerId, owner.id),
    );
  }
}
