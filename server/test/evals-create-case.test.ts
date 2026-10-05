import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalSuiteRun, UnifiedDiff } from '@devdigest/shared';
import { EvalsService, type EvalsDeps } from '../src/modules/evals/service.js';
import type {
  AgentWithCases,
  EvalAgent,
  EvalsStore,
  FindingSource,
  NewCase,
} from '../src/modules/evals/types.js';
import { caseFingerprint, patchToFileDiff } from '../src/modules/evals/helpers.js';
import {
  MAX_CASE_NAME_CHARS,
  MAX_CASES_PER_AGENT,
  MAX_FROZEN_DIFF_BYTES,
  MAX_PR_BODY_BYTES,
  MAX_PR_TITLE_CHARS,
} from '../src/modules/evals/constants.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';

/**
 * Hermetic: EvalsService on an in-memory store, no Postgres. Covers what
 * `evals-service.test.ts` (the run executor) does not: freezing a decided
 * finding into a case (AC-2, AC-3, EC-1, EC-3, EC-12), the case list and its
 * "N / M passing" numbers (AC-4), delete, and the two dashboards (AC-10, AC-15,
 * EC-8, NFR-12). The SQL-level guarantees (unique source finding, FK set null,
 * cascade) stay in `evals.it.test.ts`.
 */

const WS = 'ws-1';
const AGENT: EvalAgent = {
  id: 'agent-1',
  name: 'Security reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You review code.',
  strategy: 'single-pass',
  version: 2,
};

const PATCH = '@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;';

function source(over: {
  finding?: Partial<FindingSource['finding']>;
  agentId?: string | null;
  pull?: Partial<FindingSource['pull']>;
} = {}): FindingSource {
  return {
    finding: {
      id: 'finding-1',
      title: 'Hardcoded secret',
      severity: 'CRITICAL',
      category: 'security',
      file: 'src/a.ts',
      startLine: 2,
      endLine: 2,
      acceptedAt: new Date('2026-10-05T10:00:00Z'),
      dismissedAt: null,
      ...over.finding,
    },
    agentId: over.agentId === undefined ? AGENT.id : over.agentId,
    pull: {
      id: 'pr-1',
      number: 7,
      title: 'Add config',
      body: 'Adds the config loader.',
      base: 'main',
      headSha: 'abc123',
      ...over.pull,
    },
    repo: { owner: 'acme', name: 'api' },
  };
}

class Store implements EvalsStore {
  src: FindingSource | undefined = source();
  patch: string | null = PATCH;
  count = 0;
  inserted: NewCase[] = [];
  cases: EvalCase[] = [];
  runs: EvalSuiteRun[] = [];
  statuses: { caseId: string; status: 'passed' | 'failed' | 'errored' }[] = [];
  withCases: AgentWithCases[] = [];
  deleteResult = true;

  async findingSource() {
    return this.src;
  }
  async prFilePatch() {
    return this.patch;
  }
  async countCases() {
    return this.count;
  }
  async insertCaseIfAbsent(row: NewCase) {
    this.inserted.push(row);
    const c = { id: 'case-new', name: row.name } as unknown as EvalCase;
    return { case: c, created: true };
  }
  async listCases() {
    return this.cases;
  }
  async getCase() {
    return undefined;
  }
  async deleteCase() {
    return this.deleteResult;
  }
  async insertRunningRun(): Promise<never> {
    throw new Error('not used');
  }
  async insertCaseResult() {}
  async finishRun() {}
  async failStaleRunning() {}
  async listRuns(
    _ws: string,
    agentId: string,
    opts: { limit: number; statuses?: readonly EvalSuiteRun['status'][]; order?: 'asc' | 'desc' },
  ) {
    const rows = this.runs
      .filter((r) => r.agent_id === agentId && (!opts.statuses || opts.statuses.includes(r.status)))
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    if (opts.order !== 'asc') rows.reverse();
    return rows.slice(0, opts.limit);
  }
  async getRun() {
    return undefined;
  }
  async getRunWithResults() {
    return undefined;
  }
  async caseStatusesForRun() {
    return this.statuses;
  }
  async latestCompletedRuns(ws: string, agentId: string, n: number) {
    return this.listRuns(ws, agentId, { limit: n, statuses: ['completed', 'partial'] });
  }
  async agentsWithCases() {
    return this.withCases;
  }
  async recentRuns() {
    return [...this.runs].reverse();
  }
}

interface Gits {
  calls: unknown[][];
  raw: string | Error;
}

function harness(over: Partial<EvalsDeps> = {}) {
  const store = new Store();
  const git: Gits = { calls: [], raw: '' };
  const service = new EvalsService({
    repo: store,
    agents: { getById: async (_ws, id) => (id === AGENT.id ? AGENT : undefined) },
    skills: { blocksForAgent: async () => [] },
    git: async () => ({
      diff: async (...args: unknown[]) => {
        git.calls.push(args);
        if (git.raw instanceof Error) throw git.raw;
        return { raw: git.raw } as unknown as UnifiedDiff;
      },
    }),
    parseDiff: parseUnifiedDiff,
    llm: async () => {
      throw new Error('a case is created without any model call');
    },
    review: async () => {
      throw new Error('a case is created without any review');
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    caseTimeoutMs: 1000,
    adapterTimeoutMs: 1500,
    concurrency: 3,
    ...over,
  });
  return { store, git, service };
}

const reasonOf = (e: unknown) => (e as AppError).details as { reason: string };

describe('EvalsService.createFromFinding', () => {
  it('AC-2: an accepted finding becomes a must_find case with the frozen inputs, with no model call', async () => {
    const { store, service } = harness();
    const res = await service.createFromFinding(WS, 'finding-1');
    expect(res.created).toBe(true);

    expect(store.inserted).toHaveLength(1);
    const row = store.inserted[0]!;
    expect(row).toMatchObject({
      workspaceId: WS,
      ownerId: AGENT.id,
      name: 'Hardcoded secret',
      expectation: 'must_find',
      sourceFindingId: 'finding-1',
      target: { file: 'src/a.ts', start_line: 2, end_line: 2 },
      inputMeta: { pr_title: 'Add config', pr_body: 'Adds the config loader.' },
      expectedOutput: { title: 'Hardcoded secret', severity: 'CRITICAL', category: 'security' },
    });
    expect(row.inputDiff).toBe(patchToFileDiff('src/a.ts', PATCH));
    // The fingerprint covers exactly the frozen inputs, expectation and target (EC-9 relies on it).
    expect(row.fingerprint).toBe(
      caseFingerprint({
        input_diff: row.inputDiff,
        pr_title: 'Add config',
        pr_body: 'Adds the config loader.',
        expectation: 'must_find',
        file: 'src/a.ts',
        start_line: 2,
        end_line: 2,
      }),
    );
  });

  it('AC-3: a dismissed finding becomes a must_not_flag case', async () => {
    const { store, service } = harness();
    store.src = source({ finding: { acceptedAt: null, dismissedAt: new Date('2026-10-05T10:00:00Z') } });
    await service.createFromFinding(WS, 'finding-1');
    expect(store.inserted[0]!.expectation).toBe('must_not_flag');
  });

  it('EC-1: an undecided finding is rejected with finding_undecided and nothing is stored', async () => {
    const { store, service } = harness();
    store.src = source({ finding: { acceptedAt: null, dismissedAt: null } });
    const err = await service.createFromFinding(WS, 'finding-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(422);
    expect((err as AppError).code).toBe('eval_case_rejected');
    expect(reasonOf(err).reason).toBe('finding_undecided');
    expect(store.inserted).toHaveLength(0);
  });

  it('EC-3: an unknown finding, a review with no agent, or a deleted agent is a 404', async () => {
    const missing = harness();
    missing.store.src = undefined;
    await expect(missing.service.createFromFinding(WS, 'x')).rejects.toBeInstanceOf(NotFoundError);

    const noAgent = harness();
    noAgent.store.src = source({ agentId: null });
    await expect(noAgent.service.createFromFinding(WS, 'x')).rejects.toMatchObject({ statusCode: 404 });

    const gone = harness();
    gone.store.src = source({ agentId: 'deleted-agent' });
    await expect(gone.service.createFromFinding(WS, 'x')).rejects.toMatchObject({ statusCode: 404 });
    for (const h of [missing, noAgent, gone]) expect(h.store.inserted).toHaveLength(0);
  });

  it('refuses the 201st case of an agent (case_limit) but takes the 200th', async () => {
    const { store, service } = harness();
    store.count = MAX_CASES_PER_AGENT;
    const err = await service.createFromFinding(WS, 'finding-1').catch((e: unknown) => e);
    expect(reasonOf(err).reason).toBe('case_limit');
    store.count = MAX_CASES_PER_AGENT - 1;
    await expect(service.createFromFinding(WS, 'finding-1')).resolves.toMatchObject({ created: true });
  });

  it('falls back to the real git diff, and takes only the block of that exact path', async () => {
    const { store, git, service } = harness();
    store.patch = null;
    git.raw = [
      'diff --git a/src/a.tsx b/src/a.tsx',
      '--- a/src/a.tsx',
      '+++ b/src/a.tsx',
      '@@ -1 +1 @@',
      '-x',
      '+tsx-only',
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '+ts-only',
      ' keep',
    ].join('\n');
    await service.createFromFinding(WS, 'finding-1');

    expect(git.calls).toEqual([[{ owner: 'acme', name: 'api' }, 'main', 'abc123']]);
    const frozen = store.inserted[0]!.inputDiff;
    expect(frozen).toContain('+ts-only');
    expect(frozen).not.toContain('tsx-only');
  });

  it('is diff_unavailable when neither a stored patch nor git has the file', async () => {
    const noBlock = harness();
    noBlock.store.patch = null;
    noBlock.git.raw = 'diff --git a/other.ts b/other.ts\n@@ -1 +1 @@\n-a\n+b';
    const e1 = await noBlock.service.createFromFinding(WS, 'finding-1').catch((e: unknown) => e);
    expect(reasonOf(e1).reason).toBe('diff_unavailable');

    const gitDown = harness();
    gitDown.store.patch = null;
    gitDown.git.raw = new Error('clone missing');
    const e2 = await gitDown.service.createFromFinding(WS, 'finding-1').catch((e: unknown) => e);
    expect(reasonOf(e2).reason).toBe('diff_unavailable');
    expect(noBlock.store.inserted).toHaveLength(0);
    expect(gitDown.store.inserted).toHaveLength(0);
  });

  it('EC-12: an oversized patch keeps only the hunk overlapping the finding; one oversized hunk is diff_too_large', async () => {
    const small = '@@ -1,2 +1,3 @@\n a\n+small-hunk\n b';
    const far = `@@ -400,2 +400,3 @@\n+${'y'.repeat(MAX_FROZEN_DIFF_BYTES)}`;
    const trimmed = harness();
    trimmed.store.patch = `${small}\n${far}`;
    await trimmed.service.createFromFinding(WS, 'finding-1');
    const frozen = trimmed.store.inserted[0]!.inputDiff;
    expect(frozen).toContain('small-hunk');
    expect(frozen).not.toContain('yyyy');
    expect(Buffer.byteLength(frozen)).toBeLessThanOrEqual(MAX_FROZEN_DIFF_BYTES);

    const huge = harness();
    huge.store.patch = `@@ -1,2 +1,3 @@\n+${'y'.repeat(MAX_FROZEN_DIFF_BYTES)}`;
    const err = await huge.service.createFromFinding(WS, 'finding-1').catch((e: unknown) => e);
    expect((err as AppError).statusCode).toBe(422);
    expect(reasonOf(err).reason).toBe('diff_too_large');
    expect(huge.store.inserted).toHaveLength(0);

    // An oversized patch that does not touch the finding's lines cannot be frozen either.
    const away = harness();
    away.store.patch = far;
    const err2 = await away.service.createFromFinding(WS, 'finding-1').catch((e: unknown) => e);
    expect(reasonOf(err2).reason).toBe('target_outside_diff');
  });

  it('caps the name at 120 chars, the PR title at 300 and the PR body at 16 KB without cutting a code point', async () => {
    const { store, service } = harness();
    store.src = source({
      finding: { title: 'n'.repeat(MAX_CASE_NAME_CHARS + 1) },
      pull: {
        title: 't'.repeat(MAX_PR_TITLE_CHARS + 1),
        // a 3-byte char straddles byte 16 384
        body: 'a'.repeat(MAX_PR_BODY_BYTES - 1) + '€' + 'tail',
      },
    });
    await service.createFromFinding(WS, 'finding-1');
    const row = store.inserted[0]!;
    expect(row.name).toHaveLength(MAX_CASE_NAME_CHARS);
    expect(row.inputMeta.pr_title).toHaveLength(MAX_PR_TITLE_CHARS);
    expect(row.inputMeta.pr_body).toBe('a'.repeat(MAX_PR_BODY_BYTES - 1));
  });

  it('stores a null PR body as an empty string and clamps a degenerate line range into the target', async () => {
    const { store, service } = harness();
    store.src = source({ finding: { startLine: 0, endLine: -3 }, pull: { body: null } });
    await service.createFromFinding(WS, 'finding-1');
    const row = store.inserted[0]!;
    expect(row.inputMeta.pr_body).toBe('');
    expect(row.target).toEqual({ file: 'src/a.ts', start_line: 1, end_line: 1 });
  });
});

describe('EvalsService.listCases / deleteCase', () => {
  const mk = (id: string) => ({ id, name: id }) as unknown as EvalCase;
  const run = (over: Partial<EvalSuiteRun>): EvalSuiteRun =>
    ({
      id: 'run-1',
      agent_id: AGENT.id,
      status: 'completed',
      started_at: '2026-10-05T10:00:00.000Z',
      cases: [],
      skills: [],
      metrics: { recall: 1, precision: 1, citation_accuracy: 1 },
      cases_total: 3,
      cases_passed: 1,
      cost_usd: 0.01,
      agent_version: 1,
      ...over,
    }) as EvalSuiteRun;

  it('AC-4: each case carries its result in the latest completed run, "never_run" if absent', async () => {
    const { store, service } = harness();
    store.cases = [mk('c1'), mk('c2'), mk('c3')];
    store.runs = [run({ id: 'run-1' })];
    store.statuses = [
      { caseId: 'c1', status: 'passed' },
      { caseId: 'c2', status: 'errored' },
    ];
    const list = await service.listCases(WS, AGENT.id);
    expect(list.cases.map((c) => [c.id, c.last_result])).toEqual([
      ['c1', 'passed'],
      ['c2', 'errored'],
      ['c3', 'never_run'],
    ]);
    expect(list.passing).toBe(1);
    expect(list.total).toBe(3);
    expect(list.latest_run_id).toBe('run-1');
  });

  it('with no completed run every case is never_run and latest_run_id is null', async () => {
    const { store, service } = harness();
    store.cases = [mk('c1')];
    store.runs = [run({ status: 'failed' })];
    const list = await service.listCases(WS, AGENT.id);
    expect(list).toMatchObject({ passing: 0, total: 1, latest_run_id: null });
    expect(list.cases[0]!.last_result).toBe('never_run');
  });

  it('answers 404 for an agent that is not in the workspace', async () => {
    const { service } = harness();
    await expect(service.listCases(WS, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('AC-5: deleting answers ok, and 404 when the case is not in the workspace', async () => {
    const { store, service } = harness();
    await expect(service.deleteCase(WS, 'c1')).resolves.toEqual({ ok: true });
    store.deleteResult = false;
    await expect(service.deleteCase(WS, 'c1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('EvalsService dashboards', () => {
  const metrics = (recall: number | null, precision: number | null, citation: number | null) => ({
    recall,
    precision,
    citation_accuracy: citation,
  });
  const run = (id: string, minute: number, over: Partial<EvalSuiteRun> = {}): EvalSuiteRun =>
    ({
      id,
      kind: 'suite',
      agent_id: AGENT.id,
      agent_version: 1,
      status: 'completed',
      started_at: `2026-10-05T10:0${minute}:00.000Z`,
      cases: [],
      skills: [],
      metrics: metrics(0.8, 0.9, 1),
      cases_total: 4,
      cases_passed: 3,
      cost_usd: 0.02,
      ...over,
    }) as EvalSuiteRun;

  it('AC-10 / AC-15: the tiles read the latest completed run, deltas are signed points, a drop is a regression', async () => {
    const { store, service } = harness();
    store.runs = [
      run('r1', 1, { metrics: metrics(0.8, 0.9, 1), cases_passed: 3 }),
      run('r2', 2, { metrics: metrics(0.5, 0.95, 1), cases_passed: 2 }),
    ];
    const dash = await service.agentDashboard(WS, AGENT.id);

    expect(dash.current).toMatchObject({ recall: 0.5, precision: 0.95, citation_accuracy: 1, cases_passed: 2, cases_total: 4 });
    expect(dash.delta).toEqual({ recall: -30, precision: 5, citation_accuracy: 0, cases_passed: -1 });
    expect(dash.regressions).toEqual([{ metric: 'recall', drop_points: 30 }]);
    expect(dash.alert).toContain('Recall dropped 30.0 points');
    expect(dash.trend.map((p) => p.run_id)).toEqual(['r1', 'r2']); // oldest first
  });

  it('NFR-12 / gap 2: a failed or running run never feeds the tiles, delta, trend or banner, but is listed', async () => {
    const { store, service } = harness();
    store.runs = [
      run('good', 1),
      run('bad', 2, { status: 'failed', metrics: metrics(null, null, null), cases_passed: 0 }),
      run('live', 3, { status: 'running', metrics: metrics(null, null, null), cases_passed: 0 }),
    ];
    const dash = await service.agentDashboard(WS, AGENT.id);
    expect(dash.current?.recall).toBe(0.8);
    expect(dash.delta).toEqual({ recall: null, precision: null, citation_accuracy: null, cases_passed: null });
    expect(dash.trend.map((p) => p.run_id)).toEqual(['good']);
    expect(dash.regressions).toEqual([]);
    expect(dash.alert).toBeNull();
    expect(dash.running?.id).toBe('live');
    expect(dash.recent_runs.map((r) => r.id)).toEqual(['live', 'bad', 'good']);
  });

  it('EC-8: an unavailable metric stays null in the trend and the delta — never 0', async () => {
    const { store, service } = harness();
    store.runs = [
      run('r1', 1, { metrics: metrics(0.8, null, 1), cases_total: 0, cases_passed: 0 }),
      run('r2', 2, { metrics: metrics(0.9, null, 1) }),
    ];
    const dash = await service.agentDashboard(WS, AGENT.id);
    expect(dash.trend[0]).toMatchObject({ precision: null, pass_rate: null });
    expect(dash.current?.precision).toBeNull();
    expect(dash.delta.precision).toBeNull();
    expect(dash.regressions).toEqual([]);
  });

  it('with no completed run the dashboard has no tiles and no delta', async () => {
    const { service } = harness();
    const dash = await service.agentDashboard(WS, AGENT.id);
    expect(dash.current).toBeNull();
    expect(dash.delta.cases_passed).toBeNull();
    expect(dash.trend).toEqual([]);
  });

  it('AC-11: the workspace dashboard has one card per agent with cases, each with its latest completed run', async () => {
    const { store, service } = harness();
    store.withCases = [
      { agentId: AGENT.id, name: AGENT.name, provider: 'openai', model: 'gpt-4.1', casesTotal: 4 },
      { agentId: 'agent-2', name: 'Other', provider: 'openai', model: 'gpt-4.1', casesTotal: 2 },
    ];
    store.runs = [run('r1', 1), run('r2', 2, { status: 'failed' })];
    const dash = await service.workspaceDashboard(WS);

    expect(dash.cases_total).toBe(6);
    expect(dash.agents.map((a) => [a.agent_id, a.latest?.id ?? null])).toEqual([
      [AGENT.id, 'r1'],
      ['agent-2', null],
    ]);
    expect(dash.recent_runs.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('EC-10: with no agent that has a case the workspace dashboard has no cards', async () => {
    const { service } = harness();
    const dash = await service.workspaceDashboard(WS);
    expect(dash.agents).toEqual([]);
    expect(dash.cases_total).toBe(0);
  });
});
