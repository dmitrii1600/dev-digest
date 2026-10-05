import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
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
  EvalsStore,
  FindingSource,
  InsertRunResult,
  NewCase,
  NewCaseResult,
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

const SUITE = (ws: string) => and(eq(t.evalRuns.workspaceId, ws), eq(t.evalRuns.kind, 'suite'));

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

  async countCases(workspaceId: string, agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(this.ownedBy(workspaceId, agentId));
    return row?.n ?? 0;
  }

  /** Insert, or report the case that already exists for this source finding (EC-2). */
  async insertCaseIfAbsent(row: NewCase): Promise<{ case: EvalCase; created: boolean }> {
    const inserted = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: row.workspaceId,
        ownerKind: 'agent',
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

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(this.ownedBy(workspaceId, agentId))
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

  /** A second running suite for the agent is a typed result, never a thrown 500 (EC-6). */
  async insertRunningRun(row: NewRun): Promise<InsertRunResult> {
    try {
      const [inserted] = await this.db
        .insert(t.evalRuns)
        .values({
          id: row.id,
          workspaceId: row.workspaceId,
          kind: 'suite',
          ownerKind: 'agent',
          ownerId: row.agentId,
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
      const [active] = await this.db
        .select({ id: t.evalRuns.id })
        .from(t.evalRuns)
        .where(
          and(
            SUITE(row.workspaceId),
            eq(t.evalRuns.agentId, row.agentId),
            eq(t.evalRuns.status, 'running'),
          ),
        );
      return { ok: false, reason: 'already_running', runId: active?.id ?? null };
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
   * Mark every `running` suite run whose id is not in `activeIds` as failed —
   * the process that owned it is gone (an API restart). `agentId` null = all agents.
   */
  async failStaleRunning(
    workspaceId: string,
    agentId: string | null,
    activeIds: readonly string[],
    reason: string,
  ): Promise<void> {
    const conds = [SUITE(workspaceId), eq(t.evalRuns.status, 'running')];
    if (agentId) conds.push(eq(t.evalRuns.agentId, agentId));
    if (activeIds.length > 0) conds.push(notInArray(t.evalRuns.id, [...activeIds]));
    await this.db
      .update(t.evalRuns)
      .set({ status: 'failed', error: reason, finishedAt: sql`now()` })
      .where(and(...conds));
  }

  async listRuns(
    workspaceId: string,
    agentId: string,
    opts: { limit: number; statuses?: readonly EvalSuiteRun['status'][]; order?: 'asc' | 'desc' },
  ): Promise<EvalSuiteRun[]> {
    const conds = [SUITE(workspaceId), eq(t.evalRuns.agentId, agentId)];
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
      .where(and(SUITE(workspaceId), eq(t.evalRuns.id, id)));
    return row ? runRowToDto(row) : undefined;
  }

  async getRunWithResults(workspaceId: string, id: string): Promise<EvalSuiteRunDetail | undefined> {
    const run = await this.getRun(workspaceId, id);
    if (!run) return undefined;
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
  async latestCompletedRuns(workspaceId: string, agentId: string, n: number): Promise<EvalSuiteRun[]> {
    return this.listRuns(workspaceId, agentId, { limit: n, statuses: ['completed', 'partial'] });
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
      .where(SUITE(workspaceId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map(runRowToDto);
  }

  private ownedBy(workspaceId: string, agentId: string) {
    return and(
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerKind, 'agent'),
      eq(t.evalCases.ownerId, agentId),
    );
  }
}
