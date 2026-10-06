import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import {
  EvalDashboard,
  EvalRunAllResult,
  EvalSuiteRun,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

/**
 * Eval run controls against real Postgres, the model mocked: "Run all agents", the `since`
 * window on the agent run list, the dashboard cards' `enabled` / `running`, the newest-500
 * dashboard read, and that a skill run hosted on an agent leaks into none of the agent views.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-run-controls] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FILE = 'src/config.ts';
const DIFF = `--- a/${FILE}\n+++ b/${FILE}\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,`;
const TARGET = { file: FILE, start_line: 11, end_line: 11 };

/** Flags `src/config.ts:11`; can be held back behind a gate. */
class EvalLlm extends MockLLMProvider {
  gate: Promise<void> | null = null;
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.gate) await this.gate;
    const data = {
      verdict: 'comment',
      summary: 'one issue',
      score: 70,
      findings: [
        {
          id: 'f1',
          severity: 'WARNING',
          category: 'security',
          title: 'Hardcoded key',
          file: FILE,
          start_line: 11,
          end_line: 11,
          rationale: 'A live key is committed.',
          confidence: 0.9,
        },
      ],
    };
    return {
      data: (req.schema as { parse: (x: unknown) => T }).parse(data),
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(data),
      attempts: 1,
    };
  }
}

d('Eval run controls (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const llm = new EvalLlm('openai');
  const intentStub: IntentPort = {
    get: async () => null,
    ensure: async () => null,
    derive: async () => {
      throw new Error('an eval run never derives an intent');
    },
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        embedder: new MockEmbedder(),
        intent: intentStub,
        llm: { openai: llm },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const db = () => pg.handle.db;
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
  const get = (url: string) => app.inject({ method: 'GET', url });

  /** Every other test's cases and runs would join a "Run all agents" batch; start from nothing. */
  async function cleanSlate() {
    await db().delete(t.evalRuns);
    await db().delete(t.evalCases);
  }

  async function newAgent(name: string, over: { enabled?: boolean } = {}) {
    const [a] = await db()
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: `You review code (${name}).`,
        strategy: 'single-pass',
        enabled: over.enabled ?? true,
      })
      .returning();
    return a!;
  }
  async function newSkill(name: string) {
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId, name, description: 'd', type: 'security', source: 'manual', body: `Rule of ${name}.`, version: 1 })
      .returning();
    return s!;
  }
  let seq = 0;
  const caseBody = () => ({
    name: `Case ${++seq}`,
    input_diff: DIFF,
    input_meta: { pr_title: 'Harden config', pr_body: '' },
    expectation: 'must_find',
    target: TARGET,
  });
  async function agentWithCase(name: string, over: { enabled?: boolean } = {}) {
    const agent = await newAgent(name, over);
    expect((await post(`/agents/${agent.id}/eval-cases`, caseBody())).statusCode).toBe(201);
    return agent;
  }
  const holdModel = () => {
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    return () => {
      llm.gate = null;
      release();
    };
  };
  async function idle() {
    for (let i = 0; i < 200; i++) {
      const [row] = await db().select({ n: count() }).from(t.evalRuns).where(eq(t.evalRuns.status, 'running'));
      if (row!.n === 0) return;
      await sleep(50);
    }
    throw new Error('runs did not finish in 10 s');
  }
  const runCount = async () => (await db().select({ n: count() }).from(t.evalRuns))[0]!.n;
  const card = async (agentId: string) => {
    const dash = EvalDashboard.parse((await get('/eval/dashboard')).json());
    return dash.agents.find((a) => a.agent_id === agentId);
  };

  /** A finished run row at a fixed instant. */
  const completedRun = (over: Partial<typeof t.evalRuns.$inferInsert> & { ownerId: string; agentId: string }) => ({
    workspaceId,
    kind: 'suite' as const,
    ownerKind: 'agent' as const,
    agentVersion: 1,
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'completed' as const,
    casesTotal: 10,
    casesPassed: 5,
    recall: 0.5,
    precision: 0.5,
    citationAccuracy: 1,
    costUsd: 0.01,
    ...over,
  });

  describe('Run all agents', () => {
    it('AC-8: one outcome per agent — started, disabled, already running — and a skipped agent stops nobody', async () => {
      await cleanSlate();
      const a = await agentWithCase('RA enabled');
      const b = await agentWithCase('RA disabled', { enabled: false });
      const c = await agentWithCase('RA running');
      const release = holdModel();
      try {
        const first = await post(`/agents/${c.id}/eval-runs`, {});
        expect(first.statusCode).toBe(202);
        const before = await runCount();

        const res = await post('/eval/run-all', {});
        expect(res.statusCode).toBe(200);
        const { outcomes } = EvalRunAllResult.parse(res.json());
        const by = Object.fromEntries(outcomes.map((o) => [o.agent_id, o]));
        expect(by[a.id]).toMatchObject({ status: 'started', reason: null });
        expect(by[a.id]!.run_id).toEqual(expect.any(String));
        expect(by[b.id]).toMatchObject({ status: 'skipped', reason: 'disabled', run_id: null });
        expect(by[c.id]).toMatchObject({ status: 'skipped', reason: 'already_running', run_id: null });
        expect(await runCount()).toBe(before + 1); // only agent A got a new row
      } finally {
        release();
      }
      await idle();
    });

    it('EC-9: every agent already running → every outcome skipped, no new run row', async () => {
      await cleanSlate();
      const a = await agentWithCase('EC9 one');
      const b = await agentWithCase('EC9 two');
      const release = holdModel();
      try {
        expect((await post(`/agents/${a.id}/eval-runs`, {})).statusCode).toBe(202);
        expect((await post(`/agents/${b.id}/eval-runs`, {})).statusCode).toBe(202);
        const before = await runCount();

        const { outcomes } = EvalRunAllResult.parse((await post('/eval/run-all', {})).json());
        expect(outcomes.map((o) => [o.status, o.reason])).toEqual([
          ['skipped', 'already_running'],
          ['skipped', 'already_running'],
        ]);
        expect(await runCount()).toBe(before);
      } finally {
        release();
      }
      await idle();
    });

    it('a skill suite running on host H neither blocks H in run-all nor sets H’s card to running', async () => {
      await cleanSlate();
      const h = await agentWithCase('Host agent');
      const skill = await newSkill('Hosted skill');
      await db().insert(t.agentSkills).values({ agentId: h.id, skillId: skill.id, order: 0, enabled: true });
      expect((await post(`/skills/${skill.id}/eval-cases`, caseBody())).statusCode).toBe(201);
      const release = holdModel();
      try {
        const hosted = await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: h.id });
        expect(hosted.statusCode).toBe(202);
        expect(EvalSuiteRun.parse(hosted.json())).toMatchObject({ owner_kind: 'skill', agent_id: h.id });

        expect((await card(h.id))!.running).toBe(false);
        const { outcomes } = EvalRunAllResult.parse((await post('/eval/run-all', {})).json());
        expect(outcomes.find((o) => o.agent_id === h.id)).toMatchObject({ status: 'started', reason: null });
        expect((await card(h.id))!.running).toBe(true); // now its own suite run is running
      } finally {
        release();
      }
      await idle();
    });

    it('the dashboard cards carry enabled and running', async () => {
      await cleanSlate();
      const on = await agentWithCase('Card on');
      const off = await agentWithCase('Card off', { enabled: false });
      expect(await card(on.id)).toMatchObject({ enabled: true, running: false });
      expect(await card(off.id)).toMatchObject({ enabled: false, running: false });
    });
  });

  describe('agent run history views', () => {
    const T0 = Date.UTC(2026, 5, 1);

    it('?since= includes a run started exactly then and excludes it 1 ms later', async () => {
      await cleanSlate();
      const agent = await newAgent('Since agent');
      const at = new Date(T0 + 5_000);
      await db().insert(t.evalRuns).values(completedRun({ ownerId: agent.id, agentId: agent.id, ranAt: at }));
      const list = async (since: Date) =>
        EvalSuiteRun.array().parse((await get(`/agents/${agent.id}/eval-runs?since=${encodeURIComponent(since.toISOString())}`)).json());

      expect(await list(at)).toHaveLength(1);
      expect(await list(new Date(at.getTime() + 1))).toHaveLength(0);
      expect(await list(new Date(at.getTime() - 1))).toHaveLength(1);
    });

    it('a completed skill run hosted on H is in none of H’s window list, trend or Compare', async () => {
      await cleanSlate();
      const h = await newAgent('Isolation host');
      const skill = await newSkill('Isolation skill');
      const own = randomUUID();
      const hosted = randomUUID();
      await db().insert(t.evalRuns).values([
        completedRun({ id: own, ownerId: h.id, agentId: h.id, ranAt: new Date(T0) }),
        completedRun({ id: hosted, ownerKind: 'skill', ownerId: skill.id, agentId: h.id, ranAt: new Date(T0 + 1_000) }),
      ]);

      const since = encodeURIComponent(new Date(T0 - 1).toISOString());
      const list = EvalSuiteRun.array().parse((await get(`/agents/${h.id}/eval-runs?since=${since}`)).json());
      expect(list.map((r) => r.id)).toEqual([own]);

      const dash = EvalDashboard.parse((await get(`/agents/${h.id}/eval-dashboard`)).json());
      expect(dash.trend.map((p) => p.run_id)).toEqual([own]);
      expect(dash.recent_runs.map((r) => r.id)).toEqual([own]);

      const cmp = await get(`/agents/${h.id}/eval-runs/compare?a=${own}&b=${hosted}`);
      expect(cmp.statusCode).toBe(422);
      expect(cmp.json().error.code).toBe('eval_compare_invalid');
    });
  });

  describe('dashboards read the newest 500 completed runs', () => {
    const T0 = Date.UTC(2026, 0, 1);
    const N = 501;

    it('agent: 501 runs → 500 trend points, the newest last and current', async () => {
      await cleanSlate();
      const agent = await newAgent('Cap agent');
      const rows = Array.from({ length: N }, (_, i) =>
        completedRun({ id: randomUUID(), ownerId: agent.id, agentId: agent.id, ranAt: new Date(T0 + i * 1_000), casesPassed: i % 10 }),
      );
      await db().insert(t.evalRuns).values(rows);

      const dash = EvalDashboard.parse((await get(`/agents/${agent.id}/eval-dashboard`)).json());
      expect(dash.trend).toHaveLength(500);
      expect(dash.trend[0]!.run_id).toBe(rows[1]!.id); // the oldest of the 501 is dropped
      expect(dash.trend.at(-1)!.run_id).toBe(rows[N - 1]!.id);
      expect(dash.current!.cases_passed).toBe((N - 1) % 10);
      expect(dash.delta.cases_passed).toBe(((N - 1) % 10) - ((N - 2) % 10));
    });

    it('skill: 501 runs → 500 trend points, the newest last and current', async () => {
      await cleanSlate();
      const host = await newAgent('Cap host');
      const skill = await newSkill('Cap skill');
      const rows = Array.from({ length: N }, (_, i) =>
        completedRun({
          id: randomUUID(),
          ownerKind: 'skill',
          ownerId: skill.id,
          agentId: host.id,
          ranAt: new Date(T0 + i * 1_000),
          casesPassed: i % 10,
        }),
      );
      await db().insert(t.evalRuns).values(rows);

      const dash = EvalDashboard.parse((await get(`/skills/${skill.id}/eval-dashboard`)).json());
      expect(dash.trend).toHaveLength(500);
      expect(dash.trend[0]!.run_id).toBe(rows[1]!.id);
      expect(dash.trend.at(-1)!.run_id).toBe(rows[N - 1]!.id);
      expect(dash.current!.cases_passed).toBe((N - 1) % 10);
    });
  });

  it('keeps a hand-inserted running row out of the way: the sweep fails it, so run-all starts the agent', async () => {
    // Pins WHY the AC-8 test above starts its "already running" agent through the route: a
    // `running` row this process does not own is orphaned by definition and is failed on read.
    await cleanSlate();
    const agent = await agentWithCase('Orphan agent');
    await db().insert(t.evalRuns).values({
      workspaceId,
      kind: 'suite',
      ownerKind: 'agent',
      ownerId: agent.id,
      agentId: agent.id,
      agentVersion: 1,
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'running',
    });
    const { outcomes } = EvalRunAllResult.parse((await post('/eval/run-all', {})).json());
    expect(outcomes.find((o) => o.agent_id === agent.id)).toMatchObject({ status: 'started' });
    await idle();
    const failed = await db()
      .select({ n: count() })
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.agentId, agent.id), eq(t.evalRuns.status, 'failed')));
    expect(failed[0]!.n).toBe(1);
  });
});
