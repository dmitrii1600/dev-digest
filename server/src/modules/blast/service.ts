import type { BlastRadius, PrHistory, RepoRef } from '@devdigest/shared';
import type { RepoIntel } from '../repo-intel/types.js';
import type { BlastRepository } from './repository.js';
import {
  buildPrHistory,
  collectUniqueCommits,
  emptyBlastRadius,
  resolveDegraded,
  selectHistoryFiles,
  toBlastRadius,
  type GhCommitRef,
  type GhPrRef,
} from './helpers.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — onion rule 1. */
export interface BlastLogger {
  info: (obj: unknown, msg?: string) => void;
}

/** Structured logger with `warn`, for the "GitHub adapter failed" path. */
export interface PrHistoryLogger {
  warn: (obj: unknown, msg?: string) => void;
}

/** The two GitHub primitives "Prior PRs" needs — a lazy port, wired the same
 *  way `routes.ts` wires `RepoIntel` (server/INSIGHTS.md:17). */
export interface PrHistoryGitHubPort {
  listCommitsForPath(repo: RepoRef, path: string, perPage: number): Promise<GhCommitRef[]>;
  listPullsForCommit(repo: RepoRef, sha: string): Promise<GhPrRef[]>;
}

/**
 * Ring 2 — the blast-radius use case. Takes its collaborators as constructor
 * arguments (onion rule 9); `routes.ts` wires them, so this is unit-tested
 * hermetically with plain fakes (no Postgres, no Container).
 */
export class BlastService {
  constructor(
    private readonly deps: {
      prs: Pick<BlastRepository, 'getPrScope'>;
      index: Pick<RepoIntel, 'getBlastRadius' | 'getIndexState'>;
      log: BlastLogger;
      repoIntelEnabled: boolean;
      maxCallersPerSymbol: number;
      /** `INDEXER_VERSION` — an index stamped with an older one is stale. */
      indexerVersion: number;
      /** Queues a background resync (never awaited for the response). */
      requestReindex: (workspaceId: string, repoId: string) => Promise<void>;
      /** Minimum gap between two reindex nudges for the same repo. */
      reindexNudgeIntervalMs: number;
      now?: () => number;
    },
  ) {}

  /** repoId → epoch ms of the last nudge, so a page refresh does not enqueue
      a job per request while the rebuild is still running. */
  private readonly lastNudgeAt = new Map<string, number>();

  /** `null` → the route throws `NotFoundError`. */
  async forPull(workspaceId: string, prId: string): Promise<BlastRadius | null> {
    const scope = await this.deps.prs.getPrScope(workspaceId, prId);
    if (!scope) return null;
    if (scope.files.length === 0) return emptyBlastRadius();

    const start = Date.now();
    const [result, state] = await Promise.all([
      this.deps.index.getBlastRadius(scope.repoId, scope.files),
      this.deps.index.getIndexState(scope.repoId),
    ]);

    const { degraded, reason } = resolveDegraded(
      result,
      state,
      this.deps.repoIntelEnabled,
      this.deps.indexerVersion,
    );
    const reindexQueued = reason === 'index_stale' ? await this.nudgeReindex(workspaceId, scope.repoId) : false;
    const out = toBlastRadius({
      result,
      changedFilesCount: scope.files.length,
      degraded,
      reason,
      maxCallersPerSymbol: this.deps.maxCallersPerSymbol,
    });

    const source =
      this.deps.repoIntelEnabled && (state.status === 'full' || state.status === 'partial')
        ? 'index'
        : 'fallback';

    // Proves an index READ, not a rebuild — nothing else in the codebase logs
    // this today, and this route never calls indexRepo/refreshIndex/resyncRepo.
    this.deps.log.info(
      {
        prId: scope.prId,
        repoId: scope.repoId,
        changedFiles: scope.files.length,
        symbols: out.changed_symbols.length,
        callers: out.downstream.reduce((sum, d) => sum + d.callers.length, 0),
        indexStatus: state.status,
        indexedSha: state.lastIndexedSha || null,
        source,
        degraded: out.degraded,
        reason: out.reason,
        reindexQueued,
        ms: Date.now() - start,
      },
      'blast radius read from repo-intel index (no re-index)',
    );

    return out;
  }

  /** Self-healing for `index_stale`: enqueue one resync per repo per interval.
      The read above already happened; this only schedules background work and
      never fails the request. Returns whether a job was queued this time. */
  private async nudgeReindex(workspaceId: string, repoId: string): Promise<boolean> {
    const now = (this.deps.now ?? Date.now)();
    const last = this.lastNudgeAt.get(repoId) ?? 0;
    if (now - last < this.deps.reindexNudgeIntervalMs) return false;
    this.lastNudgeAt.set(repoId, now);
    try {
      await this.deps.requestReindex(workspaceId, repoId);
      return true;
    } catch {
      this.lastNudgeAt.delete(repoId);
      return false;
    }
  }
}

/**
 * "Prior PRs touching these files" (spec 09, P3-d) — ring 2. Reads GitHub
 * commit/PR history for a capped set of the PR's changed files, cached in
 * `pr_brief.json.history` keyed by `head_sha` (`repository.ts`
 * `getCachedHistory`/`upsertHistory`). No LLM. When the GitHub adapter fails
 * (no token, rate limit, network) this returns `{ history: [] }` and logs a
 * warning — it never throws and the route never 500s for it.
 */
export class PrHistoryService {
  constructor(
    private readonly deps: {
      prs: Pick<BlastRepository, 'getPrHistoryScope' | 'getCachedHistory' | 'upsertHistory'>;
      github: PrHistoryGitHubPort;
      log: PrHistoryLogger;
      maxFiles: number;
      maxCommitsPerFile: number;
      maxUniqueCommits: number;
      maxPrs: number;
    },
  ) {}

  /** `null` → the route throws `NotFoundError`. */
  async forPull(workspaceId: string, prId: string): Promise<PrHistory | null> {
    const scope = await this.deps.prs.getPrHistoryScope(workspaceId, prId);
    if (!scope) return null;
    if (scope.files.length === 0) return { history: [] };

    const cached = await this.deps.prs.getCachedHistory(scope.prId);
    if (cached && cached.computedForSha === scope.headSha) {
      return { history: cached.history };
    }

    try {
      const repo: RepoRef = { owner: scope.owner, name: scope.name };
      const candidateFiles = selectHistoryFiles(scope.files, this.deps.maxFiles);

      const commitsByFile = new Map<string, GhCommitRef[]>();
      await Promise.all(
        candidateFiles.map(async (file) => {
          const commits = await this.deps.github.listCommitsForPath(
            repo,
            file,
            this.deps.maxCommitsPerFile,
          );
          commitsByFile.set(file, commits);
        }),
      );

      const commitFiles = collectUniqueCommits(commitsByFile, this.deps.maxUniqueCommits);

      const pullsByCommit = new Map<string, GhPrRef[]>();
      await Promise.all(
        [...commitFiles.keys()].map(async (sha) => {
          const pulls = await this.deps.github.listPullsForCommit(repo, sha);
          pullsByCommit.set(sha, pulls);
        }),
      );

      const history = buildPrHistory({
        commitFiles,
        pullsByCommit,
        excludeNumber: scope.number,
        maxPrs: this.deps.maxPrs,
      });

      await this.deps.prs.upsertHistory(scope.prId, scope.headSha, history);
      return { history };
    } catch (err) {
      this.deps.log.warn(
        { prId: scope.prId, repoId: scope.repoId, err: (err as Error).message },
        'pr history: GitHub adapter failed — returning empty history',
      );
      return { history: [] };
    }
  }
}
