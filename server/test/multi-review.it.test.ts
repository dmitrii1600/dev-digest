import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq, count } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

// Every review run calls `container.intent.ensure`; stubbed so no paid call is made
// (server/INSIGHTS.md, 2026-09-24). The counter doubles as the NFR-2 assertion.
let intentCalls = 0;
const intentStub: IntentPort = {
  get: async () => null,
  ensure: async () => {
    intentCalls++;
    return null;
  },
  derive: async () => {
    throw new Error('not used');
  },
};

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

/** Waits `delayMs` per call and throws for `fail-model`, so overlap and EC-1 are observable. */
class SlowMockLLM extends MockLLMProvider {
  structuredCalls = 0;
  constructor(private delayMs = 0) {
    super('openai', { structured: REVIEW_FIXTURE });
  }
  override async completeStructured<T>(
    req: Parameters<MockLLMProvider['completeStructured']>[0],
  ): Promise<never> {
    this.structuredCalls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (req.model === 'fail-model') throw new Error('boom');
    return super.completeStructured<T>(req as never) as never;
  }
}

d('multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(llm: SlowMockLLM) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        intent: intentStub,
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  type App = Awaited<ReturnType<typeof appWith>>;
  let agentSeq = 0;
  async function mkAgent(app: App, model = 'gpt-4.1'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Multi ${agentSeq++}`, provider: 'openai', model, system_prompt: 'review' },
    });
    return res.json().id as string;
  }
  const multiCount = async () =>
    (await pg.handle.db.select({ n: count() }).from(t.multiAgentRuns))[0]!.n;
  const runCount = async () => (await pg.handle.db.select({ n: count() }).from(t.agentRuns))[0]!.n;

  it('AC-7 / AC-8 / AC-17: creates linked runs; a single review stays unlinked', async () => {
    const app = await appWith(new SlowMockLLM());
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const ids = [await mkAgent(app), await mkAgent(app), await mkAgent(app)];

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-review`, payload: { agentIds: ids } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(3);
    const rows = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.multiRunId === body.multi_run_id)).toBe(true);
    const multi = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, body.multi_run_id));
    expect(multi).toHaveLength(1);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const single = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: ids[0] } });
    expect(single.statusCode).toBe(200);
    expect(Object.keys(single.json()).sort()).toEqual(['pr_id', 'reviews', 'runs']);
    const singleRunId = single.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 4 });
    const [singleRow] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, singleRunId));
    expect(singleRow!.multiRunId).toBeNull();

    const hist = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json() as {
      run_id: string;
      multi_run_id: string | null;
    }[];
    expect(hist.find((r) => r.run_id === singleRunId)!.multi_run_id).toBeNull();
    expect(hist.filter((r) => r.multi_run_id === body.multi_run_id)).toHaveLength(3);
    await app.close();
  });

  it('NFR-1 / NFR-2 / NFR-7: agents overlap in time; one intent call; one LLM call each; diff-only runs end done', async () => {
    const llm = new SlowMockLLM(400);
    const app = await appWith(llm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const ids = [await mkAgent(app), await mkAgent(app), await mkAgent(app)];
    intentCalls = 0;

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-review`, payload: { agentIds: ids } });
    expect(res.statusCode).toBe(200);
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const starts = runs.map((r) => r.ranAt!.getTime());
    const ends = runs.map((r) => r.ranAt!.getTime() + (r.durationMs ?? 0));
    const sum = runs.reduce((n, r) => n + (r.durationMs ?? 0), 0);
    expect(Math.max(...ends) - Math.min(...starts)).toBeLessThan(sum);
    expect(intentCalls).toBe(1);
    expect(llm.structuredCalls).toBe(3);
    expect(runs.every((r) => r.status === 'done')).toBe(true);
    await app.close();
  });

  it('EC-1: a failing agent does not stop the others', async () => {
    const app = await appWith(new SlowMockLLM());
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const ids = [await mkAgent(app), await mkAgent(app, 'fail-model'), await mkAgent(app)];
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-review`, payload: { agentIds: ids } });
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
    expect(runs.filter((r) => r.status === 'done')).toHaveLength(2);
    const failed = runs.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toBeTruthy();
    expect(failed[0]!.costUsd).toBeNull();
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews).toHaveLength(2);
    await app.close();
  });

  it('EC-4: invalid bodies are 422 and create nothing; 10 ids is the boundary', async () => {
    const app = await appWith(new SlowMockLLM());
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const id = await mkAgent(app);
    const before = { m: await multiCount(), r: await runCount() };
    const bad: unknown[] = [
      {},
      { agentIds: [] },
      { agentIds: Array.from({ length: 11 }, () => id) },
      { agentIds: [id, id] },
      { agentIds: [''] },
      { agentIds: [id], all: true },
    ];
    for (const payload of bad) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-review`, payload });
      expect(res.statusCode).toBe(422);
      expect(res.body).toMatch(/agentIds|all/);
    }
    expect({ m: await multiCount(), r: await runCount() }).toEqual(before);

    const ten: string[] = [];
    for (let i = 0; i < 10; i++) ten.push(await mkAgent(app));
    const ok = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-review`, payload: { agentIds: ten } });
    expect(ok.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 10 });
    await app.close();
  });

  it('EC-5: unknown or foreign agent / PR is 404 and creates nothing', async () => {
    const app = await appWith(new SlowMockLLM());
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const id = await mkAgent(app);
    const [ws2] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws2!.id, name: 'Foreign', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x' })
      .returning();
    const { pr: foreignPr } = await setupRepoAndPr(pg.handle.db, ws2!.id);
    const before = { m: await multiCount(), r: await runCount() };

    const cases: [string, string[]][] = [
      [pr.id, ['00000000-0000-4000-8000-000000000000']],
      [pr.id, ['abc']],
      [pr.id, [id, foreignAgent!.id]],
      [foreignPr.id, [id]],
    ];
    for (const [prId, agentIds] of cases) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/multi-review`, payload: { agentIds } });
      expect(res.statusCode).toBe(404);
    }
    expect({ m: await multiCount(), r: await runCount() }).toEqual(before);
    await app.close();
  });

  it('GET /multi-reviews/:id and NFR-6 persistence', async () => {
    const app = await appWith(new SlowMockLLM());
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const ids = [await mkAgent(app), await mkAgent(app), await mkAgent(app)];
    const started = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-review`, payload: { agentIds: ids } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const res = await app.inject({ method: 'GET', url: `/multi-reviews/${started.multi_run_id}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.pr.number).toBe(482);
    expect(detail.agents).toHaveLength(3);
    for (const a of detail.agents) {
      expect(a.summary).toBe(REVIEW_FIXTURE.summary);
      expect(a.findings).toHaveLength(1);
    }

    expect(
      (await app.inject({ method: 'GET', url: '/multi-reviews/00000000-0000-4000-8000-000000000000' })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/multi-reviews/not-a-uuid' })).statusCode).toBe(422);
    const [ws2] = await pg.handle.db.insert(t.workspaces).values({ name: 'other2' }).returning();
    const { pr: pr2 } = await setupRepoAndPr(pg.handle.db, ws2!.id);
    const [foreign] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId: ws2!.id, prId: pr2.id })
      .returning();
    expect((await app.inject({ method: 'GET', url: `/multi-reviews/${foreign!.id}` })).statusCode).toBe(404);

    // delete one run → the multi-run stays readable with the other two
    await app.inject({ method: 'DELETE', url: `/runs/${detail.agents[0].run.run_id}` });
    const after = await app.inject({ method: 'GET', url: `/multi-reviews/${started.multi_run_id}` });
    expect(after.statusCode).toBe(200);
    expect(after.json().agents).toHaveLength(2);

    // delete the PR → the multi_agent_runs row is gone
    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    const multi = await pg.handle.db
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, started.multi_run_id));
    expect(multi).toHaveLength(0);
    await app.close();
  });
});
