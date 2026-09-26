/**
 * GET /pulls/:id/blast-radius — end to end on real Postgres. The route is a
 * pure read of the repo-intel facade + `pr_files`, so we patch ONE facade
 * method on the real service (the `conventions.it.test.ts:139-141` pattern)
 * and assert the mapped, degraded-aware output, the exact paths the stub
 * received, and the 404/empty-map edge cases.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { BlastRadius } from '@devdigest/shared';
import type { BlastResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FULL_STATE: IndexState = {
  repoId: '',
  status: 'full',
  filesIndexed: 12,
  filesSkipped: 0,
  durationMs: 5,
  lastIndexedSha: 'sha1',
  indexerVersion: 2,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const BLAST_RESULT: BlastResult = {
  changedSymbols: [{ file: 'src/middleware/ratelimit.ts', name: 'applyRateLimit', kind: 'function' }],
  callers: [
    { file: 'src/api/users.ts', symbol: 'createUser', viaSymbol: 'applyRateLimit', line: 118, rank: 5 },
  ],
  impactedEndpoints: ['POST /users'],
  factsByFile: { 'src/api/users.ts': { endpoints: ['POST /users'], crons: ['job:digest'] } },
  degraded: false,
};

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { files?: string[] } = {},
) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const files = opts.files ?? ['src/middleware/ratelimit.ts', 'src/api/users.ts'];
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: files.length,
      status: 'open',
    })
    .returning();
  if (files.length > 0) {
    await db.insert(t.prFiles).values(files.map((path) => ({ prId: pr!.id, path })));
  }
  return { repo: repo!, pr: pr! };
}

/** Patch `getBlastRadius`/`getIndexState` on the real facade; record the calls. */
function patchFacade(
  app: Awaited<ReturnType<typeof buildApp>>,
  opts: { blast?: BlastResult; state?: Partial<IndexState> } = {},
) {
  const real = app.container.repoIntel;
  const calls: Array<{ repoId: string; files: string[] }> = [];
  const patched: RepoIntel = Object.assign(Object.create(real) as RepoIntel, {
    getBlastRadius: async (repoId: string, files: string[]) => {
      calls.push({ repoId, files });
      return opts.blast ?? BLAST_RESULT;
    },
    getIndexState: async () => ({ ...FULL_STATE, ...opts.state }),
  });
  app.container['overrides'].repoIntel = patched;
  return calls;
}

d('GET /pulls/:id/blast-radius (Testcontainers pg)', () => {
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

  it('200s with a mapped, contract-valid body and passes the two changed paths through', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const calls = patchFacade(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast-radius` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(BlastRadius.safeParse(body).success).toBe(true);
    expect(body.downstream).toEqual([
      {
        symbol: 'applyRateLimit',
        callers: [{ name: 'createUser', file: 'src/api/users.ts', line: 118 }],
        endpoints_affected: ['POST /users'],
        crons_affected: ['job:digest'],
      },
    ]);
    expect(body.degraded).toBe(false);
    expect(body.reason).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.files).toEqual(['src/api/users.ts', 'src/middleware/ratelimit.ts']);
    await app.close();
  });

  it('404 not_found for a random uuid', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    patchFacade(app);

    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/blast-radius',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });

  it('404 not_found for a PR that belongs to another workspace', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    patchFacade(app);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${repoSeq}` })
      .returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast-radius` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });

  it('200 with the empty map and no facade call when the PR has no pr_files', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const calls = patchFacade(app);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, { files: [] });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast-radius` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      changed_symbols: [],
      downstream: [],
      summary: 'No changed files recorded for this PR.',
      degraded: false,
      reason: null,
    });
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it('a partial index reports degraded:true, reason:"index_partial"', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    patchFacade(app, { state: { status: 'partial' } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast-radius` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('index_partial');
    await app.close();
  });
});
