import type { BlastRadius } from '@devdigest/shared';
import type { RepoIntel } from '../repo-intel/types.js';
import type { BlastRepository } from './repository.js';
import { emptyBlastRadius, resolveDegraded, toBlastRadius } from './helpers.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — onion rule 1. */
export interface BlastLogger {
  info: (obj: unknown, msg?: string) => void;
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
    },
  ) {}

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

    const { degraded, reason } = resolveDegraded(result, state, this.deps.repoIntelEnabled);
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
        ms: Date.now() - start,
      },
      'blast radius read from repo-intel index (no re-index)',
    );

    return out;
  }
}
