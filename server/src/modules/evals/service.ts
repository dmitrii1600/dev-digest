import { randomUUID } from 'node:crypto';
import type {
  EvalAgentCard,
  EvalCase,
  EvalCaseCreateResult,
  EvalCaseList,
  EvalDashboard,
  EvalRunComparison,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  EvalTrendPoint,
  LLMProvider,
  Provider,
  StructuredRequest,
  UnifiedDiff,
} from '@devdigest/shared';
import type { ReviewInput, ReviewOutcome } from '@devdigest/reviewer-core';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { skillBlockBody } from '../_shared/review-inputs.js';
import { INTERRUPTED_REASON, MAX_CASE_NAME_CHARS, MAX_CASES_PER_AGENT, MAX_PR_BODY_BYTES, MAX_PR_TITLE_CHARS, RUNS_PAGE_SIZE } from './constants.js';
import {
  aggregateRun,
  alertLine,
  caseFingerprint,
  compactFindings,
  compareCaseSets,
  evalTaskLine,
  extractFileDiff,
  freezeDiff,
  metricDelta,
  passDelta,
  patchToFileDiff,
  regressions,
  scoreCase,
  skillsChanged,
  truncateChars,
  truncateUtf8,
  type CaseOutcome,
} from './helpers.js';
import type { EvalAgent, EvalsStore } from './types.js';

/** Minimal structured logger (pino-compatible: (obj, msg)). */
export interface EvalsLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface EvalsDeps {
  repo: EvalsStore;
  agents: { getById(workspaceId: string, id: string): Promise<EvalAgent | undefined> };
  skills: {
    blocksForAgent(
      agentId: string,
    ): Promise<{ id: string; source: string; body: string; name: string; version: number }[]>;
  };
  /** Lazy: resolved per call so a test that patches the container later is honoured. */
  git: () => Promise<{
    diff(repo: { owner: string; name: string }, base: string, head: string): Promise<UnifiedDiff>;
  }>;
  parseDiff: (raw: string) => UnifiedDiff;
  llm: (provider: Provider) => Promise<LLMProvider>;
  review: (input: ReviewInput) => Promise<ReviewOutcome>;
  log: EvalsLogger;
  /** A case whose review has not returned in this long is recorded as errored. */
  caseTimeoutMs: number;
  /** Provider-side timeout stamped on every request; longer than `caseTimeoutMs`. */
  adapterTimeoutMs: number;
  /** Review calls in flight at once. */
  concurrency: number;
  now?: () => Date;
}

const rejected = (reason: string, message: string): AppError =>
  new AppError('eval_case_rejected', message, 422, { reason });

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const fmtTimeout = (ms: number): string => (ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

/**
 * Evals (ring 2): freeze a decided finding into a case, run an agent over its
 * cases, and read the runs back. The run executor reviews each case's frozen
 * diff and PR text ONLY — no intent, repo map, callers or project documents —
 * with one model call per case, and never touches reviews, findings or the PR.
 */
export class EvalsService {
  /** Ids of runs executing in THIS process; a `running` row outside it is orphaned. */
  private readonly active = new Set<string>();
  private readonly now: () => Date;

  constructor(private readonly deps: EvalsDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // ---- cases ---------------------------------------------------------------

  async createFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseCreateResult> {
    const { repo, agents, git } = this.deps;
    const src = await repo.findingSource(workspaceId, findingId);
    if (!src) throw new NotFoundError('Finding not found');
    // EC-3: no producing agent, or it was deleted → no case can be owned.
    if (!src.agentId) throw new NotFoundError('The finding has no producing agent');
    const agent = await agents.getById(workspaceId, src.agentId);
    if (!agent) throw new NotFoundError('The agent that produced this finding no longer exists');

    const { finding, pull } = src;
    const expectation = finding.acceptedAt ? 'must_find' : finding.dismissedAt ? 'must_not_flag' : null;
    if (!expectation) {
      throw rejected('finding_undecided', 'Accept or dismiss the finding before turning it into an eval case');
    }
    if ((await repo.countCases(workspaceId, agent.id)) >= MAX_CASES_PER_AGENT) {
      throw rejected('case_limit', `An agent can have at most ${MAX_CASES_PER_AGENT} eval cases`);
    }

    // The frozen diff: the persisted patch for that exact path, else the real git diff.
    const patch = await repo.prFilePatch(pull.id, finding.file);
    let fileDiff = patch ? patchToFileDiff(finding.file, patch) : null;
    if (!fileDiff) {
      try {
        const diff = await (await git()).diff(src.repo, pull.base, pull.headSha);
        fileDiff = extractFileDiff(diff.raw, finding.file);
      } catch {
        fileDiff = null;
      }
    }
    if (!fileDiff) throw rejected('diff_unavailable', 'The diff of the finding’s file is not available');

    const start = Math.max(1, finding.startLine);
    const end = Math.max(start, finding.endLine);
    const frozen = freezeDiff(fileDiff, start, end);
    if (!frozen.ok) {
      throw rejected(
        frozen.reason,
        frozen.reason === 'diff_too_large'
          ? 'The diff is too large to freeze as an eval case'
          : 'The finding’s lines are not in the diff',
      );
    }

    const pr_title = truncateChars(pull.title, MAX_PR_TITLE_CHARS);
    const pr_body = truncateUtf8(pull.body ?? '', MAX_PR_BODY_BYTES);
    const target = { file: finding.file, start_line: start, end_line: end };
    return this.deps.repo.insertCaseIfAbsent({
      workspaceId,
      ownerId: agent.id,
      name: truncateChars(finding.title, MAX_CASE_NAME_CHARS),
      inputDiff: frozen.diff,
      inputMeta: { pr_title, pr_body },
      expectedOutput: { title: finding.title, severity: finding.severity, category: finding.category },
      sourceFindingId: finding.id,
      expectation,
      target,
      fingerprint: caseFingerprint({
        input_diff: frozen.diff,
        pr_title,
        pr_body,
        expectation,
        file: target.file,
        start_line: start,
        end_line: end,
      }),
    });
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseList> {
    await this.requireAgent(workspaceId, agentId);
    const cases = await this.deps.repo.listCases(workspaceId, agentId);
    const [latest] = await this.deps.repo.latestCompletedRuns(workspaceId, agentId, 1);
    const statusByCase = new Map<string, 'passed' | 'failed' | 'errored'>();
    if (latest) {
      for (const r of await this.deps.repo.caseStatusesForRun(latest.id)) statusByCase.set(r.caseId, r.status);
    }
    const items = cases.map((c) => ({ ...c, last_result: statusByCase.get(c.id) ?? ('never_run' as const) }));
    return {
      cases: items,
      passing: items.filter((c) => c.last_result === 'passed').length,
      total: items.length,
      latest_run_id: latest?.id ?? null,
    };
  }

  async deleteCase(workspaceId: string, id: string): Promise<{ ok: true }> {
    if (!(await this.deps.repo.deleteCase(workspaceId, id))) throw new NotFoundError('Eval case not found');
    return { ok: true };
  }

  // ---- runs ----------------------------------------------------------------

  /** Start a suite run and return it as `running` at once; the cases run in the background. */
  async startRun(workspaceId: string, agentId: string): Promise<EvalSuiteRun> {
    const { repo, skills } = this.deps;
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.sweep(workspaceId, agentId);

    const cases = await repo.listCases(workspaceId, agentId);
    if (cases.length === 0) {
      throw new AppError('eval_set_empty', `Agent "${agent.name}" has no eval cases`, 422, {
        agent_id: agentId,
      });
    }

    const skillRows = await skills.blocksForAgent(agentId);
    const runId = randomUUID();
    // Registered BEFORE the insert: a read that lands between the insert and the
    // bookkeeping must not see an unknown `running` row and mark it interrupted.
    this.active.add(runId);
    let inserted;
    try {
      inserted = await repo.insertRunningRun({
        id: runId,
        workspaceId,
        agentId,
        agentVersion: agent.version,
        provider: agent.provider,
        model: agent.model,
        skills: skillRows.map((s) => ({ skill_id: s.id, name: s.name, version: s.version })),
        caseRefs: cases.map((c) => ({ case_id: c.id, fingerprint: c.fingerprint })),
        casesTotal: cases.length,
      });
    } catch (err) {
      this.active.delete(runId);
      throw err;
    }
    if (!inserted.ok) {
      this.active.delete(runId);
      throw new AppError('eval_run_in_progress', `An eval run for "${agent.name}" is already running`, 409, {
        run_id: inserted.runId,
      });
    }

    const startedAt = this.now().getTime();
    void this.execute({
      workspaceId,
      runId,
      agent,
      cases,
      skillBodies: skillRows.map(skillBlockBody),
      startedAt,
    })
      .catch(async (err) => {
        this.deps.log.error({ runId, err: errMessage(err) }, 'eval run crashed');
        try {
          await repo.finishRun(runId, {
            status: 'failed',
            error: errMessage(err),
            metrics: { recall: null, precision: null, citation_accuracy: null },
            casesPassed: 0,
            casesErrored: 0,
            durationMs: this.now().getTime() - startedAt,
            costUsd: null,
            finishedAt: this.now(),
          });
        } catch (finishErr) {
          this.deps.log.error({ runId, err: errMessage(finishErr) }, 'could not mark the eval run failed');
        }
      })
      .finally(() => this.active.delete(runId));

    return inserted.run;
  }

  private async execute(ctx: {
    workspaceId: string;
    runId: string;
    agent: EvalAgent;
    cases: EvalCase[];
    skillBodies: string[];
    startedAt: number;
  }): Promise<void> {
    const { runId, agent, cases } = ctx;
    const { repo, log } = this.deps;
    log.info(
      { runId, agentId: agent.id, agentVersion: agent.version, model: agent.model, cases: cases.length },
      'eval run started',
    );

    // Resolve the provider once. A missing key fails every case with the reason, not the request.
    let llm: LLMProvider | null = null;
    let llmError: string | null = null;
    try {
      llm = this.singleCall(await this.deps.llm(agent.provider));
    } catch (err) {
      llmError = errMessage(err);
    }

    const outcomes: CaseOutcome[] = [];
    let firstError: string | null = llmError;
    let aborted = false;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!aborted && next < cases.length) {
        const c = cases[next++]!;
        try {
          const outcome = await this.runCase(ctx, c, llm, llmError);
          outcomes.push(outcome.score);
          firstError ??= outcome.error;
        } catch (err) {
          aborted = true; // a persistence failure: stop starting cases
          throw err;
        }
      }
    };
    const width = Math.max(1, Math.min(this.deps.concurrency, cases.length));
    await Promise.all(Array.from({ length: width }, worker));

    const agg = aggregateRun(outcomes);
    const durationMs = this.now().getTime() - ctx.startedAt;
    await repo.finishRun(runId, {
      status: agg.status,
      error: agg.status === 'failed' ? `Every case errored: ${firstError ?? 'unknown error'}` : null,
      metrics: agg.metrics,
      casesPassed: agg.cases_passed,
      casesErrored: agg.cases_errored,
      durationMs,
      costUsd: agg.cost_usd,
      finishedAt: this.now(),
    });
    log.info(
      { runId, status: agg.status, passed: agg.cases_passed, errored: agg.cases_errored, durationMs },
      'eval run finished',
    );
  }

  /** One case: review the frozen diff, score it, persist exactly one result row. */
  private async runCase(
    ctx: { runId: string; agent: EvalAgent; skillBodies: string[] },
    c: EvalCase,
    llm: LLMProvider | null,
    llmError: string | null,
  ): Promise<{ score: CaseOutcome; error: string | null }> {
    const { runId, agent } = ctx;
    const started = this.now().getTime();
    const base = {
      runId,
      caseId: c.id,
      caseName: c.name,
      expectation: c.expectation,
      target: c.target,
      fingerprint: c.fingerprint,
    };

    let result: Parameters<EvalsStore['insertCaseResult']>[0];
    let score: CaseOutcome;
    let error: string | null = null;
    try {
      if (!llm) throw new Error(llmError ?? 'LLM provider unavailable');
      const outcome = await this.reviewWithTimeout({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff: this.deps.parseDiff(c.input_diff),
        llm,
        strategy: agent.strategy,
        skills: ctx.skillBodies.length > 0 ? ctx.skillBodies : undefined,
        prDescription: c.input_meta.pr_body || undefined,
        task: evalTaskLine(c.input_meta),
        maxRetries: 0,
        sessionId: `eval:${runId}:${c.id}`,
      });
      const kept = outcome.review.findings;
      const s = scoreCase(c.expectation, c.target, kept, outcome.dropped.length);
      result = {
        ...base,
        status: s.status,
        error: null,
        produced: s.produced,
        kept: s.kept,
        matched: s.matched,
        nmfHits: s.nmf_hits,
        findings: compactFindings(kept),
        durationMs: this.now().getTime() - started,
        costUsd: outcome.costUsd,
      };
      score = {
        expectation: c.expectation,
        status: s.status,
        produced: s.produced,
        kept: s.kept,
        nmf_hits: s.nmf_hits,
        cost_usd: outcome.costUsd,
      };
    } catch (err) {
      error = errMessage(err);
      result = {
        ...base,
        status: 'errored',
        error,
        produced: 0,
        kept: 0,
        matched: 0,
        nmfHits: 0,
        findings: [],
        durationMs: this.now().getTime() - started,
        costUsd: null,
      };
      score = { expectation: c.expectation, status: 'errored', produced: 0, kept: 0, nmf_hits: 0, cost_usd: null };
    }

    await this.deps.repo.insertCaseResult(result);
    this.deps.log.info(
      { runId, caseId: c.id, status: result.status, durationMs: result.durationMs, error },
      'eval case finished',
    );
    return { score, error };
  }

  /**
   * Race the review against `caseTimeoutMs`. A result that arrives after the
   * timer fired is discarded (the race has settled), and a late rejection is
   * swallowed so it cannot surface as an unhandled rejection.
   */
  private async reviewWithTimeout(input: ReviewInput): Promise<ReviewOutcome> {
    const pending = (async () => this.deps.review(input))();
    pending.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timeout after ${fmtTimeout(this.deps.caseTimeoutMs)}`)),
        this.deps.caseTimeoutMs,
      );
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stamp "one attempt, bounded time" on every structured request. */
  private singleCall(inner: LLMProvider): LLMProvider {
    const { adapterTimeoutMs } = this.deps;
    return {
      id: inner.id,
      listModels: () => inner.listModels(),
      complete: (req) => inner.complete(req),
      completeStructured: <T>(req: StructuredRequest<T>) =>
        inner.completeStructured<T>({ ...req, maxRetries: 0, timeoutMs: adapterTimeoutMs }),
      embed: (texts) => inner.embed(texts),
    };
  }

  // ---- reads ---------------------------------------------------------------

  async listRuns(workspaceId: string, agentId: string, limit = RUNS_PAGE_SIZE): Promise<EvalSuiteRun[]> {
    await this.requireAgent(workspaceId, agentId);
    await this.sweep(workspaceId, agentId);
    return this.deps.repo.listRuns(workspaceId, agentId, { limit });
  }

  async getRun(workspaceId: string, id: string): Promise<EvalSuiteRunDetail> {
    await this.sweep(workspaceId, null);
    const run = await this.deps.repo.getRunWithResults(workspaceId, id);
    if (!run) throw new NotFoundError('Eval run not found');
    return run;
  }

  async compare(workspaceId: string, agentId: string, a: string, b: string): Promise<EvalRunComparison> {
    await this.requireAgent(workspaceId, agentId);
    const invalid = (message: string) => new AppError('eval_compare_invalid', message, 422, { a, b });
    if (a === b) throw invalid('Pick two different runs to compare');
    await this.sweep(workspaceId, agentId);
    const [ra, rb] = await Promise.all([this.deps.repo.getRun(workspaceId, a), this.deps.repo.getRun(workspaceId, b)]);
    if (!ra || !rb || ra.agent_id !== agentId || rb.agent_id !== agentId) {
      throw invalid('Both runs must belong to this agent');
    }
    const [older, newer] = ra.started_at <= rb.started_at ? [ra, rb] : [rb, ra];
    return {
      older,
      newer,
      deltas: {
        recall: metricDelta(newer.metrics.recall, older.metrics.recall),
        precision: metricDelta(newer.metrics.precision, older.metrics.precision),
        citation_accuracy: metricDelta(newer.metrics.citation_accuracy, older.metrics.citation_accuracy),
        cost_usd:
          newer.cost_usd === null || older.cost_usd === null ? null : newer.cost_usd - older.cost_usd,
      },
      case_sets: compareCaseSets(older.cases, newer.cases),
      model_changed: older.provider !== newer.provider || older.model !== newer.model,
      skills_changed: skillsChanged(older.skills, newer.skills),
    };
  }

  async agentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.sweep(workspaceId, agentId);
    const { repo } = this.deps;
    const completed = await repo.listRuns(workspaceId, agentId, {
      limit: 500,
      statuses: ['completed', 'partial'],
      order: 'asc',
    });
    const latest = completed[completed.length - 1] ?? null;
    const previous = completed[completed.length - 2] ?? null;
    const [recent, running, casesTotal] = await Promise.all([
      repo.listRuns(workspaceId, agentId, { limit: RUNS_PAGE_SIZE }),
      repo.listRuns(workspaceId, agentId, { limit: 1, statuses: ['running'] }),
      repo.countCases(workspaceId, agentId),
    ]);
    const regs = latest && previous ? regressions(latest.metrics, previous.metrics) : [];

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      owner_name: agent.name,
      cases_total: casesTotal,
      current: latest
        ? {
            ...latest.metrics,
            cases_passed: latest.cases_passed,
            cases_total: latest.cases_total,
            cost_usd: latest.cost_usd,
          }
        : null,
      delta: {
        recall: latest && previous ? metricDelta(latest.metrics.recall, previous.metrics.recall) : null,
        precision: latest && previous ? metricDelta(latest.metrics.precision, previous.metrics.precision) : null,
        citation_accuracy:
          latest && previous
            ? metricDelta(latest.metrics.citation_accuracy, previous.metrics.citation_accuracy)
            : null,
        cases_passed: passDelta(latest, previous),
      },
      trend: completed.map(trendPoint),
      recent_runs: recent,
      agents: [],
      running: running[0] ?? null,
      regressions: regs,
      alert: alertLine(regs),
    };
  }

  async workspaceDashboard(workspaceId: string): Promise<EvalDashboard> {
    await this.sweep(workspaceId, null);
    const { repo } = this.deps;
    const withCases = await repo.agentsWithCases(workspaceId);
    const agents: EvalAgentCard[] = await Promise.all(
      withCases.map(async (a) => ({
        agent_id: a.agentId,
        agent_name: a.name,
        provider: a.provider,
        model: a.model,
        cases_total: a.casesTotal,
        latest: (await repo.latestCompletedRuns(workspaceId, a.agentId, 1))[0] ?? null,
      })),
    );
    const recent = await repo.recentRuns(workspaceId, RUNS_PAGE_SIZE);
    return {
      owner_kind: null,
      owner_id: null,
      owner_name: null,
      cases_total: withCases.reduce((n, a) => n + a.casesTotal, 0),
      current: null,
      delta: { recall: null, precision: null, citation_accuracy: null, cases_passed: null },
      trend: [],
      recent_runs: recent,
      agents,
      running: recent.find((r) => r.status === 'running') ?? null,
      regressions: [],
      alert: null,
    };
  }

  // ---- internals -----------------------------------------------------------

  private async requireAgent(workspaceId: string, agentId: string): Promise<EvalAgent> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /** A `running` row this process does not own was orphaned by a restart (EC-7). */
  private sweep(workspaceId: string, agentId: string | null): Promise<void> {
    return this.deps.repo.failStaleRunning(workspaceId, agentId, [...this.active], INTERRUPTED_REASON);
  }
}

function trendPoint(r: EvalSuiteRun): EvalTrendPoint {
  return {
    run_id: r.id,
    ran_at: r.started_at,
    agent_version: r.agent_version,
    recall: r.metrics.recall,
    precision: r.metrics.precision,
    citation_accuracy: r.metrics.citation_accuracy,
    pass_rate: r.cases_total === 0 ? null : r.cases_passed / r.cases_total,
    cases_passed: r.cases_passed,
    cases_total: r.cases_total,
    cost_usd: r.cost_usd,
  };
}
