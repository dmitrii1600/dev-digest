import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalSuiteRun, EvalSuiteRunDetail } from '@devdigest/shared';
import { reviewPullRequest, type ReviewInput } from '@devdigest/reviewer-core';
import { EvalsService, type EvalsDeps } from '../src/modules/evals/service.js';
import type {
  EvalAgent,
  EvalsStore,
  InsertRunResult,
  NewCaseResult,
  NewRun,
  RunPatch,
} from '../src/modules/evals/types.js';
import { INTERRUPTED_REASON } from '../src/modules/evals/constants.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { AppError, ConfigError } from '../src/platform/errors.js';

/** Hermetic: an in-memory store, a mock provider, the real review engine. No Postgres. */

const WS = 'ws-1';
const AGENT: EvalAgent = {
  id: 'agent-1',
  name: 'Security reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review code.',
  strategy: 'single-pass',
  version: 3,
};

const DIFF =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;';

const makeCase = (n: number, over: Partial<EvalCase> = {}): EvalCase => ({
  id: `case-${n}`,
  owner_kind: 'agent',
  owner_id: AGENT.id,
  name: `Case ${n}`,
  expectation: 'must_find',
  target: { file: 'src/a.ts', start_line: 2, end_line: 2 },
  source: 'finding',
  source_finding_id: `finding-${n}`,
  fingerprint: `fp-${n}`,
  input_diff: DIFF,
  input_files: null,
  input_meta: { pr_title: `PR ${n}`, pr_body: `Body of PR ${n}` },
  expected_output: { title: 't', severity: 'warning', category: 'bug' },
  notes: null,
  created_at: '2026-10-05T00:00:00.000Z',
  ...over,
});

class FakeStore implements EvalsStore {
  cases: EvalCase[] = [];
  runs: EvalSuiteRun[] = [];
  results: NewCaseResult[] = [];
  sweepCalls: { activeIds: string[] }[] = [];
  private clock = 0;

  async findingSource(): Promise<undefined> {
    return undefined;
  }
  async prFilePatch(): Promise<null> {
    return null;
  }
  async countCases(): Promise<number> {
    return this.cases.length;
  }
  async insertCaseIfAbsent(): Promise<never> {
    throw new Error('not used');
  }
  async listCases(): Promise<EvalCase[]> {
    return this.cases;
  }
  async getCase(_ws: string, id: string): Promise<EvalCase | undefined> {
    return this.cases.find((c) => c.id === id);
  }
  async deleteCase(): Promise<boolean> {
    return true;
  }
  async insertRunningRun(row: NewRun): Promise<InsertRunResult> {
    const active = this.runs.find((r) => r.agent_id === row.agentId && r.status === 'running');
    if (active) return { ok: false, reason: 'already_running', runId: active.id };
    const run: EvalSuiteRun = {
      id: row.id,
      kind: 'suite',
      owner_kind: 'agent',
      owner_id: row.agentId,
      agent_id: row.agentId,
      agent_version: row.agentVersion,
      provider: row.provider,
      model: row.model,
      status: 'running',
      error: null,
      skills: row.skills,
      cases: row.caseRefs,
      cases_total: row.casesTotal,
      cases_passed: 0,
      cases_errored: 0,
      metrics: { recall: null, precision: null, citation_accuracy: null },
      duration_ms: null,
      cost_usd: null,
      started_at: new Date(Date.UTC(2026, 9, 5, 0, 0, this.clock++)).toISOString(),
      finished_at: null,
    };
    this.runs.push(run);
    return { ok: true, run };
  }
  async insertCaseResult(row: NewCaseResult): Promise<void> {
    this.results.push(row);
  }
  async finishRun(id: string, patch: RunPatch): Promise<void> {
    const r = this.runs.find((x) => x.id === id)!;
    Object.assign(r, {
      status: patch.status,
      error: patch.error,
      metrics: patch.metrics,
      cases_passed: patch.casesPassed,
      cases_errored: patch.casesErrored,
      duration_ms: patch.durationMs,
      cost_usd: patch.costUsd,
      finished_at: patch.finishedAt.toISOString(),
    });
  }
  async failStaleRunning(
    _ws: string,
    agentId: string | null,
    activeIds: readonly string[],
    reason: string,
  ): Promise<void> {
    this.sweepCalls.push({ activeIds: [...activeIds] });
    for (const r of this.runs) {
      if (r.status !== 'running' || activeIds.includes(r.id)) continue;
      if (agentId && r.agent_id !== agentId) continue;
      r.status = 'failed';
      r.error = reason;
    }
  }
  async listRuns(
    _ws: string,
    agentId: string,
    opts: { limit: number; statuses?: readonly EvalSuiteRun['status'][]; order?: 'asc' | 'desc' },
  ): Promise<EvalSuiteRun[]> {
    const rows = this.runs
      .filter((r) => r.agent_id === agentId && (!opts.statuses || opts.statuses.includes(r.status)))
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    if (opts.order !== 'asc') rows.reverse();
    return rows.slice(0, opts.limit);
  }
  async getRun(_ws: string, id: string): Promise<EvalSuiteRun | undefined> {
    return this.runs.find((r) => r.id === id);
  }
  async getRunWithResults(_ws: string, id: string): Promise<EvalSuiteRunDetail | undefined> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return undefined;
    return {
      ...run,
      results: this.results
        .filter((r) => r.runId === id)
        .map((r) => ({
          case_id: r.caseId,
          case_name: r.caseName,
          expectation: r.expectation,
          target: r.target,
          fingerprint: r.fingerprint,
          status: r.status,
          error: r.error,
          produced: r.produced,
          kept: r.kept,
          matched: r.matched,
          findings: r.findings,
          duration_ms: r.durationMs,
          cost_usd: r.costUsd,
        })),
    };
  }
  async caseStatusesForRun(runId: string) {
    return this.results.filter((r) => r.runId === runId).map((r) => ({ caseId: r.caseId, status: r.status }));
  }
  async latestCompletedRuns(ws: string, agentId: string, n: number) {
    return this.listRuns(ws, agentId, { limit: n, statuses: ['completed', 'partial'] });
  }
  async agentsWithCases() {
    return [];
  }
  async recentRuns(): Promise<EvalSuiteRun[]> {
    return [];
  }
}

const REVIEW_FIXTURE = { verdict: 'comment', summary: 'ok', score: 95, findings: [] };

interface Harness {
  store: FakeStore;
  service: EvalsService;
  mock: MockLLMProvider;
  gitCalls: unknown[];
  reviewInputs: ReviewInput[];
}

function harness(
  nCases: number,
  over: Partial<EvalsDeps> = {},
  opts: { cases?: EvalCase[] } = {},
): Harness {
  const store = new FakeStore();
  store.cases = opts.cases ?? Array.from({ length: nCases }, (_, i) => makeCase(i + 1));
  const mock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
  const gitCalls: unknown[] = [];
  const reviewInputs: ReviewInput[] = [];
  const service = new EvalsService({
    repo: store,
    agents: { getById: async (_ws, id) => (id === AGENT.id ? AGENT : undefined) },
    skills: { blocksForAgent: async () => [] },
    git: async () => ({
      diff: async (...args) => {
        gitCalls.push(args);
        throw new Error('git must not be used by a run');
      },
    }),
    parseDiff: parseUnifiedDiff,
    llm: async () => mock,
    review: async (input) => {
      reviewInputs.push(input);
      return reviewPullRequest(input);
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    caseTimeoutMs: 120_000,
    adapterTimeoutMs: 125_000,
    concurrency: 3,
    ...over,
  });
  return { store, service, mock, gitCalls, reviewInputs };
}

async function waitDone(store: FakeStore, runId: string, ms = 5_000): Promise<EvalSuiteRun> {
  const t0 = Date.now();
  for (;;) {
    const r = store.runs.find((x) => x.id === runId)!;
    if (r.status !== 'running') return r;
    if (Date.now() - t0 > ms) throw new Error('run did not finish in time');
    await new Promise((res) => setTimeout(res, 5));
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe('EvalsService.startRun', () => {
  it('(a) makes exactly one single-attempt model call per case and touches no other port', async () => {
    const h = harness(3);
    const run = await h.service.startRun(WS, AGENT.id);
    expect(run.status).toBe('running');
    const done = await waitDone(h.store, run.id);

    expect(done.status).toBe('completed');
    expect(h.mock.calls.map((c) => c.method)).toEqual(['completeStructured', 'completeStructured', 'completeStructured']);
    for (const c of h.mock.calls) {
      const req = c.req as { maxRetries?: number; timeoutMs?: number };
      expect(req.maxRetries).toBe(0);
      expect(req.timeoutMs).toBe(125_000);
    }
    expect(h.gitCalls).toHaveLength(0);
    expect(h.store.results).toHaveLength(3);
  });

  it('(b) never has more than 3 reviews in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const h = harness(7, {
      review: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(15);
        inFlight--;
        return reviewPullRequest({
          systemPrompt: 's',
          model: 'm',
          diff: parseUnifiedDiff(DIFF),
          llm: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
          maxRetries: 0,
        });
      },
    });
    const run = await h.service.startRun(WS, AGENT.id);
    const done = await waitDone(h.store, run.id);
    expect(done.status).toBe('completed');
    expect(h.store.results).toHaveLength(7);
    expect(peak).toBe(3);
  });

  it('(c) records a case whose review never resolves as errored, and the run is partial', async () => {
    const hang = makeCase(1, { input_diff: DIFF + '\n// hang' });
    const ok = makeCase(2);
    const h = harness(0, {
      caseTimeoutMs: 50,
      review: (input) =>
        input.sessionId?.endsWith('case-1') ? new Promise<never>(() => {}) : reviewPullRequest(input),
    }, { cases: [hang, ok] });
    const run = await h.service.startRun(WS, AGENT.id);
    const done = await waitDone(h.store, run.id);

    expect(done.status).toBe('partial');
    expect(done.cases_errored).toBe(1);
    const errored = h.store.results.find((r) => r.caseId === 'case-1')!;
    expect(errored.status).toBe('errored');
    expect(errored.error).toMatch(/timeout after 50 ms/);
  });

  it('(d) marks the run failed when every case errors', async () => {
    const h = harness(2, { review: async () => { throw new Error('boom'); } });
    const run = await h.service.startRun(WS, AGENT.id);
    const done = await waitDone(h.store, run.id);
    expect(done.status).toBe('failed');
    expect(done.cases_errored).toBe(2);
    expect(done.error).toContain('boom');
  });

  it('(e) errors every case with the reason when the provider cannot be built', async () => {
    const h = harness(2, {
      llm: async () => {
        throw new ConfigError('OPENAI_API_KEY is not configured');
      },
    });
    const run = await h.service.startRun(WS, AGENT.id);
    const done = await waitDone(h.store, run.id);
    expect(done.status).toBe('failed');
    expect(h.store.results.map((r) => r.error)).toEqual([
      'OPENAI_API_KEY is not configured',
      'OPENAI_API_KEY is not configured',
    ]);
  });

  it('(f) answers 409 to a second start while one is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const h = harness(1, {
      review: async (input) => {
        await gate;
        return reviewPullRequest(input);
      },
    });
    const first = await h.service.startRun(WS, AGENT.id);
    const second = await h.service.startRun(WS, AGENT.id).catch((e: unknown) => e);
    expect(second).toBeInstanceOf(AppError);
    expect((second as AppError).statusCode).toBe(409);
    expect((second as AppError).code).toBe('eval_run_in_progress');
    expect((second as AppError).details).toEqual({ run_id: first.id });
    release();
    await waitDone(h.store, first.id);
  });

  it('(h) reviews the frozen diff and PR text only', async () => {
    const h = harness(1);
    const run = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, run.id);

    const input = h.reviewInputs[0]!;
    for (const key of ['intent', 'repoMap', 'callers', 'specs', 'memory']) {
      expect(Object.keys(input)).not.toContain(key);
    }
    expect(input.prDescription).toBe('Body of PR 1');
    expect(input.task).toContain('"PR 1"');
    expect(input.maxRetries).toBe(0);
    expect(input.skills).toBeUndefined();
  });

  it('(i) drops a review result that arrives after the timeout fired', async () => {
    let finishLate!: () => void;
    const late = new Promise<void>((res) => (finishLate = res));
    const h = harness(1, {
      caseTimeoutMs: 30,
      review: async (input) => {
        await late;
        return reviewPullRequest(input);
      },
    });
    const run = await h.service.startRun(WS, AGENT.id);
    const done = await waitDone(h.store, run.id);
    finishLate();
    await sleep(40);

    expect(h.store.results).toHaveLength(1);
    expect(h.store.results[0]!.status).toBe('errored');
    expect(done.cases_total).toBe(1);
    expect(h.store.runs[0]!.status).toBe('failed');
  });

  it('(j) a read that lands right after the insert does not mark the new run interrupted', async () => {
    const h = harness(1);
    const realInsert = h.store.insertRunningRun.bind(h.store);
    h.store.insertRunningRun = async (row) => {
      const r = await realInsert(row);
      // The row exists, execute() has not run: this is the window the active set protects.
      await h.service.listRuns(WS, AGENT.id);
      expect(h.store.runs[0]!.status).toBe('running');
      return r;
    };
    const run = await h.service.startRun(WS, AGENT.id);
    expect(run.status).toBe('running');
    const done = await waitDone(h.store, run.id);
    expect(done.status).toBe('completed');
    expect(done.error).toBeNull();
  });

  it('answers 422 eval_set_empty for an agent with no cases', async () => {
    const h = harness(0);
    const err = (await h.service.startRun(WS, AGENT.id).catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('eval_set_empty');
    expect(err.message).toBe('Agent "Security reviewer" has no eval cases');
  });

  it('snapshots the agent version, the skills and the case fingerprints on the run', async () => {
    const h = harness(2, {
      skills: {
        blocksForAgent: async () => [
          { id: 's1', source: 'manual', body: 'Rule A', name: 'Rule A', version: 4 },
          { id: 's2', source: 'imported_file', body: 'Rule B', name: 'Rule B', version: 1 },
        ],
      },
    });
    const run = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, run.id);

    expect(run.agent_version).toBe(3);
    expect(run.skills).toEqual([
      { skill_id: 's1', name: 'Rule A', version: 4 },
      { skill_id: 's2', name: 'Rule B', version: 1 },
    ]);
    expect(run.cases).toEqual([
      { case_id: 'case-1', fingerprint: 'fp-1' },
      { case_id: 'case-2', fingerprint: 'fp-2' },
    ]);
    // The untrusted skill is wrapped, the trusted one is not.
    const skills = h.reviewInputs[0]!.skills!;
    expect(skills[0]).toBe('Rule A');
    expect(skills[1]).not.toBe('Rule B');
    expect(skills[1]).toContain('Rule B');
  });
});

describe('EvalsService reads', () => {
  it('(g) reads a running row this process does not own as failed with the interrupted reason', async () => {
    const h = harness(1);
    h.store.runs.push({
      id: 'orphan',
      kind: 'suite',
      owner_kind: 'agent',
      owner_id: AGENT.id,
      agent_id: AGENT.id,
      agent_version: 1,
      provider: 'openai',
      model: 'm',
      status: 'running',
      error: null,
      skills: [],
      cases: [],
      cases_total: 1,
      cases_passed: 0,
      cases_errored: 0,
      metrics: { recall: null, precision: null, citation_accuracy: null },
      duration_ms: null,
      cost_usd: null,
      started_at: '2026-10-05T00:00:00.000Z',
      finished_at: null,
    });
    const runs = await h.service.listRuns(WS, AGENT.id);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.error).toBe(INTERRUPTED_REASON);
  });

  it('answers 404 for an agent that is not in the workspace', async () => {
    const h = harness(1);
    await expect(h.service.listRuns(WS, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses to compare a run with itself or with a run of another agent', async () => {
    const h = harness(1);
    await expect(h.service.compare(WS, AGENT.id, 'a', 'a')).rejects.toMatchObject({
      statusCode: 422,
      code: 'eval_compare_invalid',
    });
    await expect(h.service.compare(WS, AGENT.id, 'a', 'b')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('compares two runs: signed deltas, case-set diff and model change', async () => {
    const h = harness(2);
    const first = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, first.id);
    h.store.cases[1] = makeCase(2, { fingerprint: 'fp-2-edited' });
    const second = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, second.id);

    // Newest id passed first: the answer is still ordered older → newer.
    const cmp = await h.service.compare(WS, AGENT.id, second.id, first.id);
    expect(cmp.older.id).toBe(first.id);
    expect(cmp.newer.id).toBe(second.id);
    expect(cmp.case_sets).toEqual({ same: false, older_count: 2, newer_count: 2, edited_count: 1 });
    expect(cmp.model_changed).toBe(false);
    expect(cmp.skills_changed).toBe(false);
    // Both runs found nothing for a must_find case: recall 0 → 0.
    expect(cmp.deltas.recall).toBe(0);
  });

  it('builds the agent dashboard from the two latest completed runs', async () => {
    const h = harness(1);
    const first = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, first.id);
    const second = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, second.id);

    const dash = await h.service.agentDashboard(WS, AGENT.id);
    expect(dash.owner_name).toBe(AGENT.name);
    expect(dash.trend).toHaveLength(2);
    expect(dash.current?.cases_total).toBe(1);
    expect(dash.delta.cases_passed).toBe(0);
    expect(dash.delta.recall).toBe(0);
    expect(dash.running).toBeNull();
    expect(dash.alert).toBeNull();
  });
});
