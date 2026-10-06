import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalSuiteRun, EvalSuiteRunDetail, LLMProvider } from '@devdigest/shared';
import type { ReviewOutcome } from '@devdigest/reviewer-core';
import { EvalsService, type EvalsDeps } from '../src/modules/evals/service.js';
import type {
  AgentWithCases,
  EvalAgent,
  EvalOwner,
  EvalsStore,
  InsertRunResult,
  NewCaseResult,
  NewRun,
  RunPatch,
} from '../src/modules/evals/types.js';
import { createLimiter } from '../src/modules/evals/helpers.js';
import { DASHBOARD_RUN_CAP, RUN_ALL_CONCURRENCY } from '../src/modules/evals/constants.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { AppError } from '../src/platform/errors.js';

/**
 * Hermetic: EvalsService on this file's OWN minimal in-memory store (the three other fakes stay
 * as they are). Covers the run-controls server half: the dashboard cards' `enabled`/`running`,
 * the `since` pass-through, the newest-500 dashboard read, the batch limiter and "Run all
 * agents". The SQL behind them lives in `evals-run-controls.it.test.ts`.
 */

const WS = 'ws-1';
const DIFF =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const agentOf = (id: string, over: Partial<EvalAgent> = {}): EvalAgent => ({
  id,
  name: `Agent ${id}`,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review code.',
  strategy: 'single-pass',
  version: 1,
  ...over,
});

const caseOf = (id: string, ownerId: string): EvalCase => ({
  id,
  owner_kind: 'agent',
  owner_id: ownerId,
  name: `Case ${id}`,
  expectation: 'must_find',
  target: { file: 'src/a.ts', start_line: 2, end_line: 2 },
  source: 'manual',
  source_finding_id: null,
  fingerprint: `fp-${id}`,
  input_diff: DIFF,
  input_files: null,
  input_meta: { pr_title: `PR ${id}`, pr_body: '' },
  expected_output: { title: 't', severity: 'warning', category: 'bug' },
  notes: null,
  created_at: '2026-10-05T00:00:00.000Z',
});

const T0 = Date.UTC(2026, 0, 1);

function runOf(over: Partial<EvalSuiteRun> & { id: string }): EvalSuiteRun {
  return {
    kind: 'suite',
    owner_kind: 'agent',
    owner_id: 'a1',
    agent_id: 'a1',
    agent_version: 1,
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'completed',
    error: null,
    skills: [],
    cases: [],
    cases_total: 10,
    cases_passed: 5,
    cases_errored: 0,
    metrics: { recall: 0.5, precision: 0.5, citation_accuracy: 1 },
    duration_ms: 1000,
    cost_usd: 0.01,
    started_at: new Date(T0).toISOString(),
    finished_at: new Date(T0 + 1000).toISOString(),
    ...over,
  };
}

type ListOpts = Parameters<EvalsStore['listRuns']>[2];

class Store implements EvalsStore {
  cases: EvalCase[] = [];
  runs: EvalSuiteRun[] = [];
  results: NewCaseResult[] = [];
  withCases: AgentWithCases[] = [];
  listCalls: { owner: EvalOwner; opts: ListOpts }[] = [];
  insertCalls = 0;
  /** When set, `insertRunningRun` waits on it (keeps a batch inside its start loop). */
  insertGate: Promise<void> | null = null;
  private clock = 0;

  async findingSource(): Promise<undefined> {
    return undefined;
  }
  async prFilePatch(): Promise<null> {
    return null;
  }
  async countCases(_ws: string, owner: EvalOwner): Promise<number> {
    return this.cases.filter((c) => c.owner_id === owner.id).length;
  }
  async insertCaseIfAbsent(): Promise<never> {
    throw new Error('not used');
  }
  async insertCase(): Promise<never> {
    throw new Error('not used');
  }
  async updateCase(): Promise<undefined> {
    return undefined;
  }
  async caseNames(): Promise<string[]> {
    return [];
  }
  async listCases(_ws: string, owner: EvalOwner): Promise<EvalCase[]> {
    return this.cases.filter((c) => c.owner_kind === owner.kind && c.owner_id === owner.id);
  }
  async getCase(_ws: string, id: string): Promise<EvalCase | undefined> {
    return this.cases.find((c) => c.id === id);
  }
  async deleteCase(): Promise<boolean> {
    return true;
  }
  async insertRunningRun(row: NewRun): Promise<InsertRunResult> {
    this.insertCalls++;
    if (this.insertGate) await this.insertGate;
    const active = this.runs.find(
      (r) =>
        r.status === 'running' &&
        r.kind === row.kind &&
        r.owner_kind === row.ownerKind &&
        r.owner_id === row.ownerId &&
        (row.kind === 'suite' || r.cases[0]?.case_id === row.caseRefs[0]?.case_id),
    );
    if (active) return { ok: false, reason: 'already_running', kind: row.kind, runId: active.id };
    const run = runOf({
      id: row.id,
      kind: row.kind,
      owner_kind: row.ownerKind,
      owner_id: row.ownerId,
      agent_id: row.agentId,
      agent_version: row.agentVersion,
      status: 'running',
      skills: row.skills,
      cases: row.caseRefs,
      cases_total: row.casesTotal,
      cases_passed: 0,
      metrics: { recall: null, precision: null, citation_accuracy: null },
      duration_ms: null,
      cost_usd: null,
      started_at: new Date(Date.UTC(2030, 0, 1, 0, 0, this.clock++)).toISOString(),
      finished_at: null,
    });
    this.runs.push(run);
    return { ok: true, run };
  }
  async insertCaseResult(row: NewCaseResult): Promise<void> {
    this.results.push(row);
  }
  async finishRun(id: string, patch: RunPatch): Promise<void> {
    Object.assign(this.runs.find((r) => r.id === id)!, {
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
  /** A no-op: this file seeds `running` rows by hand that the sweep must not fail. */
  async failStaleRunning(): Promise<void> {}
  async listRuns(_ws: string, owner: EvalOwner, opts: ListOpts): Promise<EvalSuiteRun[]> {
    this.listCalls.push({ owner, opts });
    const since = opts.since?.toISOString();
    const rows = this.runs
      .filter(
        (r) =>
          r.kind === 'suite' &&
          r.owner_kind === owner.kind &&
          r.owner_id === owner.id &&
          (!opts.statuses || opts.statuses.includes(r.status)) &&
          (!since || r.started_at >= since),
      )
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    if (opts.order !== 'asc') rows.reverse();
    return rows.slice(0, opts.limit);
  }
  async getRun(): Promise<undefined> {
    return undefined;
  }
  async getRunWithResults(): Promise<EvalSuiteRunDetail | undefined> {
    return undefined;
  }
  async caseStatusesForRun(): Promise<[]> {
    return [];
  }
  async latestCompletedRuns(ws: string, owner: EvalOwner, n: number): Promise<EvalSuiteRun[]> {
    return this.listRuns(ws, owner, { limit: n, statuses: ['completed', 'partial'] });
  }
  async agentsWithCases(): Promise<AgentWithCases[]> {
    return this.withCases;
  }
  async recentRuns(): Promise<EvalSuiteRun[]> {
    return [];
  }
  async latestSingleByCase() {
    return new Map();
  }
  async latestCaseResult(): Promise<undefined> {
    return undefined;
  }
  async runningSingle(): Promise<undefined> {
    return undefined;
  }
}

const OUTCOME = {
  review: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
  dropped: [],
  scopeDropped: [],
  costUsd: 0.01,
} as unknown as ReviewOutcome;

const STUB_LLM = {
  id: 'openai',
  listModels: async () => [],
  complete: async () => '',
  completeStructured: async () => ({}),
  embed: async () => [],
} as unknown as LLMProvider;

function harness(over: Partial<EvalsDeps> = {}) {
  const store = new Store();
  const agents = new Map<string, EvalAgent>();
  const logs: { obj: Record<string, unknown>; msg?: string }[] = [];
  const service = new EvalsService({
    repo: store,
    agents: { getById: async (_ws, id) => agents.get(id) },
    skills: { blocksForAgent: async () => [], getById: async () => undefined, linkedAgentIds: async () => [] },
    git: async () => ({
      diff: async () => {
        throw new Error('git must not be used by a run');
      },
    }),
    parseDiff: parseUnifiedDiff,
    llm: async () => STUB_LLM,
    review: async () => OUTCOME,
    log: {
      info: (obj, msg) => logs.push({ obj: obj as Record<string, unknown>, msg }),
      warn: () => {},
      error: () => {},
    },
    caseTimeoutMs: 120_000,
    adapterTimeoutMs: 125_000,
    concurrency: 3,
    ...over,
  });
  /** An enabled agent with `n` cases, listed on the dashboard. */
  const addAgent = (id: string, n: number, opts: { enabled?: boolean; agent?: Partial<EvalAgent> } = {}) => {
    agents.set(id, agentOf(id, opts.agent));
    for (let i = 1; i <= n; i++) store.cases.push(caseOf(`${id}-c${i}`, id));
    store.withCases.push({
      agentId: id,
      name: `Agent ${id}`,
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: opts.enabled ?? true,
      casesTotal: n,
    });
  };
  return { store, service, agents, logs, addAgent };
}

async function waitIdle(store: Store, ms = 5_000): Promise<void> {
  const t0 = Date.now();
  while (store.runs.some((r) => r.status === 'running')) {
    if (Date.now() - t0 > ms) throw new Error('runs did not finish in time');
    await sleep(5);
  }
}

/** `eval:<runId>:<caseId>` → runId */
const runIdOf = (sessionId: string | undefined): string => (sessionId ?? '').split(':')[1] ?? '';

describe('workspaceDashboard cards', () => {
  it('a disabled agent carries enabled: false, an enabled one true', async () => {
    const h = harness();
    h.addAgent('a1', 2, { enabled: false });
    h.addAgent('a2', 1);
    const { agents } = await h.service.workspaceDashboard(WS);
    expect(agents.find((a) => a.agent_id === 'a1')!.enabled).toBe(false);
    expect(agents.find((a) => a.agent_id === 'a2')!.enabled).toBe(true);
  });

  it('an agent-owned running suite run sets running; a skill run hosted on the agent does not', async () => {
    const h = harness();
    h.addAgent('a1', 1);
    h.addAgent('a2', 1);
    h.addAgent('a3', 1);
    h.store.runs.push(
      runOf({ id: 'r-a2', owner_id: 'a2', agent_id: 'a2', status: 'running', finished_at: null }),
      // A skill suite on host a3: `agent_id` is the host, but the owner is the skill.
      runOf({ id: 'r-skill', owner_kind: 'skill', owner_id: 'skill-1', agent_id: 'a3', status: 'running', finished_at: null }),
    );
    const { agents } = await h.service.workspaceDashboard(WS);
    const running = Object.fromEntries(agents.map((a) => [a.agent_id, a.running]));
    expect(running).toEqual({ a1: false, a2: true, a3: false });
  });
});

describe('EvalsService.listRuns since', () => {
  it('forwards `since` to the store, and nothing when it is absent', async () => {
    const h = harness();
    h.addAgent('a1', 1);
    const since = new Date('2026-10-01T00:00:00Z');
    await h.service.listRuns(WS, 'a1', 20, since);
    expect(h.store.listCalls.at(-1)!.opts).toEqual({ limit: 20, since });
    await h.service.listRuns(WS, 'a1', 20);
    expect(h.store.listCalls.at(-1)!.opts.since).toBeUndefined();
  });

  it('keeps a run started exactly at `since` and drops one 1 ms earlier', async () => {
    const h = harness();
    h.addAgent('a1', 1);
    const at = new Date(T0 + 5_000);
    h.store.runs.push(
      runOf({ id: 'edge', started_at: at.toISOString() }),
      runOf({ id: 'before', started_at: new Date(at.getTime() - 1).toISOString() }),
    );
    const runs = await h.service.listRuns(WS, 'a1', 20, at);
    expect(runs.map((r) => r.id)).toEqual(['edge']);
  });
});

describe('dashboards read the newest DASHBOARD_RUN_CAP completed runs', () => {
  /** Run `i` starts i seconds after T0; cases_passed = i², so the latest pair is identifiable. */
  const fill = (store: Store, n: number, over: Partial<EvalSuiteRun> = {}) => {
    for (let i = 1; i <= n; i++) {
      store.runs.push(
        runOf({
          id: `run-${i}`,
          cases_passed: i * i,
          started_at: new Date(T0 + i * 1000).toISOString(),
          ...over,
        }),
      );
    }
  };

  it('exactly the cap → every run, oldest first', async () => {
    const h = harness();
    h.addAgent('a1', 1);
    fill(h.store, DASHBOARD_RUN_CAP);
    const d = await h.service.agentDashboard(WS, 'a1');
    expect(d.trend).toHaveLength(DASHBOARD_RUN_CAP);
    expect(d.trend[0]!.run_id).toBe('run-1');
    expect(d.trend.at(-1)!.run_id).toBe(`run-${DASHBOARD_RUN_CAP}`);
  });

  it('one past the cap → the second-oldest first, and current / delta use the two newest', async () => {
    const h = harness();
    h.addAgent('a1', 1);
    const n = DASHBOARD_RUN_CAP + 1;
    fill(h.store, n);
    const d = await h.service.agentDashboard(WS, 'a1');
    expect(d.trend).toHaveLength(DASHBOARD_RUN_CAP);
    expect(d.trend[0]!.run_id).toBe('run-2');
    expect(d.trend.at(-1)!.run_id).toBe(`run-${n}`);
    expect(d.current!.cases_passed).toBe(n * n);
    expect(d.delta.cases_passed).toBe(n * n - (n - 1) * (n - 1));
  });

  it('the skill dashboard follows the same rule', async () => {
    const h = harness({
      skills: {
        blocksForAgent: async () => [],
        getById: async (_ws, id) =>
          id === 'sk1' ? { id, name: 'Skill', source: 'manual', body: 'b', version: 1 } : undefined,
        linkedAgentIds: async () => [],
      },
    });
    h.agents.set('a1', agentOf('a1'));
    const n = DASHBOARD_RUN_CAP + 1;
    fill(h.store, n, { owner_kind: 'skill', owner_id: 'sk1', agent_id: 'a1' });
    const d = await h.service.skillDashboard(WS, 'sk1');
    expect(d.trend).toHaveLength(DASHBOARD_RUN_CAP);
    expect(d.trend[0]!.run_id).toBe('run-2');
    expect(d.trend.at(-1)!.run_id).toBe(`run-${n}`);
    expect(d.current!.cases_passed).toBe(n * n);
  });
});

describe('createLimiter', () => {
  it('never runs more than n tasks at once, and runs every queued task', async () => {
    const limiter = createLimiter(6);
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        limiter.run(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await sleep(10);
          inFlight--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(6);
    expect(done).toHaveLength(10);
  });

  it('releases its slot after a rejection', async () => {
    const limiter = createLimiter(1);
    const first = limiter.run(async () => {
      await sleep(5);
      throw new Error('boom');
    });
    const second = limiter.run(async () => 'ran');
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ran');
    await expect(limiter.run(async () => 'again')).resolves.toBe('again');
  });
});

describe('EvalsService.runAll', () => {
  it('(a) three agents of four cases never exceed 6 calls in flight, nor 3 within one run (NFR-2)', async () => {
    let inFlight = 0;
    let peak = 0;
    const perRun = new Map<string, number>();
    let perRunPeak = 0;
    const h = harness({
      review: async (input) => {
        const run = runIdOf(input.sessionId);
        inFlight++;
        perRun.set(run, (perRun.get(run) ?? 0) + 1);
        peak = Math.max(peak, inFlight);
        perRunPeak = Math.max(perRunPeak, perRun.get(run)!);
        await sleep(15);
        inFlight--;
        perRun.set(run, perRun.get(run)! - 1);
        return OUTCOME;
      },
    });
    for (const id of ['a1', 'a2', 'a3']) h.addAgent(id, 4);
    const { outcomes } = await h.service.runAll(WS);
    expect(outcomes.map((o) => o.status)).toEqual(['started', 'started', 'started']);
    await waitIdle(h.store);
    expect(h.store.results).toHaveLength(12);
    expect(peak).toBe(RUN_ALL_CONCURRENCY);
    expect(perRunPeak).toBe(3);
  });

  it('(b) a case queued for a slot longer than the case timeout is not recorded as a timeout', async () => {
    // 9 cases over 3 runs of width 3, 6 slots: 3 cases wait ~100 ms for a slot, then run ~100 ms
    // each — 200 ms end to end, past the 150 ms timer. Only a timer armed AFTER the slot lets them pass.
    const h = harness({
      caseTimeoutMs: 150,
      review: async () => {
        await sleep(100);
        return OUTCOME;
      },
    });
    for (const id of ['a1', 'a2', 'a3']) h.addAgent(id, 3);
    await h.service.runAll(WS);
    await waitIdle(h.store);
    expect(h.store.results).toHaveLength(9);
    expect(h.store.results.filter((r) => r.status === 'errored')).toEqual([]);
    // `duration_ms` excludes the queue wait.
    for (const r of h.store.results) expect(r.durationMs).toBeLessThan(180);
  });

  it('(c) started / disabled / already running / no cases in one batch; a skipped agent stops nobody', async () => {
    const h = harness();
    h.addAgent('a1', 1); // started
    h.addAgent('a2', 1, { enabled: false }); // disabled
    h.addAgent('a3', 1); // already running
    h.addAgent('a4', 1); // listed with a case but has none to run
    h.store.cases = h.store.cases.filter((c) => c.owner_id !== 'a4');
    h.addAgent('a5', 2); // started, after every skipped one
    h.store.runs.push(runOf({ id: 'r-a3', owner_id: 'a3', agent_id: 'a3', status: 'running', finished_at: null }));

    const { outcomes } = await h.service.runAll(WS);
    expect(outcomes.map((o) => [o.agent_id, o.status, o.reason])).toEqual([
      ['a1', 'started', null],
      ['a2', 'skipped', 'disabled'],
      ['a3', 'skipped', 'already_running'],
      ['a4', 'skipped', 'no_cases'],
      ['a5', 'started', null],
    ]);
    expect(outcomes.find((o) => o.agent_id === 'a1')!.run_id).toEqual(expect.any(String));
    expect(outcomes.find((o) => o.agent_id === 'a2')!.run_id).toBeNull();
    // Each outcome is logged with its agent.
    const logged = h.logs.filter((l) => l.msg === 'eval run-all outcome');
    expect(logged.map((l) => l.obj.agentId)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(logged[2]!.obj).toMatchObject({ status: 'skipped', reason: 'already_running', runId: null });
    h.store.runs.find((r) => r.id === 'r-a3')!.status = 'failed';
    await waitIdle(h.store);
  });

  it('(d) every agent already running → every outcome skipped and no run row inserted', async () => {
    const h = harness();
    for (const id of ['a1', 'a2']) {
      h.addAgent(id, 1);
      h.store.runs.push(runOf({ id: `r-${id}`, owner_id: id, agent_id: id, status: 'running', finished_at: null }));
    }
    const { outcomes } = await h.service.runAll(WS);
    expect(outcomes.map((o) => [o.status, o.reason])).toEqual([
      ['skipped', 'already_running'],
      ['skipped', 'already_running'],
    ]);
    expect(h.store.runs).toHaveLength(2);
    for (const r of h.store.runs) r.status = 'failed';
  });

  it('(e) a second batch while the first is still starting is a 409; a third after it is accepted', async () => {
    const h = harness();
    h.addAgent('a1', 1);
    let release!: () => void;
    h.store.insertGate = new Promise<void>((res) => (release = res));

    const first = h.service.runAll(WS);
    while (h.store.insertCalls === 0) await sleep(2); // the first is inside its start loop
    const second = await h.service.runAll(WS).then(
      () => null,
      (e: unknown) => e,
    );
    expect(second).toBeInstanceOf(AppError);
    expect(second).toMatchObject({ code: 'eval_run_all_in_progress', statusCode: 409 });

    h.store.insertGate = null;
    release();
    await first;
    await waitIdle(h.store);
    const third = await h.service.runAll(WS);
    expect(third.outcomes).toHaveLength(1);
    await waitIdle(h.store);
  });

  it('(f) exactly one review call per case of each started agent (NFR-1)', async () => {
    const calls: string[] = [];
    const h = harness({
      review: async (input) => {
        calls.push(input.sessionId ?? '');
        return OUTCOME;
      },
    });
    h.addAgent('a1', 3);
    h.addAgent('a2', 4);
    h.addAgent('a3', 5, { enabled: false });
    await h.service.runAll(WS);
    await waitIdle(h.store);
    expect(calls).toHaveLength(7);
    expect(new Set(calls).size).toBe(7);
    expect(calls.every((c) => !c.endsWith(':a3-c1'))).toBe(true);
  });

  it('(g) a single-case run started during the batch is not throttled by the batch limiter', async () => {
    let open!: () => void;
    const gate = new Promise<void>((res) => (open = res));
    // The batch's reviews hold until `open`; a single run's review answers at once.
    const ref: { store?: Store } = {};
    const h = harness({
      review: async (input) => {
        const run = ref.store?.runs.find((r) => r.id === runIdOf(input.sessionId));
        if (run?.kind !== 'single') await gate;
        return OUTCOME;
      },
    });
    ref.store = h.store;
    for (const id of ['a1', 'a2', 'a3']) h.addAgent(id, 3);
    await h.service.runAll(WS);
    await sleep(20); // 6 batch calls are holding every slot, 3 more are queued

    const single = await h.service.startCaseRun(WS, 'a1-c1');
    const t0 = Date.now();
    while (h.store.runs.find((r) => r.id === single.id)!.status === 'running') {
      if (Date.now() - t0 > 1_000) throw new Error('the single-case run was throttled by the batch');
      await sleep(5);
    }
    expect(h.store.runs.find((r) => r.id === single.id)!.status).not.toBe('running');
    expect(h.store.runs.filter((r) => r.kind === 'suite' && r.status === 'running')).toHaveLength(3);

    open();
    await waitIdle(h.store);
  });
});
