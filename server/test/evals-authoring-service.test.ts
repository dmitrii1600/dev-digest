import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalCaseInput, EvalSuiteRun, EvalSuiteRunDetail } from '@devdigest/shared';
import { reviewPullRequest, type ReviewInput } from '@devdigest/reviewer-core';
import { EvalsService, type EvalsDeps } from '../src/modules/evals/service.js';
import type {
  CasePatch,
  EvalAgent,
  EvalOwner,
  EvalSkill,
  EvalsStore,
  InsertRunResult,
  LatestSingle,
  NewCase,
  NewCaseResult,
  NewRun,
  RunPatch,
} from '../src/modules/evals/types.js';
import { MAX_CASES_PER_AGENT } from '../src/modules/evals/constants.js';
import { caseFingerprint } from '../src/modules/evals/helpers.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { AppError } from '../src/platform/errors.js';

/**
 * Hermetic: manual cases, single-case runs, skill runs and the skill reads of the evals
 * service, over an in-memory store, a mock provider and the real review engine.
 */

const WS = 'ws-1';
const mkAgent = (id: string, version = 3): EvalAgent => ({
  id,
  name: `Agent ${id}`,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: `You review code as ${id}.`,
  strategy: 'single-pass',
  version,
});
const AGENT = mkAgent('agent-1');
const H1 = mkAgent('host-1', 2);
const H2 = mkAgent('host-2', 5);
const SKILL: EvalSkill = { id: 'skill-1', name: 'Secrets', source: 'manual', body: 'Never log secrets.', version: 4 };

const DIFF =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;';

const FINDING_FIXTURE = {
  verdict: 'comment',
  summary: 'one issue',
  score: 70,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'security',
      title: 'Odd constant',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'Because.',
      confidence: 0.9,
    },
  ],
};
const EMPTY_FIXTURE = { verdict: 'comment', summary: 'ok', score: 95, findings: [] };

const input = (over: Partial<EvalCaseInput> = {}): EvalCaseInput => ({
  name: 'Stripe-Key ',
  input_diff: DIFF,
  input_meta: { pr_title: 'Add b', pr_body: 'Adds b.' },
  expectation: 'must_find',
  target: { file: 'src/a.ts', start_line: 2, end_line: 2 },
  ...over,
});

class Store implements EvalsStore {
  cases: EvalCase[] = [];
  runs: EvalSuiteRun[] = [];
  newRuns: NewRun[] = [];
  results: (NewCaseResult & { runId: string })[] = [];
  private seq = 0;
  private clock = 0;

  async findingSource(): Promise<undefined> {
    return undefined;
  }
  async prFilePatch(): Promise<null> {
    return null;
  }
  async countCases(_ws: string, owner: EvalOwner): Promise<number> {
    return this.cases.filter((c) => c.owner_kind === owner.kind && c.owner_id === owner.id).length;
  }
  async insertCaseIfAbsent(): Promise<never> {
    throw new Error('not used');
  }
  async insertCase(row: NewCase): Promise<EvalCase> {
    const c: EvalCase = {
      id: `case-${++this.seq}`,
      owner_kind: row.ownerKind,
      owner_id: row.ownerId,
      name: row.name,
      expectation: row.expectation,
      target: row.target,
      source: row.source,
      source_finding_id: row.sourceFindingId,
      fingerprint: row.fingerprint,
      input_diff: row.inputDiff,
      input_files: null,
      input_meta: row.inputMeta,
      expected_output: row.expectedOutput,
      notes: null,
      created_at: '2026-10-05T00:00:00.000Z',
    };
    this.cases.push(c);
    return { ...c };
  }
  async updateCase(_ws: string, id: string, patch: CasePatch): Promise<EvalCase | undefined> {
    const c = this.cases.find((x) => x.id === id);
    if (!c) return undefined;
    Object.assign(c, {
      name: patch.name,
      input_diff: patch.inputDiff,
      input_meta: patch.inputMeta,
      expectation: patch.expectation,
      target: patch.target,
      fingerprint: patch.fingerprint,
    });
    return { ...c };
  }
  async caseNames(_ws: string, owner: EvalOwner, excludeId?: string): Promise<string[]> {
    return this.cases
      .filter((c) => c.owner_kind === owner.kind && c.owner_id === owner.id && c.id !== excludeId)
      .map((c) => c.name);
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
    const active = this.runs.find((r) => {
      if (r.status !== 'running' || r.kind !== row.kind) return false;
      if (row.kind === 'single') return this.newRuns.find((n) => n.id === r.id)?.singleCaseId === row.singleCaseId;
      return r.owner_id === row.ownerId;
    });
    if (active) return { ok: false, reason: 'already_running', kind: row.kind, runId: active.id };
    this.newRuns.push(row);
    const run: EvalSuiteRun = {
      id: row.id,
      kind: row.kind,
      owner_kind: row.ownerKind,
      owner_id: row.ownerId,
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
  async failStaleRunning(_ws: string, activeIds: readonly string[], reason: string): Promise<void> {
    for (const r of this.runs) {
      if (r.status === 'running' && !activeIds.includes(r.id)) Object.assign(r, { status: 'failed', error: reason });
    }
  }
  async listRuns(
    _ws: string,
    owner: EvalOwner,
    opts: { limit: number; statuses?: readonly EvalSuiteRun['status'][]; order?: 'asc' | 'desc' },
  ): Promise<EvalSuiteRun[]> {
    const rows = this.runs
      .filter(
        (r) =>
          r.kind === 'suite' &&
          r.owner_kind === owner.kind &&
          r.owner_id === owner.id &&
          (!opts.statuses || opts.statuses.includes(r.status)),
      )
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    if (opts.order !== 'asc') rows.reverse();
    return rows.slice(0, opts.limit);
  }
  async getRun(_ws: string, id: string): Promise<EvalSuiteRun | undefined> {
    return this.runs.find((r) => r.id === id && r.kind === 'suite' && r.owner_kind === 'agent');
  }
  async getRunWithResults(_ws: string, id: string): Promise<EvalSuiteRunDetail | undefined> {
    const run = this.runs.find((r) => r.id === id);
    return run ? { ...run, results: [] } : undefined;
  }
  async caseStatusesForRun(runId: string) {
    return this.results.filter((r) => r.runId === runId).map((r) => ({ caseId: r.caseId, status: r.status }));
  }
  async latestCompletedRuns(ws: string, owner: EvalOwner, n: number) {
    return this.listRuns(ws, owner, { limit: n, statuses: ['completed', 'partial'] });
  }
  async agentsWithCases() {
    return [];
  }
  async recentRuns(): Promise<EvalSuiteRun[]> {
    return [];
  }
  async latestSingleByCase(_ws: string, caseIds: readonly string[]): Promise<Map<string, LatestSingle>> {
    const out = new Map<string, LatestSingle>();
    for (const r of this.results) {
      const run = this.runs.find((x) => x.id === r.runId);
      if (!run || run.kind !== 'single' || !caseIds.includes(r.caseId)) continue;
      const cur = out.get(r.caseId);
      if (!cur || run.started_at > cur.startedAt) out.set(r.caseId, { runId: run.id, status: r.status, startedAt: run.started_at });
    }
    return out;
  }
  async latestCaseResult() {
    return undefined;
  }
  async runningSingle(_ws: string, caseId: string): Promise<EvalSuiteRun | undefined> {
    return this.runs.find(
      (r) => r.status === 'running' && this.newRuns.find((n) => n.id === r.id)?.singleCaseId === caseId,
    );
  }
}

interface Harness {
  store: Store;
  service: EvalsService;
  mocks: MockLLMProvider[];
  reviewInputs: ReviewInput[];
  logs: { obj: Record<string, unknown>; msg?: string }[];
  fixture: { value: unknown };
}

function harness(over: Partial<EvalsDeps> = {}, linked: string[] = [H1.id, H2.id]): Harness {
  const store = new Store();
  const mocks: MockLLMProvider[] = [];
  const reviewInputs: ReviewInput[] = [];
  const logs: Harness['logs'] = [];
  const fixture = { value: EMPTY_FIXTURE as unknown };
  const agents = new Map([AGENT, H1, H2].map((a) => [a.id, a]));
  const service = new EvalsService({
    repo: store,
    agents: { getById: async (_ws, id) => agents.get(id) },
    skills: {
      blocksForAgent: async () => [],
      getById: async (_ws, id) => (id === SKILL.id ? SKILL : undefined),
      linkedAgentIds: async () => linked,
    },
    git: async () => ({
      diff: async () => {
        throw new Error('git must not be used');
      },
    }),
    parseDiff: parseUnifiedDiff,
    llm: async () => {
      const m = new MockLLMProvider('openai', { structured: fixture.value });
      mocks.push(m);
      return m;
    },
    review: async (i) => {
      reviewInputs.push(i);
      return reviewPullRequest(i);
    },
    log: {
      info: (obj, msg) => logs.push({ obj: obj as Record<string, unknown>, msg }),
      warn: () => {},
      error: (obj, msg) => logs.push({ obj: obj as Record<string, unknown>, msg }),
    },
    caseTimeoutMs: 120_000,
    adapterTimeoutMs: 125_000,
    concurrency: 3,
    ...over,
  });
  return { store, service, mocks, reviewInputs, logs, fixture };
}

const providerCalls = (h: Harness) => h.mocks.flatMap((m) => m.calls);

async function waitDone(store: Store, runId: string, ms = 5_000): Promise<EvalSuiteRun> {
  const t0 = Date.now();
  for (;;) {
    const r = store.runs.find((x) => x.id === runId)!;
    if (r.status !== 'running') return r;
    if (Date.now() - t0 > ms) throw new Error('run did not finish in time');
    await new Promise((res) => setTimeout(res, 5));
  }
}

const reason = (e: unknown) => (e as AppError).details as Record<string, unknown>;
const reject = async (p: Promise<unknown>): Promise<AppError> => (await p.catch((e: unknown) => e)) as AppError;

describe('EvalsService.createManualCase', () => {
  it('AC-6: stores a manual case with its fingerprint and makes no model call', async () => {
    const h = harness();
    const c = await h.service.createManualCase(WS, { kind: 'agent', id: AGENT.id }, input());
    expect(c.source).toBe('manual');
    expect(c.source_finding_id).toBeNull();
    expect(c.name).toBe('Stripe-Key');
    expect(c.input_diff).toBe(DIFF);
    expect(c.fingerprint).toBe(
      caseFingerprint({
        input_diff: DIFF,
        pr_title: 'Add b',
        pr_body: 'Adds b.',
        expectation: 'must_find',
        file: 'src/a.ts',
        start_line: 2,
        end_line: 2,
      }),
    );
    expect(providerCalls(h)).toHaveLength(0);
    expect(h.reviewInputs).toHaveLength(0);
  });

  it('AC-6: the case limit rejects at 200 and accepts at 199', async () => {
    const h = harness();
    const owner: EvalOwner = { kind: 'agent', id: AGENT.id };
    for (let i = 0; i < MAX_CASES_PER_AGENT - 1; i++) {
      await h.store.insertCase({
        workspaceId: WS,
        ownerKind: 'agent',
        ownerId: AGENT.id,
        name: `seed ${i}`,
        inputDiff: DIFF,
        inputMeta: { pr_title: '', pr_body: '' },
        expectedOutput: { title: null, severity: null, category: null },
        source: 'manual',
        sourceFindingId: null,
        expectation: 'must_find',
        target: { file: 'src/a.ts', start_line: 2, end_line: 2 },
        fingerprint: `fp-${i}`,
      });
    }
    await expect(h.service.createManualCase(WS, owner, input({ name: 'the 200th' }))).resolves.toBeDefined();
    const err = await reject(h.service.createManualCase(WS, owner, input({ name: 'the 201st' })));
    expect(err.statusCode).toBe(422);
    expect(reason(err)).toMatchObject({ reason: 'case_limit' });
  });

  it('rejects an unknown owner with 404', async () => {
    const h = harness();
    expect((await reject(h.service.createManualCase(WS, { kind: 'agent', id: 'nope' }, input()))).statusCode).toBe(404);
    expect((await reject(h.service.createManualCase(WS, { kind: 'skill', id: 'nope' }, input()))).statusCode).toBe(404);
  });

  it('EC-1 / EC-3: names the diff, file and range problems with a reason and a field', async () => {
    const h = harness();
    const owner: EvalOwner = { kind: 'skill', id: SKILL.id };
    const bare2 =
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n x\n+y\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,1 +1,2 @@\n x\n+y';
    expect(reason(await reject(h.service.createManualCase(WS, owner, input({ input_diff: bare2 }))))).toEqual({
      reason: 'diff_needs_git_headers',
      field: 'input_diff',
    });
    expect(reason(await reject(h.service.createManualCase(WS, owner, input({ input_diff: '@@ -1 +1 @@\n+x' }))))).toEqual({
      reason: 'diff_unparseable',
      field: 'input_diff',
    });
    expect(
      reason(await reject(h.service.createManualCase(WS, owner, input({ target: { file: 'src/b.ts', start_line: 2, end_line: 2 } })))),
    ).toEqual({ reason: 'target_file_not_in_diff', field: 'target.file' });
    expect(
      reason(await reject(h.service.createManualCase(WS, owner, input({ target: { file: 'src/a.ts', start_line: 9, end_line: 10 } })))),
    ).toEqual({ reason: 'target_outside_changes', field: 'target' });
  });

  it('EC-5 / Q3: a name clash is trimmed and case-insensitive within the owner, and per owner', async () => {
    const h = harness();
    const owner: EvalOwner = { kind: 'agent', id: AGENT.id };
    await h.service.createManualCase(WS, owner, input({ name: 'Stripe-Key ' }));
    const err = await reject(h.service.createManualCase(WS, owner, input({ name: 'stripe-key' })));
    expect(err.statusCode).toBe(422);
    expect(reason(err)).toEqual({ reason: 'name_taken', field: 'name' });
    // the same name under another owner is free
    await expect(
      h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input({ name: 'stripe-key' })),
    ).resolves.toBeDefined();
  });
});

describe('EvalsService.updateCase', () => {
  it('AC-8 / EC-12: keeps source and link; a rename keeps the fingerprint, a target change changes it', async () => {
    const h = harness();
    const owner: EvalOwner = { kind: 'agent', id: AGENT.id };
    const made = await h.service.createManualCase(WS, owner, input());
    // pretend the case came from a finding: edits must keep its origin
    Object.assign(h.store.cases[0]!, { source: 'finding', source_finding_id: 'finding-1' });

    const renamed = await h.service.updateCase(WS, made.id, input({ name: 'Renamed' }));
    expect(renamed.id).toBe(made.id);
    expect(renamed.name).toBe('Renamed');
    expect(renamed.fingerprint).toBe(made.fingerprint);
    expect(renamed.source).toBe('finding');
    expect(renamed.source_finding_id).toBe('finding-1');

    const moved = await h.service.updateCase(
      WS,
      made.id,
      input({ name: 'Renamed', expectation: 'must_not_flag', target: { file: 'src/a.ts', start_line: 1, end_line: 3 } }),
    );
    expect(moved.fingerprint).not.toBe(made.fingerprint);
    expect(moved.source).toBe('finding');
    expect(providerCalls(h)).toHaveLength(0);
  });

  it('allows a case to keep its own name but not take another case’s', async () => {
    const h = harness();
    const owner: EvalOwner = { kind: 'agent', id: AGENT.id };
    const a = await h.service.createManualCase(WS, owner, input({ name: 'Alpha' }));
    await h.service.createManualCase(WS, owner, input({ name: 'Beta' }));
    await expect(h.service.updateCase(WS, a.id, input({ name: 'alpha' }))).resolves.toBeDefined();
    expect(reason(await reject(h.service.updateCase(WS, a.id, input({ name: ' BETA' }))))).toEqual({
      reason: 'name_taken',
      field: 'name',
    });
    expect((await reject(h.service.updateCase(WS, 'nope', input()))).statusCode).toBe(404);
  });
});

describe('EvalsService.startCaseRun', () => {
  it('AC-9 / AC-10 / NFR-2: one single-attempt call, recorded as a single run with version, skills and fingerprint', async () => {
    const h = harness();
    const c = await h.service.createManualCase(WS, { kind: 'agent', id: AGENT.id }, input());
    const run = await h.service.startCaseRun(WS, c.id);
    expect(run.kind).toBe('single');
    expect(run.status).toBe('running');
    const done = await waitDone(h.store, run.id);

    expect(done.agent_version).toBe(AGENT.version);
    expect(done.skills).toEqual([]);
    expect(done.cases).toEqual([{ case_id: c.id, fingerprint: c.fingerprint }]);
    expect(h.store.newRuns[0]!.singleCaseId).toBe(c.id);
    expect(h.store.newRuns[0]!.ownerKind).toBe('agent');
    expect(providerCalls(h).map((x) => x.method)).toEqual(['completeStructured']);
    const req = providerCalls(h)[0]!.req as { maxRetries?: number; timeoutMs?: number };
    expect(req.maxRetries).toBe(0);
    expect(req.timeoutMs).toBe(125_000);
    expect(h.store.results).toHaveLength(1);
  });

  it('EC-8: a second start of the same case is 409; a suite of the same agent does not block it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const h = harness({
      review: async (i) => {
        await gate;
        return reviewPullRequest(i);
      },
    });
    const owner: EvalOwner = { kind: 'agent', id: AGENT.id };
    const c = await h.service.createManualCase(WS, owner, input());
    const first = await h.service.startCaseRun(WS, c.id);
    const second = await reject(h.service.startCaseRun(WS, c.id));
    expect(second.statusCode).toBe(409);
    expect(second.code).toBe('eval_case_run_in_progress');
    expect(second.details).toEqual({ run_id: first.id });

    // a suite of the same agent, while the single run is running
    const suite = await h.service.startRun(WS, AGENT.id);
    expect(suite.kind).toBe('suite');
    // and a single run starts while the suite is running (other case)
    const other = await h.service.createManualCase(WS, owner, input({ name: 'Other' }));
    expect((await h.service.startCaseRun(WS, other.id)).kind).toBe('single');
    release();
    await waitDone(h.store, first.id);
    await waitDone(h.store, suite.id);
  });

  it('EC-9: a provider that cannot be built errors the case with the reason and fails the run', async () => {
    const h = harness({
      llm: async () => {
        throw new Error('OPENAI_API_KEY is not configured');
      },
    });
    const c = await h.service.createManualCase(WS, { kind: 'agent', id: AGENT.id }, input());
    const run = await h.service.startCaseRun(WS, c.id);
    const done = await waitDone(h.store, run.id);
    expect(done.status).toBe('failed');
    expect(h.store.results[0]!.status).toBe('errored');
    expect(h.store.results[0]!.error).toBe('OPENAI_API_KEY is not configured');
  });

  it('a host agent is refused for an agent case and required for a skill case', async () => {
    const h = harness();
    const agentCase = await h.service.createManualCase(WS, { kind: 'agent', id: AGENT.id }, input());
    const skillCase = await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const a = await reject(h.service.startCaseRun(WS, agentCase.id, H1.id));
    expect(a.statusCode).toBe(422);
    expect(a.code).toBe('eval_host_invalid');
    expect(reason(a)).toEqual({ reason: 'host_not_allowed' });
    const b = await reject(h.service.startCaseRun(WS, skillCase.id));
    expect(reason(b)).toEqual({ reason: 'host_required' });
    expect((await reject(h.service.startCaseRun(WS, 'nope'))).statusCode).toBe(404);
    expect(providerCalls(h)).toHaveLength(0);
  });

  it('a skill case runs on a linked host with only the skill, at its current version', async () => {
    const h = harness();
    const c = await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const run = await h.service.startCaseRun(WS, c.id, H1.id);
    const done = await waitDone(h.store, run.id);
    expect(done.kind).toBe('single');
    expect(done.owner_kind).toBe('skill');
    expect(done.agent_id).toBe(H1.id);
    expect(done.agent_version).toBe(H1.version);
    expect(done.skills).toEqual([{ skill_id: SKILL.id, name: SKILL.name, version: SKILL.version }]);
  });

  it('EC-11: an unlinked or missing host is refused before any review call', async () => {
    const h = harness({}, [H1.id]);
    const c = await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const unlinked = await reject(h.service.startCaseRun(WS, c.id, H2.id));
    expect(unlinked.statusCode).toBe(422);
    expect(reason(unlinked)).toEqual({ reason: 'host_not_linked', host_agent_id: H2.id });
    expect((await reject(h.service.startCaseRun(WS, c.id, 'deleted-host'))).statusCode).toBe(404);
    expect(providerCalls(h)).toHaveLength(0);
    expect(h.reviewInputs).toHaveLength(0);
  });
});

describe('EvalsService.startSkillRun', () => {
  it('AC-15: reviews with the host prompt, model and strategy and exactly one skill block', async () => {
    const h = harness();
    await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const run = await h.service.startSkillRun(WS, SKILL.id, H1.id);
    expect(run.kind).toBe('suite');
    expect(run.owner_kind).toBe('skill');
    expect(run.owner_id).toBe(SKILL.id);
    const done = await waitDone(h.store, run.id);

    expect(done.agent_id).toBe(H1.id);
    expect(done.agent_version).toBe(H1.version);
    expect(done.skills).toEqual([{ skill_id: SKILL.id, name: SKILL.name, version: SKILL.version }]);
    const i = h.reviewInputs[0]!;
    expect(i.skills).toEqual([SKILL.body]);
    expect(i.systemPrompt).toBe(H1.systemPrompt);
    expect(i.model).toBe(H1.model);
    expect(i.strategy).toBe(H1.strategy);
  });

  it('wraps a non-manual skill body as untrusted', async () => {
    const h = harness();
    const imported: EvalSkill = { ...SKILL, source: 'imported_url', body: 'Do the thing.' };
    h.service['deps'].skills.getById = async () => imported;
    await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const run = await h.service.startSkillRun(WS, SKILL.id, H1.id);
    await waitDone(h.store, run.id);
    const body = h.reviewInputs[0]!.skills![0]!;
    expect(body).not.toBe('Do the thing.');
    expect(body).toContain('Do the thing.');
  });

  it('EC-11: an unlinked or missing host, or an empty set, is refused with no review call', async () => {
    const h = harness({}, [H1.id]);
    expect((await reject(h.service.startSkillRun(WS, SKILL.id, H1.id))).code).toBe('eval_set_empty');
    await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const unlinked = await reject(h.service.startSkillRun(WS, SKILL.id, H2.id));
    expect(unlinked.statusCode).toBe(422);
    expect(unlinked.code).toBe('eval_host_invalid');
    expect((await reject(h.service.startSkillRun(WS, SKILL.id, 'gone'))).statusCode).toBe(404);
    expect((await reject(h.service.startSkillRun(WS, 'no-skill', H1.id))).statusCode).toBe(404);
    expect(providerCalls(h)).toHaveLength(0);
    expect(h.reviewInputs).toHaveLength(0);
  });

  it('a skill suite and the host’s own suite do not block each other, and a second skill suite is 409', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const h = harness({
      review: async (i) => {
        await gate;
        return reviewPullRequest(i);
      },
    });
    await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    await h.service.createManualCase(WS, { kind: 'agent', id: H1.id }, input());
    const skillRun = await h.service.startSkillRun(WS, SKILL.id, H1.id);
    const hostRun = await h.service.startRun(WS, H1.id);
    expect(hostRun.owner_kind).toBe('agent');
    const again = await reject(h.service.startSkillRun(WS, SKILL.id, H1.id));
    expect(again.statusCode).toBe(409);
    expect(again.code).toBe('eval_run_in_progress');
    release();
    await waitDone(h.store, skillRun.id);
    await waitDone(h.store, hostRun.id);
  });
});

describe('EvalsService skill reads', () => {
  it('AC-16: the dashboard delta compares with the previous run on the SAME host', async () => {
    const h = harness();
    await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const run = async (host: string, fixture: unknown) => {
      h.fixture.value = fixture;
      const r = await h.service.startSkillRun(WS, SKILL.id, host);
      return waitDone(h.store, r.id);
    };
    const a = await run(H1.id, EMPTY_FIXTURE); // recall 0
    const b = await run(H2.id, FINDING_FIXTURE); // recall 1
    const c = await run(H1.id, FINDING_FIXTURE); // recall 1
    expect([a.metrics.recall, b.metrics.recall, c.metrics.recall]).toEqual([0, 1, 1]);

    const dash = await h.service.skillDashboard(WS, SKILL.id);
    expect(dash.owner_kind).toBe('skill');
    expect(dash.owner_name).toBe(SKILL.name);
    expect(dash.current?.recall).toBe(1);
    // against run a (same host, recall 0), not run b (recall 1, delta would be 0)
    expect(dash.delta.recall).toBe(100);
    expect(dash.delta.cases_passed).toBe(1);
    expect(dash.trend).toHaveLength(3);
    expect(dash.regressions).toEqual([]);
    expect(dash.alert).toBeNull();
    expect(dash.running).toBeNull();

    // the first run on a host has no previous run on that host
    const first = await h.service.skillDashboard(WS, SKILL.id);
    expect(first.recent_runs.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  it('a skill with a single host run has null deltas', async () => {
    const h = harness();
    await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const r = await h.service.startSkillRun(WS, SKILL.id, H1.id);
    await waitDone(h.store, r.id);
    const dash = await h.service.skillDashboard(WS, SKILL.id);
    expect(dash.delta).toEqual({ recall: null, precision: null, citation_accuracy: null, cases_passed: null });
    expect((await reject(h.service.skillDashboard(WS, 'nope'))).statusCode).toBe(404);
  });

  it('AC-13: a single run newer than the latest suite sets latest_single; an older one leaves it null', async () => {
    const h = harness();
    const owner: EvalOwner = { kind: 'agent', id: AGENT.id };
    const c = await h.service.createManualCase(WS, owner, input());

    // single first (older), then a suite
    const s1 = await h.service.startCaseRun(WS, c.id);
    await waitDone(h.store, s1.id);
    const suite = await h.service.startRun(WS, AGENT.id);
    await waitDone(h.store, suite.id);
    let list = await h.service.listCases(WS, AGENT.id);
    expect(list.cases[0]!.latest_single).toBeNull();
    expect(list.cases[0]!.last_result).toBe('failed');
    expect(list.latest_run_id).toBe(suite.id);

    // a newer single
    const s2 = await h.service.startCaseRun(WS, c.id);
    await waitDone(h.store, s2.id);
    list = await h.service.listCases(WS, AGENT.id);
    expect(list.cases[0]!.latest_single).toMatchObject({ run_id: s2.id, status: 'failed' });
    // the suite result stays the row's main result
    expect(list.cases[0]!.last_result).toBe('failed');
    expect(list.passing).toBe(0);
  });

  it('a single run alone (no suite yet) is the marker, and the main result is never_run', async () => {
    const h = harness();
    const c = await h.service.createManualCase(WS, { kind: 'agent', id: AGENT.id }, input());
    const s = await h.service.startCaseRun(WS, c.id);
    await waitDone(h.store, s.id);
    const list = await h.service.listCases(WS, AGENT.id);
    expect(list.cases[0]!.last_result).toBe('never_run');
    expect(list.cases[0]!.latest_single?.run_id).toBe(s.id);
  });

  it('a skill’s case list and run list exclude single runs, and 404 for an unknown skill', async () => {
    const h = harness();
    const c = await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const s = await h.service.startCaseRun(WS, c.id, H1.id);
    await waitDone(h.store, s.id);
    expect(await h.service.listSkillRuns(WS, SKILL.id)).toEqual([]);
    expect((await h.service.listSkillCases(WS, SKILL.id)).cases[0]!.latest_single?.run_id).toBe(s.id);
    expect((await reject(h.service.listSkillCases(WS, 'nope'))).statusCode).toBe(404);
    expect((await reject(h.service.listSkillRuns(WS, 'nope'))).statusCode).toBe(404);
  });

  it('caseRunState 404s for an unknown case and reads the store otherwise', async () => {
    const h = harness();
    expect((await reject(h.service.caseRunState(WS, 'nope'))).statusCode).toBe(404);
    const c = await h.service.createManualCase(WS, { kind: 'agent', id: AGENT.id }, input());
    expect(await h.service.caseRunState(WS, c.id)).toEqual({ latest: null, running: null });
  });
});

describe('NFR-7: run logs', () => {
  it('the finished entry carries kind, owner, case, version, skills, status and the error', async () => {
    const h = harness({
      review: async () => {
        throw new Error('boom');
      },
    });
    const c = await h.service.createManualCase(WS, { kind: 'skill', id: SKILL.id }, input());
    const run = await h.service.startCaseRun(WS, c.id, H2.id);
    await waitDone(h.store, run.id);
    await new Promise((res) => setTimeout(res, 10));

    const started = h.logs.find((l) => l.msg === 'eval run started')!;
    expect(started.obj).toMatchObject({ runId: run.id, kind: 'single', ownerKind: 'skill', ownerId: SKILL.id, caseId: c.id });
    const finished = h.logs.find((l) => l.msg === 'eval run finished')!;
    expect(finished.obj).toMatchObject({
      runId: run.id,
      kind: 'single',
      ownerKind: 'skill',
      ownerId: SKILL.id,
      caseId: c.id,
      agentId: H2.id,
      agentVersion: H2.version,
      skills: [{ id: SKILL.id, version: SKILL.version }],
      status: 'failed',
      error: 'boom',
    });
  });
});
