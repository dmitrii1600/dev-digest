import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review, PrMeta, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * Run cost badge — the cost the engine already computes must survive the trip
 * to all three read surfaces, and "unknown" must never be rendered as zero.
 */

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
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, number: number) {
  const name = `cost-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
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

d('run cost badge (Testcontainers pg)', () => {
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

  function app() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  /** Insert a completed run directly — the aggregation rules need exact inputs. */
  async function insertRun(
    prId: string,
    values: { agentId: string | null; costUsd: number | null; minutesAgo: number; status?: string },
  ) {
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: values.agentId,
        prId,
        ranAt: new Date(Date.now() - values.minutesAgo * 60_000),
        provider: 'openai',
        model: 'gpt-4.1',
        durationMs: 1000,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: values.costUsd,
        status: values.status ?? 'done',
        findingsCount: 1,
        grounding: '1/1 passed',
        score: 70,
        blockers: 0,
      })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }

  it('a completed run persists the engine-reported cost and surfaces it on the run row and the trace', async () => {
    const a = await app();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 601);
    const agent = (
      await a.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Cost Rev', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    await a.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // MockLLMProvider reports costUsd 0.001 per structured call.
    const [row] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    expect(row!.costUsd).toBeCloseTo(0.001, 6);

    const runs: RunSummary[] = (
      await a.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })
    ).json();
    expect(runs[0]!.cost_usd).toBeCloseTo(0.001, 6);

    const trace: RunTrace = (
      await a.inject({ method: 'GET', url: `/runs/${runs[0]!.run_id}/trace` })
    ).json();
    expect(trace.stats.cost_usd).toBeCloseTo(0.001, 6);

    await a.close();
  });

  it('the PR list sums the newest completed run per agent', async () => {
    const a = await app();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 602);
    const [ag1] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Sec 602', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's' })
      .returning({ id: t.agents.id });
    const [ag2] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Perf 602', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's' })
      .returning({ id: t.agents.id });

    // Agent 1 ran twice: only the newer run counts. Agent 2 ran once.
    await insertRun(pr.id, { agentId: ag1!.id, costUsd: 0.005, minutesAgo: 60 }); // superseded
    await insertRun(pr.id, { agentId: ag1!.id, costUsd: 0.002, minutesAgo: 5 });
    await insertRun(pr.id, { agentId: ag2!.id, costUsd: 0.003, minutesAgo: 8 });
    // A failed run never contributes, whatever it claims to have cost.
    await insertRun(pr.id, { agentId: ag2!.id, costUsd: 9.99, minutesAgo: 1, status: 'failed' });

    const list: PrMeta[] = (
      await a.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const row = list.find((p) => p.number === 602)!;
    expect(row.cost_usd).toBeCloseTo(0.005, 6); // 0.002 + 0.003, not 0.005 + …

    await a.close();
  });

  it('unknown cost is null, not zero — on the run row and on the PR list', async () => {
    const a = await app();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 603);
    const [ag] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Quiet 603', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's' })
      .returning({ id: t.agents.id });
    await insertRun(pr.id, { agentId: ag!.id, costUsd: null, minutesAgo: 5 });

    const runs: RunSummary[] = (
      await a.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })
    ).json();
    expect(runs[0]!.cost_usd).toBeNull();

    const list: PrMeta[] = (
      await a.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const row = list.find((p) => p.number === 603)!;
    expect(row.cost_usd).toBeNull(); // NOT 0 — a run with no usage is unknown, not free

    await a.close();
  });

  it('a PR with no runs at all reports a null cost', async () => {
    const a = await app();
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId, 604);

    const list: PrMeta[] = (
      await a.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    expect(list.find((p) => p.number === 604)!.cost_usd).toBeNull();

    await a.close();
  });
});
