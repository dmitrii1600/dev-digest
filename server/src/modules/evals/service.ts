import { randomUUID } from 'node:crypto';
import type {
  EvalAgentCard,
  EvalCase,
  EvalCaseCreateResult,
  EvalCaseInput,
  EvalCaseList,
  EvalCaseRunState,
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
  caseNameKey,
  checkManualTarget,
  compactFindings,
  compareCaseSets,
  evalTaskLine,
  extractFileDiff,
  freezeDiff,
  metricDelta,
  passDelta,
  pastedDiffFiles,
  patchToFileDiff,
  regressions,
  scoreCase,
  skillsChanged,
  truncateChars,
  truncateUtf8,
  type CaseOutcome,
} from './helpers.js';
import type { EvalAgent, EvalOwner, EvalSkill, EvalsStore } from './types.js';

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
    /** A skill with its CURRENT body and version, whatever its enabled flags. */
    getById(workspaceId: string, id: string): Promise<EvalSkill | undefined>;
    /** Ids of the agents the skill is linked to (any binding, enabled or not). */
    linkedAgentIds(skillId: string): Promise<string[]>;
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

const rejected = (reason: string, message: string, field?: string): AppError =>
  new AppError('eval_case_rejected', message, 422, field ? { reason, field } : { reason });

const REJECTION_MESSAGE: Record<string, string> = {
  diff_unparseable: 'The diff is not a unified diff with at least one file and one hunk',
  diff_needs_git_headers: 'A diff with more than one file needs a "diff --git" line before each file',
  target_file_not_in_diff: 'The target file is not in the diff',
  target_outside_changes: 'The target lines do not overlap a changed line of the file',
  name_taken: 'Another case in this set already uses this name',
};

const ownerLabel = (owner: EvalOwner): string => (owner.kind === 'agent' ? 'agent' : 'skill');

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const fmtTimeout = (ms: number): string => (ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

/**
 * Evals (ring 2): freeze a decided finding into a case or write one by hand, run an
 * agent (or a skill on a host agent) over its cases, and read the runs back. The run
 * executor reviews each case's frozen diff and PR text ONLY — no intent, repo map,
 * callers or project documents — with one model call per case, and never touches
 * reviews, findings or the PR.
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
    if ((await repo.countCases(workspaceId, { kind: 'agent', id: agent.id })) >= MAX_CASES_PER_AGENT) {
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
      ownerKind: 'agent',
      ownerId: agent.id,
      name: truncateChars(finding.title, MAX_CASE_NAME_CHARS),
      inputDiff: frozen.diff,
      inputMeta: { pr_title, pr_body },
      expectedOutput: { title: finding.title, severity: finding.severity, category: finding.category },
      source: 'finding',
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

  /** A hand-written case in an agent's or a skill's set (NFR-2: no model call). */
  async createManualCase(workspaceId: string, owner: EvalOwner, input: EvalCaseInput): Promise<EvalCase> {
    const { repo } = this.deps;
    await this.requireOwner(workspaceId, owner);
    if ((await repo.countCases(workspaceId, owner)) >= MAX_CASES_PER_AGENT) {
      throw rejected('case_limit', `A ${ownerLabel(owner)} can have at most ${MAX_CASES_PER_AGENT} eval cases`);
    }
    await this.checkManualInput(workspaceId, owner, input);
    return repo.insertCase({
      workspaceId,
      ownerKind: owner.kind,
      ownerId: owner.id,
      name: input.name.trim(),
      inputDiff: input.input_diff,
      inputMeta: input.input_meta,
      expectedOutput: { title: null, severity: null, category: null },
      source: 'manual',
      sourceFindingId: null,
      expectation: input.expectation,
      target: input.target,
      fingerprint: fingerprintOf(input),
    });
  }

  /**
   * Edit a case in place, with the same checks as a create against the case's own owner. The
   * fingerprint is recomputed on every save over the content only, so a rename alone keeps it.
   * `source` and the source-finding link are kept (EC-12).
   */
  async updateCase(workspaceId: string, id: string, input: EvalCaseInput): Promise<EvalCase> {
    const existing = await this.deps.repo.getCase(workspaceId, id);
    if (!existing) throw new NotFoundError('Eval case not found');
    const owner: EvalOwner = { kind: existing.owner_kind, id: existing.owner_id };
    await this.checkManualInput(workspaceId, owner, input, id);
    const updated = await this.deps.repo.updateCase(workspaceId, id, {
      name: input.name.trim(),
      inputDiff: input.input_diff,
      inputMeta: input.input_meta,
      expectation: input.expectation,
      target: input.target,
      fingerprint: fingerprintOf(input),
    });
    if (!updated) throw new NotFoundError('Eval case not found');
    return updated;
  }

  /** The diff parses, the target is in it, and the name is free in the owner's set. */
  private async checkManualInput(
    workspaceId: string,
    owner: EvalOwner,
    input: EvalCaseInput,
    excludeId?: string,
  ): Promise<void> {
    const parsed = pastedDiffFiles(input.input_diff);
    if (!parsed.ok) throw rejected(parsed.reason, REJECTION_MESSAGE[parsed.reason]!, 'input_diff');
    const miss = checkManualTarget(parsed.files, input.target);
    if (miss) throw rejected(miss.reason, REJECTION_MESSAGE[miss.reason]!, miss.field);
    const key = caseNameKey(input.name);
    const names = await this.deps.repo.caseNames(workspaceId, owner, excludeId);
    if (names.some((n) => caseNameKey(n) === key)) {
      throw rejected('name_taken', REJECTION_MESSAGE.name_taken!, 'name');
    }
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseList> {
    await this.requireAgent(workspaceId, agentId);
    return this.listOwnerCases(workspaceId, { kind: 'agent', id: agentId });
  }

  async listSkillCases(workspaceId: string, skillId: string): Promise<EvalCaseList> {
    await this.requireSkill(workspaceId, skillId);
    return this.listOwnerCases(workspaceId, { kind: 'skill', id: skillId });
  }

  /**
   * `last_result` is the case's result in the owner's latest completed SUITE run (a skill:
   * any host). `latest_single` is the secondary marker: the case's newest single-case run, kept
   * only when it is newer than that suite run (AC-13).
   */
  private async listOwnerCases(workspaceId: string, owner: EvalOwner): Promise<EvalCaseList> {
    const { repo } = this.deps;
    const cases = await repo.listCases(workspaceId, owner);
    const [latest] = await repo.latestCompletedRuns(workspaceId, owner, 1);
    const statusByCase = new Map<string, 'passed' | 'failed' | 'errored'>();
    if (latest) {
      for (const r of await repo.caseStatusesForRun(latest.id)) statusByCase.set(r.caseId, r.status);
    }
    const singles = await repo.latestSingleByCase(
      workspaceId,
      cases.map((c) => c.id),
    );
    const suiteAt = latest ? Date.parse(latest.started_at) : null;
    const items = cases.map((c) => {
      const single = singles.get(c.id);
      const newer = single && (suiteAt === null || Date.parse(single.startedAt) > suiteAt);
      return {
        ...c,
        last_result: statusByCase.get(c.id) ?? ('never_run' as const),
        latest_single:
          single && newer ? { run_id: single.runId, status: single.status, started_at: single.startedAt } : null,
      };
    });
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
    await this.sweep(workspaceId);

    const owner: EvalOwner = { kind: 'agent', id: agentId };
    const cases = await repo.listCases(workspaceId, owner);
    if (cases.length === 0) {
      throw new AppError('eval_set_empty', `Agent "${agent.name}" has no eval cases`, 422, {
        agent_id: agentId,
      });
    }

    return this.launch({
      workspaceId,
      kind: 'suite',
      owner,
      agent,
      skills: await skills.blocksForAgent(agentId),
      cases,
      singleCaseId: null,
      conflict: {
        code: 'eval_run_in_progress',
        message: `An eval run for "${agent.name}" is already running`,
      },
    });
  }

  /**
   * One case, run alone (`kind = 'single'`), on the owner agent's current configuration — or,
   * for a skill-owned case, on a linked host agent with only that skill enabled. It never
   * counts toward suite metrics, and a suite run of the same owner does not block it.
   */
  async startCaseRun(workspaceId: string, caseId: string, hostAgentId?: string): Promise<EvalSuiteRun> {
    const { skills } = this.deps;
    const c = await this.deps.repo.getCase(workspaceId, caseId);
    if (!c) throw new NotFoundError('Eval case not found');

    let agent: EvalAgent;
    let runSkills: EvalSkill[];
    if (c.owner_kind === 'agent') {
      if (hostAgentId !== undefined) {
        throw new AppError('eval_host_invalid', 'A host agent is only for a skill’s case', 422, {
          reason: 'host_not_allowed',
        });
      }
      agent = await this.requireAgent(workspaceId, c.owner_id);
      runSkills = await skills.blocksForAgent(agent.id);
    } else {
      if (hostAgentId === undefined) {
        throw new AppError('eval_host_invalid', 'Pick a host agent to run a skill’s case', 422, {
          reason: 'host_required',
        });
      }
      const skill = await this.requireSkill(workspaceId, c.owner_id);
      agent = await this.requireHost(workspaceId, skill, hostAgentId);
      runSkills = [skill];
    }

    await this.sweep(workspaceId);
    return this.launch({
      workspaceId,
      kind: 'single',
      owner: { kind: c.owner_kind, id: c.owner_id },
      agent,
      skills: runSkills,
      cases: [c],
      singleCaseId: c.id,
      conflict: { code: 'eval_case_run_in_progress', message: `Case "${c.name}" is already running` },
    });
  }

  /**
   * A skill's suite on a host agent: the host's prompt, model and strategy, with only the skill
   * under test enabled, at its current version (AC-15).
   */
  async startSkillRun(workspaceId: string, skillId: string, hostAgentId: string): Promise<EvalSuiteRun> {
    const skill = await this.requireSkill(workspaceId, skillId);
    const host = await this.requireHost(workspaceId, skill, hostAgentId);
    const owner: EvalOwner = { kind: 'skill', id: skillId };
    const cases = await this.deps.repo.listCases(workspaceId, owner);
    if (cases.length === 0) {
      throw new AppError('eval_set_empty', `Skill "${skill.name}" has no eval cases`, 422, { skill_id: skillId });
    }
    await this.sweep(workspaceId);
    return this.launch({
      workspaceId,
      kind: 'suite',
      owner,
      agent: host,
      skills: [skill],
      cases,
      singleCaseId: null,
      conflict: {
        code: 'eval_run_in_progress',
        message: `An eval run for skill "${skill.name}" is already running`,
      },
    });
  }

  /**
   * The one path every run takes: register as active, insert the `running` row (the unique
   * indexes turn a race into the 409), then execute in the background — one call per case,
   * 120 s, at most 3 in flight.
   */
  private async launch(spec: {
    workspaceId: string;
    kind: 'suite' | 'single';
    owner: EvalOwner;
    agent: EvalAgent;
    skills: EvalSkill[];
    cases: EvalCase[];
    singleCaseId: string | null;
    conflict: { code: string; message: string };
  }): Promise<EvalSuiteRun> {
    const { workspaceId, kind, owner, agent, skills, cases, singleCaseId } = spec;
    const { repo } = this.deps;
    const runId = randomUUID();
    // Registered BEFORE the insert: a read that lands between the insert and the
    // bookkeeping must not see an unknown `running` row and mark it interrupted.
    this.active.add(runId);
    let inserted;
    try {
      inserted = await repo.insertRunningRun({
        id: runId,
        workspaceId,
        kind,
        ownerKind: owner.kind,
        ownerId: owner.id,
        singleCaseId,
        agentId: agent.id,
        agentVersion: agent.version,
        provider: agent.provider,
        model: agent.model,
        skills: skills.map((s) => ({ skill_id: s.id, name: s.name, version: s.version })),
        caseRefs: cases.map((c) => ({ case_id: c.id, fingerprint: c.fingerprint })),
        casesTotal: cases.length,
      });
    } catch (err) {
      this.active.delete(runId);
      throw err;
    }
    if (!inserted.ok) {
      this.active.delete(runId);
      throw new AppError(spec.conflict.code, spec.conflict.message, 409, { run_id: inserted.runId });
    }

    const startedAt = this.now().getTime();
    const logCtx = {
      runId,
      kind,
      ownerKind: owner.kind,
      ownerId: owner.id,
      caseId: singleCaseId,
      agentId: agent.id,
      agentVersion: agent.version,
      skills: skills.map((s) => ({ id: s.id, version: s.version })),
    };
    void this.execute({
      workspaceId,
      runId,
      agent,
      cases,
      skillBodies: skills.map(skillBlockBody),
      startedAt,
      logCtx,
    })
      .catch(async (err) => {
        this.deps.log.error({ ...logCtx, err: errMessage(err) }, 'eval run crashed');
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
          this.deps.log.error({ ...logCtx, err: errMessage(finishErr) }, 'could not mark the eval run failed');
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
    /** What every log line of this run carries: kind, owner, case, agent version, skills (NFR-7). */
    logCtx: Record<string, unknown>;
  }): Promise<void> {
    const { runId, agent, cases } = ctx;
    const { repo, log } = this.deps;
    log.info({ ...ctx.logCtx, model: agent.model, cases: cases.length }, 'eval run started');

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
      {
        ...ctx.logCtx,
        status: agg.status,
        passed: agg.cases_passed,
        errored: agg.cases_errored,
        durationMs,
        error: agg.cases_errored > 0 ? (firstError ?? 'unknown error') : null,
      },
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
    await this.sweep(workspaceId);
    return this.deps.repo.listRuns(workspaceId, { kind: 'agent', id: agentId }, { limit });
  }

  async listSkillRuns(workspaceId: string, skillId: string, limit = RUNS_PAGE_SIZE): Promise<EvalSuiteRun[]> {
    await this.requireSkill(workspaceId, skillId);
    await this.sweep(workspaceId);
    return this.deps.repo.listRuns(workspaceId, { kind: 'skill', id: skillId }, { limit });
  }

  /** The case editor's read: the newest result of the case (either kind) and a running single run. */
  async caseRunState(workspaceId: string, caseId: string): Promise<EvalCaseRunState> {
    const { repo } = this.deps;
    if (!(await repo.getCase(workspaceId, caseId))) throw new NotFoundError('Eval case not found');
    await this.sweep(workspaceId);
    const [latest, running] = await Promise.all([
      repo.latestCaseResult(workspaceId, caseId),
      repo.runningSingle(workspaceId, caseId),
    ]);
    return { latest: latest ?? null, running: running ?? null };
  }

  async getRun(workspaceId: string, id: string): Promise<EvalSuiteRunDetail> {
    await this.sweep(workspaceId);
    const run = await this.deps.repo.getRunWithResults(workspaceId, id);
    if (!run) throw new NotFoundError('Eval run not found');
    return run;
  }

  async compare(workspaceId: string, agentId: string, a: string, b: string): Promise<EvalRunComparison> {
    await this.requireAgent(workspaceId, agentId);
    const invalid = (message: string) => new AppError('eval_compare_invalid', message, 422, { a, b });
    if (a === b) throw invalid('Pick two different runs to compare');
    await this.sweep(workspaceId);
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
    await this.sweep(workspaceId);
    const { repo } = this.deps;
    const owner: EvalOwner = { kind: 'agent', id: agentId };
    const completed = await repo.listRuns(workspaceId, owner, {
      limit: 500,
      statuses: ['completed', 'partial'],
      order: 'asc',
    });
    const latest = completed[completed.length - 1] ?? null;
    const previous = completed[completed.length - 2] ?? null;
    const [recent, running, casesTotal] = await Promise.all([
      repo.listRuns(workspaceId, owner, { limit: RUNS_PAGE_SIZE }),
      repo.listRuns(workspaceId, owner, { limit: 1, statuses: ['running'] }),
      repo.countCases(workspaceId, owner),
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

  /**
   * The skill tab's tiles. Deltas compare with the newest EARLIER completed run on the SAME host
   * agent (AC-16), not with the previous run on another host. No regression banner here.
   */
  async skillDashboard(workspaceId: string, skillId: string): Promise<EvalDashboard> {
    const skill = await this.requireSkill(workspaceId, skillId);
    await this.sweep(workspaceId);
    const { repo } = this.deps;
    const owner: EvalOwner = { kind: 'skill', id: skillId };
    const completed = await repo.listRuns(workspaceId, owner, {
      limit: 500,
      statuses: ['completed', 'partial'],
      order: 'asc',
    });
    const latest = completed[completed.length - 1] ?? null;
    const previous = latest
      ? ([...completed.slice(0, -1)].reverse().find((r) => r.agent_id === latest.agent_id) ?? null)
      : null;
    const [recent, running, casesTotal] = await Promise.all([
      repo.listRuns(workspaceId, owner, { limit: RUNS_PAGE_SIZE }),
      repo.listRuns(workspaceId, owner, { limit: 1, statuses: ['running'] }),
      repo.countCases(workspaceId, owner),
    ]);

    return {
      owner_kind: 'skill',
      owner_id: skillId,
      owner_name: skill.name,
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
      regressions: [],
      alert: null,
    };
  }

  async workspaceDashboard(workspaceId: string): Promise<EvalDashboard> {
    await this.sweep(workspaceId);
    const { repo } = this.deps;
    const withCases = await repo.agentsWithCases(workspaceId);
    const agents: EvalAgentCard[] = await Promise.all(
      withCases.map(async (a) => ({
        agent_id: a.agentId,
        agent_name: a.name,
        provider: a.provider,
        model: a.model,
        cases_total: a.casesTotal,
        latest: (await repo.latestCompletedRuns(workspaceId, { kind: 'agent', id: a.agentId }, 1))[0] ?? null,
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

  private async requireSkill(workspaceId: string, skillId: string): Promise<EvalSkill> {
    const skill = await this.deps.skills.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  }

  private async requireOwner(workspaceId: string, owner: EvalOwner): Promise<void> {
    if (owner.kind === 'agent') await this.requireAgent(workspaceId, owner.id);
    else await this.requireSkill(workspaceId, owner.id);
  }

  /** The host agent of a skill run: it exists (404) and is linked to the skill (422). */
  private async requireHost(workspaceId: string, skill: EvalSkill, hostAgentId: string): Promise<EvalAgent> {
    const host = await this.deps.agents.getById(workspaceId, hostAgentId);
    if (!host) throw new NotFoundError('Host agent not found');
    if (!(await this.deps.skills.linkedAgentIds(skill.id)).includes(host.id)) {
      throw new AppError('eval_host_invalid', `Agent "${host.name}" is not linked to skill "${skill.name}"`, 422, {
        reason: 'host_not_linked',
        host_agent_id: host.id,
      });
    }
    return host;
  }

  /** A `running` row this process does not own was orphaned by a restart (EC-7). */
  private sweep(workspaceId: string): Promise<void> {
    return this.deps.repo.failStaleRunning(workspaceId, [...this.active], INTERRUPTED_REASON);
  }
}

/** Content fingerprint of a manual case; the name is not part of it. */
function fingerprintOf(input: EvalCaseInput): string {
  return caseFingerprint({
    input_diff: input.input_diff,
    pr_title: input.input_meta.pr_title,
    pr_body: input.input_meta.pr_body,
    expectation: input.expectation,
    file: input.target.file,
    start_line: input.target.start_line,
    end_line: input.target.end_line,
  });
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
