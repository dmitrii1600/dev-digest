import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Est = { agent_id: string; sample_runs: number; avg_duration_ms: number | null; avg_cost_usd: number | null };

d('GET /agents/run-estimates (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'est', fullName: 'acme/est' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId, repoId: repo!.id, number: 1, title: 't', author: 'a', branch: 'b', base: 'main',
        headSha: 'abc', additions: 0, deletions: 0, filesCount: 0, status: 'needs_review',
      })
      .returning();
    prId = pr!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function mkAgent(ws = workspaceId, name = 'Est') {
    const [a] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x' })
      .returning();
    return a!.id;
  }
  async function mkRun(
    agentId: string,
    o: { ageMin: number; durationMs: number; costUsd?: number | null; status?: 'done' | 'failed'; ws?: string },
  ) {
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId: o.ws ?? workspaceId,
      agentId,
      prId,
      status: o.status ?? 'done',
      durationMs: o.durationMs,
      costUsd: o.costUsd ?? null,
      ranAt: new Date(Date.now() - o.ageMin * 60_000),
    });
  }
  async function estimates(): Promise<Est[]> {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: '/agents/run-estimates' });
    await app.close();
    expect(res.statusCode).toBe(200);
    return res.json() as Est[];
  }

  it('averages only the 20 newest completed runs (21 runs: the oldest is excluded)', async () => {
    const x = await mkAgent();
    await mkRun(x, { ageMin: 1000, durationMs: 100_000 });
    for (let i = 0; i < 20; i++) await mkRun(x, { ageMin: i + 1, durationMs: 1000 });
    const e = (await estimates()).find((r) => r.agent_id === x)!;
    expect(e.sample_runs).toBe(20);
    expect(e.avg_duration_ms).toBe(1000);
  });

  it('exactly 20 runs including the outlier: the outlier is counted', async () => {
    const x = await mkAgent();
    await mkRun(x, { ageMin: 1000, durationMs: 21_000 });
    for (let i = 0; i < 19; i++) await mkRun(x, { ageMin: i + 1, durationMs: 1000 });
    const e = (await estimates()).find((r) => r.agent_id === x)!;
    expect(e.sample_runs).toBe(20);
    expect(e.avg_duration_ms).toBe(2000);
  });

  it('ignores failed runs', async () => {
    const x = await mkAgent();
    await mkRun(x, { ageMin: 1, durationMs: 2000 });
    await mkRun(x, { ageMin: 2, durationMs: 999_999, status: 'failed' });
    const e = (await estimates()).find((r) => r.agent_id === x)!;
    expect(e.sample_runs).toBe(1);
    expect(e.avg_duration_ms).toBe(2000);
  });

  it('cost: nulls are skipped, never averaged as 0; all null stays null', async () => {
    const x = await mkAgent();
    await mkRun(x, { ageMin: 1, durationMs: 1000, costUsd: null });
    await mkRun(x, { ageMin: 2, durationMs: 1000, costUsd: null });
    await mkRun(x, { ageMin: 3, durationMs: 1000, costUsd: 0.01 });
    expect((await estimates()).find((r) => r.agent_id === x)!.avg_cost_usd).toBeCloseTo(0.01, 10);
    const y = await mkAgent(workspaceId, 'AllNull');
    await mkRun(y, { ageMin: 1, durationMs: 1000 });
    expect((await estimates()).find((r) => r.agent_id === y)!.avg_cost_usd).toBeNull();
  });

  it('an agent with no runs has a row with sample_runs 0 and null averages', async () => {
    const x = await mkAgent(workspaceId, 'Fresh');
    const e = (await estimates()).find((r) => r.agent_id === x)!;
    expect(e).toEqual({ agent_id: x, sample_runs: 0, avg_duration_ms: null, avg_cost_usd: null });
  });

  it("another workspace's runs are not counted", async () => {
    const x = await mkAgent();
    const [ws2] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    await mkRun(x, { ageMin: 1, durationMs: 5000, ws: ws2!.id });
    const e = (await estimates()).find((r) => r.agent_id === x)!;
    expect(e.sample_runs).toBe(0);
  });
});
