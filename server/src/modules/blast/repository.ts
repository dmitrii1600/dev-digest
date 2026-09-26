import { and, eq } from 'drizzle-orm';
import type { PrHistoryItem } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * The PR's blast-radius scope: which repo it belongs to and which files it
 * touches (persisted `pr_files.path`, written only by `GET /pulls/:id` —
 * see `modules/pulls/routes.ts:241-252`).
 */
export interface PrScope {
  prId: string;
  repoId: string;
  files: string[];
}

/**
 * The PR's "Prior PRs touching these files" scope — like `PrScope` but also
 * carries the repo's `owner`/`name` (for `RepoRef`), the PR's own `number`
 * (to exclude itself from its own history) and `headSha` (the cache key).
 */
export interface PrHistoryScope {
  prId: string;
  repoId: string;
  number: number;
  headSha: string;
  owner: string;
  name: string;
  files: string[];
}

/** `pr_brief.json.history` — cached "Prior PRs" result, keyed by the sha it
 *  was computed for (`repository.ts` `upsertHistory`/`getCachedHistory`). */
export interface CachedHistory {
  computedForSha: string;
  history: PrHistoryItem[];
}

/**
 * Ring 3 — the only Drizzle in this module. Reads the PR's scope; never
 * `$inferSelect` in the return type (rule 5 — a row shape is not a domain
 * type). `container.reviewRepo.getPull`/`getPrFiles` are deliberately not
 * reused here: they return row types, which would leak into a ring-2 (`service.ts`,
 * `helpers.ts`) signature.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  async getPrScope(workspaceId: string, prId: string): Promise<PrScope | null> {
    const [pr] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) return null;

    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, pr.id));
    const files = [...new Set(rows.map((r) => r.path))].sort();

    return { prId: pr.id, repoId: pr.repoId, files };
  }

  /** Scope for "Prior PRs touching these files" — joins `repos` for
   *  `owner`/`name` (the `RepoRef` GitHub calls need) alongside the PR's own
   *  `number` (self-exclusion) and `headSha` (the cache key). */
  async getPrHistoryScope(workspaceId: string, prId: string): Promise<PrHistoryScope | null> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        headSha: t.pullRequests.headSha,
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!row) return null;

    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, row.id));
    const files = [...new Set(rows.map((r) => r.path))].sort();

    return {
      prId: row.id,
      repoId: row.repoId,
      number: row.number,
      headSha: row.headSha,
      owner: row.owner,
      name: row.name,
      files,
    };
  }

  /** Read `pr_brief.json.history`; `null` when there is no row or no cached
   *  history yet (never thrown — a missing cache is a normal miss). */
  async getCachedHistory(prId: string): Promise<CachedHistory | null> {
    const [row] = await this.db
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    if (!row) return null;
    const json = row.json as Record<string, unknown> | null;
    const h = json?.['history'] as { computed_for_sha?: unknown; history?: unknown } | undefined;
    if (!h || typeof h.computed_for_sha !== 'string' || !Array.isArray(h.history)) return null;
    return { computedForSha: h.computed_for_sha, history: h.history as PrHistoryItem[] };
  }

  /**
   * Merge-write `pr_brief.json.history`, preserving whatever else the
   * document already holds (`intent`/`blast`/`risks` land there too, per
   * `PrBrief` — `contracts/brief.ts:157-164`). `pr_brief.json` is `NOT NULL`,
   * so a first write for this PR still needs the read-merge-write.
   */
  async upsertHistory(
    prId: string,
    computedForSha: string,
    history: PrHistoryItem[],
  ): Promise<void> {
    const [row] = await this.db
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    const base = (row?.json as Record<string, unknown> | null) ?? {};
    const next = { ...base, history: { computed_for_sha: computedForSha, history } };
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: next })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: next } });
  }
}
