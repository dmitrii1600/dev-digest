import type { PrHistoryItem } from '@devdigest/shared';
import { INDEXER_VERSION } from '../modules/repo-intel/constants.js';
import {
  RepoIntelRepository,
  type IndexerEdgeRow,
  type IndexerFileFactsRow,
  type IndexerFileRankRow,
} from '../modules/repo-intel/repository.js';
import { BlastRepository } from '../modules/blast/repository.js';
import { buildHistoryNote } from '../modules/blast/helpers.js';
import type { Db } from './client.js';

/**
 * Demo blast-radius index + prior-PR history for the seeded PR #482 (Blast
 * Radius, L04): a deterministic, synthetic `full` repo-intel index, so the
 * Overview tab's `BlastRadiusPanel` renders real data instead of degrading to
 * `no_data` — the seeded repo (`acme/payments-api`) has `clonePath: null`,
 * so there is no clone to actually index.
 *
 * Written through `RepoIntelRepository` and `BlastRepository`, never raw
 * inserts (precedent: `seed-intent.ts` imports `modules/intent/helpers.js`;
 * `db/**` is ring 3 and lint/arch allow `db → modules`). `references.decl_file`
 * is set by the real resolution SQL (`resolveReferences`), so the fixture can
 * never drift from what the indexer itself would have stored.
 *
 * Idempotency: the index part is skipped once `repo_index_state` already
 * reports `status: 'full'` at the current `INDEXER_VERSION` — otherwise it
 * wipes and rebuilds, writing the state row LAST so a half-run (or an
 * `INDEXER_VERSION` bump) heals on the next `pnpm db:seed`. The history part
 * has its own guard: it only writes when the cache is missing or stale for
 * `pr.headSha`.
 *
 * Fixture shape: two changed files declare the three changed symbols
 * (`rateLimit`, `RateLimitOptions` in `ratelimit.ts`; `listUsers` in
 * `users.ts`); four caller files reference them and get `file_rank` rows
 * (callers only — `getResolvedCallers` inner-joins `file_rank` on
 * `from_path`, so a changed file without a rank row keeps every existing
 * review prompt byte-identical); three of those callers carry `file_facts`
 * (endpoints/crons) so the panel's "N endpoints"/"N cron" stats and the
 * downstream groups have something to attribute.
 *
 * Expected `GET /pulls/:id/blast-radius`: `degraded: false`, 3 changed
 * symbols, 4 callers across 4 files, 3 endpoints, 1 cron — summary
 * `"3 changed symbols; 4 callers in 4 files; 3 endpoints; 1 cron."`.
 * Expected `GET /pulls/:id/history`: 1 cached item, zero GitHub calls.
 */

interface SeedSymbolFixture {
  path: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
  signature: string | null;
}

/** The three changed symbols (declared in the PR's own changed files). */
const SEED_SYMBOLS: SeedSymbolFixture[] = [
  {
    path: 'src/middleware/ratelimit.ts',
    name: 'rateLimit',
    kind: 'function',
    line: 18,
    endLine: 72,
    signature: 'export function rateLimit(opts: RateLimitOptions): preHandlerHookHandler',
  },
  {
    path: 'src/middleware/ratelimit.ts',
    name: 'RateLimitOptions',
    kind: 'interface',
    line: 5,
    endLine: 12,
    signature: 'export interface RateLimitOptions',
  },
  {
    path: 'src/api/users.ts',
    name: 'listUsers',
    kind: 'function',
    line: 40,
    endLine: 58,
    signature: 'export async function listUsers(req: FastifyRequest): Promise<User[]>',
  },
  {
    path: 'src/api/public/index.ts',
    name: 'registerPublicRoutes',
    kind: 'function',
    line: 8,
    endLine: 30,
    signature: null,
  },
  { path: 'src/server.ts', name: 'buildServer', kind: 'function', line: 10, endLine: 48, signature: null },
  {
    path: 'src/api/admin/users.ts',
    name: 'adminListUsers',
    kind: 'function',
    line: 12,
    endLine: 27,
    signature: null,
  },
  {
    path: 'src/jobs/digest.ts',
    name: 'sendDailyDigest',
    kind: 'function',
    line: 6,
    endLine: 35,
    signature: null,
  },
];

interface SeedReferenceFixture {
  fromPath: string;
  toSymbol: string;
  line: number;
}

/** The four callers, each referencing one of the changed symbols. */
const SEED_REFERENCES: SeedReferenceFixture[] = [
  { fromPath: 'src/api/public/index.ts', toSymbol: 'rateLimit', line: 11 },
  { fromPath: 'src/server.ts', toSymbol: 'rateLimit', line: 31 },
  { fromPath: 'src/api/admin/users.ts', toSymbol: 'listUsers', line: 19 },
  { fromPath: 'src/jobs/digest.ts', toSymbol: 'listUsers', line: 22 },
];

/** Caller file → the changed file declaring the symbol it calls. Feeds
 *  `resolveReferences`, which sets `references.decl_file` from these edges. */
const SEED_EDGES: IndexerEdgeRow[] = [
  { fromFile: 'src/api/public/index.ts', toFile: 'src/middleware/ratelimit.ts' },
  { fromFile: 'src/server.ts', toFile: 'src/middleware/ratelimit.ts' },
  { fromFile: 'src/api/admin/users.ts', toFile: 'src/api/users.ts' },
  { fromFile: 'src/jobs/digest.ts', toFile: 'src/api/users.ts' },
];

/** Caller files only — `getResolvedCallers` inner-joins `file_rank` on
 *  `from_path`, so the four changed files deliberately get no rank row. */
const SEED_FILE_RANK: IndexerFileRankRow[] = [
  { filePath: 'src/api/public/index.ts', pagerank: 0.12, hotness: 0, rank: 0.12, percentile: 90 },
  { filePath: 'src/server.ts', pagerank: 0.09, hotness: 0, rank: 0.09, percentile: 80 },
  { filePath: 'src/api/admin/users.ts', pagerank: 0.05, hotness: 0, rank: 0.05, percentile: 60 },
  { filePath: 'src/jobs/digest.ts', pagerank: 0.03, hotness: 0, rank: 0.03, percentile: 40 },
];

/** Per-caller-file facts the panel attributes to the downstream groups. */
const SEED_FILE_FACTS: IndexerFileFactsRow[] = [
  {
    filePath: 'src/api/public/index.ts',
    endpoints: ['GET /api/public/items', 'POST /api/public/webhooks'],
    crons: [],
  },
  { filePath: 'src/api/admin/users.ts', endpoints: ['GET /api/admin/users'], crons: [] },
  { filePath: 'src/jobs/digest.ts', endpoints: [], crons: ['job:daily_digest'] },
];

/** One cached "prior PR" so "Prior PRs touching these files" renders a real
 *  row with zero GitHub calls (`blast/service.ts` cache-hit path). */
const SEED_HISTORY: PrHistoryItem[] = [
  {
    pr_number: 471,
    title: 'Move public routes under /api/public',
    merged_at: '2026-08-14T12:00:00Z',
    author: 'dev.okafor',
    files_overlap: ['src/api/users.ts', 'src/middleware/ratelimit.ts'],
    notes: buildHistoryNote(2, '2026-08-14T12:00:00Z'),
  },
];

export async function seedBlast(
  db: Db,
  repoId: string,
  pr: { id: string; headSha: string },
): Promise<void> {
  const repoIntel = new RepoIntelRepository(db);

  const state = await repoIntel.tryGetIndexState(repoId);
  const isFresh = state?.status === 'full' && state.indexerVersion === INDEXER_VERSION;
  if (!isFresh) {
    await repoIntel.deleteAllForRepo(repoId);

    await repoIntel.insertSymbols(
      SEED_SYMBOLS.map((s) => ({
        repoId,
        path: s.path,
        name: s.name,
        kind: s.kind,
        line: s.line,
        endLine: s.endLine,
        exported: true,
        signature: s.signature,
        contentHash: 'seed',
      })),
    );

    await repoIntel.insertReferences(
      SEED_REFERENCES.map((r) => ({
        repoId,
        fromPath: r.fromPath,
        toSymbol: r.toSymbol,
        line: r.line,
        contentHash: 'seed',
      })),
    );

    await repoIntel.replaceEdges(repoId, SEED_EDGES);
    await repoIntel.replaceFileRank(repoId, SEED_FILE_RANK);
    await repoIntel.replaceFileFacts(repoId, SEED_FILE_FACTS);
    // Sets `references.decl_file` from the edges + exported symbols above —
    // the same SQL the real indexer runs, so the fixture cannot drift from it.
    await repoIntel.resolveReferences(repoId, { reset: false });

    // State row LAST: a half-run (crash between deleteAllForRepo and here)
    // or an INDEXER_VERSION bump both heal on the next `pnpm db:seed`.
    await repoIntel.upsertIndexState({
      repoId,
      lastIndexedSha: pr.headSha,
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 8,
      filesSkipped: 0,
      stats: {
        source: 'seed',
        durationMs: 0,
        filesSeen: 8,
        symbolsWritten: SEED_SYMBOLS.length,
        referencesWritten: SEED_REFERENCES.length,
        edgesWritten: SEED_EDGES.length,
        ranked: SEED_FILE_RANK.length,
        factsWritten: SEED_FILE_FACTS.length,
        hotnessAvailable: false,
      },
    });
  }

  // ---- prior PRs: one cached row keyed to this PR's head sha ----
  const blast = new BlastRepository(db);
  const cached = await blast.getCachedHistory(pr.id);
  if (cached?.computedForSha !== pr.headSha) {
    await blast.upsertHistory(pr.id, pr.headSha, SEED_HISTORY);
  }
}
