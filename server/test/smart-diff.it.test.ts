import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';

/**
 * `GET /pulls/:id/smart-diff` (L03). `setupRepoAndPr` is a **local** helper
 * `[tree-adapt]` — `reviews.it.test.ts`'s version of the same shape is not a
 * shared helper (`server/test/helpers/pg.ts` has no such export), so this
 * file declares its own rather than importing across test files.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Smart diff fixture PR',
      author: 'marisa.koch',
      branch: 'feat/sd',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 4,
      deletions: 0,
      filesCount: 4,
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'src/app.ts', additions: 5, deletions: 1 },
    { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 100, deletions: 0 },
    { prId: pr!.id, path: 'src/app.test.ts', additions: 3, deletions: 0 },
    { prId: pr!.id, path: 'docs/x.md', additions: 1, deletions: 0 },
  ]);
  return { repo: repo!, pr: pr! };
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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
    // MockLLMProvider in overrides is harmless — nothing on this route should
    // call it (P2: opening Files changed makes no LLM call).
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

  async function insertReview(
    prId: string,
    opts: {
      agentId?: string | null;
      minutesAgo: number;
      kind?: 'review' | 'summary';
      findings: { file: string; startLine: number; dismissed?: boolean }[];
    },
  ) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: opts.agentId ?? null,
        kind: opts.kind ?? 'review',
        verdict: 'comment',
        summary: 's',
        score: 70,
        model: 'gpt-4.1',
        createdAt: new Date(Date.now() - opts.minutesAgo * 60_000),
      })
      .returning({ id: t.reviews.id });
    for (const f of opts.findings) {
      await pg.handle.db.insert(t.findings).values({
        reviewId: review!.id,
        file: f.file,
        startLine: f.startLine,
        endLine: f.startLine,
        severity: 'WARNING',
        category: 'bug',
        title: 'finding',
        rationale: 'why',
        confidence: 0.9,
        kind: 'finding',
        dismissedAt: f.dismissed ? new Date() : null,
      });
    }
    return review!.id;
  }

  it('(a) 200 before any review: parses, all finding_lines empty, lock file boilerplate, groups in role order', async () => {
    const a = await app();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const parsed = SmartDiff.parse(body);

    for (const group of parsed.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }

    const boilerplate = parsed.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplate?.files.some((f) => f.path === 'pnpm-lock.yaml')).toBe(true);

    // role order — membership only, not in-group order.
    const roleOrder = ['core', 'tests', 'wiring', 'docs', 'boilerplate'];
    const seenIndices = parsed.groups.map((g) => roleOrder.indexOf(g.role));
    expect(seenIndices).toEqual([...seenIndices].sort((x, y) => x - y));
    expect(parsed.groups.map((g) => g.role)).toEqual(
      expect.arrayContaining(['core', 'tests', 'docs', 'boilerplate']),
    );

    await a.close();
  });

  it('(b) latest review per agent, summary ignored, dismissed excluded', async () => {
    const a = await app();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Agent A: older finding on line 5, newer finding on line 9 — only the newer counts.
    const agentA = randomUUID();
    const agentB = randomUUID();

    await insertReview(pr.id, { agentId: agentA, minutesAgo: 60, findings: [{ file: 'src/app.ts', startLine: 5 }] });
    await insertReview(pr.id, { agentId: agentA, minutesAgo: 5, findings: [{ file: 'src/app.ts', startLine: 9 }] });
    // Second agent adds up.
    await insertReview(pr.id, { agentId: agentB, minutesAgo: 5, findings: [{ file: 'src/app.ts', startLine: 3 }] });
    // A `kind='summary'` review must be ignored entirely.
    await insertReview(pr.id, {
      agentId: randomUUID(),
      minutesAgo: 1,
      kind: 'summary',
      findings: [{ file: 'src/app.ts', startLine: 42 }],
    });
    // A dismissed finding on the counted review adds no line.
    await insertReview(pr.id, {
      agentId: randomUUID(),
      minutesAgo: 3,
      findings: [{ file: 'src/app.ts', startLine: 77, dismissed: true }],
    });

    const res = await a.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const body = SmartDiff.parse(res.json());
    const core = body.groups.find((g) => g.role === 'core');
    const appTs = core?.files.find((f) => f.path === 'src/app.ts');
    expect(appTs?.finding_lines).toEqual([3, 9]);

    await a.close();
  });

  it('(c) a random uuid gives 404', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${randomUUID()}/smart-diff` });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('(d) a non-uuid id gives 422', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
    await a.close();
  });
});
