import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta, RunSummary, Severity } from '@devdigest/shared';

/**
 * FINDINGS severity breakdown on the read surfaces.
 *
 * The rule under test: the PR list reports the LATEST review only — the same
 * review `score` comes from — so the chips and the score ring in one row always
 * describe the same population. The run timeline reports per run instead, since
 * each row there IS a run.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, number: number) {
  const name = `findings-api-${repoSeq++}`;
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
  return { repo: repo!, pr: pr! };
}

d('findings severity counts (Testcontainers pg)', () => {
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
        git: new MockGitClient({ diff: '' }),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  }

  /** Insert a review plus its findings directly — the aggregation needs exact inputs. */
  async function insertReview(
    prId: string,
    opts: {
      agentId?: string | null;
      runId?: string | null;
      minutesAgo: number;
      score?: number;
      severities: Severity[];
      dismissLast?: boolean;
    },
  ) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: opts.agentId ?? null,
        runId: opts.runId ?? null,
        kind: 'review',
        verdict: 'comment',
        summary: 's',
        score: opts.score ?? 70,
        model: 'gpt-4.1',
        createdAt: new Date(Date.now() - opts.minutesAgo * 60_000),
      })
      .returning({ id: t.reviews.id });
    let i = 0;
    for (const severity of opts.severities) {
      i += 1;
      const last = i === opts.severities.length;
      await pg.handle.db.insert(t.findings).values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: i,
        endLine: i,
        severity,
        category: 'security',
        title: `finding ${i}`,
        rationale: 'why',
        confidence: 0.9,
        kind: 'finding',
        dismissedAt: opts.dismissLast && last ? new Date() : null,
      });
    }
    return review!.id;
  }

  async function insertRun(prId: string, agentId: string | null) {
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId,
        prId,
        ranAt: new Date(),
        provider: 'openai',
        model: 'gpt-4.1',
        status: 'done',
        findingsCount: 0,
        grounding: '1/1 passed',
      })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }

  async function listRow(
    appInstance: Awaited<ReturnType<typeof buildApp>>,
    repoId: string,
    number: number,
  ) {
    const list: PrMeta[] = (
      await appInstance.inject({ method: 'GET', url: `/repos/${repoId}/pulls` })
    ).json();
    return list.find((p) => p.number === number)!;
  }

  it('tallies the latest review by severity', async () => {
    const a = await app();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 701);
    await insertReview(pr.id, {
      minutesAgo: 5,
      severities: ['CRITICAL', 'CRITICAL', 'WARNING', 'SUGGESTION'],
    });

    expect((await listRow(a, repo.id, 701)).findings_counts).toEqual({
      CRITICAL: 2,
      WARNING: 1,
      SUGGESTION: 1,
    });
    await a.close();
  });

  it('reports the LATEST review only — an older one does not keep inflating the row', async () => {
    const a = await app();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 702);
    await insertReview(pr.id, {
      minutesAgo: 60,
      score: 20,
      severities: ['CRITICAL', 'CRITICAL', 'CRITICAL'],
    });
    await insertReview(pr.id, { minutesAgo: 2, score: 88, severities: ['SUGGESTION'] });

    const row = await listRow(a, repo.id, 702);
    expect(row.findings_counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 1 });
    // …and the score ring describes that same review, so the two always agree.
    expect(row.score).toBe(88);
    await a.close();
  });

  it('counts dismissed findings — the score is computed from them too', async () => {
    const a = await app();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 703);
    await insertReview(pr.id, {
      minutesAgo: 5,
      severities: ['CRITICAL', 'WARNING'],
      dismissLast: true,
    });

    expect((await listRow(a, repo.id, 703)).findings_counts).toEqual({
      CRITICAL: 1,
      WARNING: 1,
      SUGGESTION: 0,
    });
    await a.close();
  });

  it('a clean review is a genuine zero, not unknown', async () => {
    const a = await app();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 704);
    await insertReview(pr.id, { minutesAgo: 5, score: 100, severities: [] });

    expect((await listRow(a, repo.id, 704)).findings_counts).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
    await a.close();
  });

  it('a PR nobody reviewed reports null — the UI must not claim it is clean', async () => {
    const a = await app();
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId, 705);

    const row = await listRow(a, repo.id, 705);
    expect(row.findings_counts).toBeNull();
    expect(row.score).toBeNull();
    await a.close();
  });

  it('the run timeline reports the breakdown per run, and null for a run with no review', async () => {
    const a = await app();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 706);
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Sec 706',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 's',
      })
      .returning({ id: t.agents.id });

    const reviewedRun = await insertRun(pr.id, agent!.id);
    await insertReview(pr.id, {
      agentId: agent!.id,
      runId: reviewedRun,
      minutesAgo: 5,
      severities: ['CRITICAL', 'WARNING', 'WARNING'],
    });
    const barrenRun = await insertRun(pr.id, agent!.id);

    const runs: RunSummary[] = (
      await a.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })
    ).json();
    const withReview = runs.find((r) => r.run_id === reviewedRun)!;
    const withoutReview = runs.find((r) => r.run_id === barrenRun)!;

    expect(withReview.findings_counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
    expect(withoutReview.findings_counts).toBeNull();
    await a.close();
  });
});
