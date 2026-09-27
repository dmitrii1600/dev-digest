/**
 * `db/seed-blast.ts` through the REAL `repoIntel` facade, on real Postgres
 * (`*.it.test.ts` — DB-backed). `seed()` runs TWICE before any assertion:
 * seed-blast's own guards (index-state freshness, history-cache staleness)
 * must make the second pass a no-op, so this also pins that `pnpm db:seed`
 * stays idempotent once the demo DB already carries a full index.
 *
 * Turns red when: the fixture's ordering (`toBlastRadius` rules 1-5),
 * `references.decl_file` resolution, the endpoint/cron attribution, or the
 * cached-history guard drift from what `seed-blast.ts` claims in its own
 * docblock — i.e. exactly the class of regression a hand-patched facade in
 * `blast.it.test.ts` cannot catch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { BlastRadius, PrHistory } from '@devdigest/shared';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The four `pr_files` paths seeded for PR #482 — none of these may ever get
 *  a `file_rank` row (D5: a changed file without rank keeps every existing
 *  review prompt byte-identical). */
const PR_FILE_PATHS = [
  'src/middleware/ratelimit.ts',
  'src/api/public/webhooks.ts',
  'src/config.ts',
  'src/api/users.ts',
];

d('seed-blast fixture (it)', () => {
  let pg: PgFixture;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    await seed(pg.handle.db);

    const [row] = await pg.handle.db
      .select({ prId: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.repos.fullName, 'acme/payments-api'), eq(t.pullRequests.number, 482)));
    prId = row!.prId;
    repoId = row!.repoId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('GET /pulls/:id/blast-radius returns the seeded map through the real facade', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast-radius` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(BlastRadius.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      changed_symbols: [
        { name: 'rateLimit', file: 'src/middleware/ratelimit.ts', kind: 'function' },
        { name: 'listUsers', file: 'src/api/users.ts', kind: 'function' },
        { name: 'RateLimitOptions', file: 'src/middleware/ratelimit.ts', kind: 'interface' },
      ],
      downstream: [
        {
          symbol: 'rateLimit',
          callers: [
            {
              name: 'registerPublicRoutes',
              file: 'src/api/public/index.ts',
              line: 11,
              endpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
            },
            { name: 'buildServer', file: 'src/server.ts', line: 31 },
          ],
          endpoints_affected: ['GET /api/public/items', 'POST /api/public/webhooks'],
          crons_affected: [],
        },
        {
          symbol: 'listUsers',
          callers: [
            {
              name: 'adminListUsers',
              file: 'src/api/admin/users.ts',
              line: 19,
              endpoints: ['GET /api/admin/users'],
            },
            {
              name: 'sendDailyDigest',
              file: 'src/jobs/digest.ts',
              line: 22,
              crons: ['job:daily_digest'],
            },
          ],
          endpoints_affected: ['GET /api/admin/users'],
          crons_affected: ['job:daily_digest'],
        },
      ],
      summary: '3 changed symbols; 4 callers in 4 files; 3 endpoints; 1 cron.',
      degraded: false,
      reason: null,
    });

    await app.close();
  });

  it('GET /pulls/:id/history returns the cached prior PR with zero GitHub calls', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/history` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(PrHistory.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      history: [
        {
          pr_number: 471,
          title: 'Move public routes under /api/public',
          merged_at: '2026-08-14T12:00:00Z',
          author: 'dev.okafor',
          files_overlap: ['src/api/users.ts', 'src/middleware/ratelimit.ts'],
          notes: "Touched 2 of this PR's files; merged 2026-08-14.",
        },
      ],
    });
    // The fixture is cached keyed to the PR's own head sha (`seed-blast.ts`),
    // so this route is a pure cache read and never calls GitHub.
    expect(gh.commitsForPathCalls.length).toBe(0);

    await app.close();
  });

  it('the double seed leaves exactly one full-status index and stable row counts', async () => {
    const db = pg.handle.db;

    const symbolRows = await db.select().from(t.symbols).where(eq(t.symbols.repoId, repoId));
    expect(symbolRows).toHaveLength(7);

    const referenceRows = await db
      .select()
      .from(t.references)
      .where(eq(t.references.repoId, repoId));
    expect(referenceRows).toHaveLength(4);
    for (const r of referenceRows) expect(r.declFile).not.toBeNull();

    const fileRankRows = await db.select().from(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    expect(fileRankRows).toHaveLength(4);
    for (const path of PR_FILE_PATHS) {
      expect(fileRankRows.some((row) => row.filePath === path)).toBe(false);
    }

    const factRows = await db.select().from(t.fileFacts).where(eq(t.fileFacts.repoId, repoId));
    expect(factRows).toHaveLength(3);

    const stateRows = await db
      .select()
      .from(t.repoIndexState)
      .where(eq(t.repoIndexState.repoId, repoId));
    expect(stateRows).toHaveLength(1);
    expect(stateRows[0]!.status).toBe('full');
    expect(stateRows[0]!.indexerVersion).toBe(INDEXER_VERSION);
  });
});
