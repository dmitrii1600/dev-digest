import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import type { PrScope } from '../src/modules/blast/repository.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic unit tests for `BlastService` — plain `vi.fn()` fakes, no
 * Container, no Postgres (see server/INSIGHTS.md:166 / onion rule 9).
 */

function fakePrs(scope: PrScope | null) {
  return { getPrScope: vi.fn().mockResolvedValue(scope) };
}

const FULL_STATE: IndexState = {
  repoId: 'repo-1',
  status: 'full',
  filesIndexed: 12,
  filesSkipped: 0,
  durationMs: 5,
  lastIndexedSha: 'sha1',
  indexerVersion: 2,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const EMPTY_RESULT: BlastResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  degraded: false,
};

function fakeIndex(opts: { blast?: BlastResult; state?: IndexState } = {}) {
  return {
    getBlastRadius: vi.fn().mockResolvedValue(opts.blast ?? EMPTY_RESULT),
    getIndexState: vi.fn().mockResolvedValue(opts.state ?? FULL_STATE),
    // Not part of `RepoIntel`'s public port, but a fake shaped like the whole
    // facade so a service regression that reaches for a re-index method shows
    // up here rather than in production.
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    resyncRepo: vi.fn(),
  };
}

function fakeLog() {
  return { info: vi.fn() };
}

describe('BlastService.forPull', () => {
  it('returns null and makes no facade calls when the PR is not found', async () => {
    const prs = fakePrs(null);
    const index = fakeIndex();
    const service = new BlastService({
      prs,
      index,
      log: fakeLog(),
      repoIntelEnabled: true,
      maxCallersPerSymbol: 20,
    });

    const out = await service.forPull('ws-1', 'pr-missing');

    expect(out).toBeNull();
    expect(index.getBlastRadius).not.toHaveBeenCalled();
    expect(index.getIndexState).not.toHaveBeenCalled();
  });

  it('returns the empty value and makes no facade calls when the PR has no changed files', async () => {
    const prs = fakePrs({ prId: 'pr-1', repoId: 'repo-1', files: [] });
    const index = fakeIndex();
    const service = new BlastService({
      prs,
      index,
      log: fakeLog(),
      repoIntelEnabled: true,
      maxCallersPerSymbol: 20,
    });

    const out = await service.forPull('ws-1', 'pr-1');

    expect(out).toEqual({
      changed_symbols: [],
      downstream: [],
      summary: 'No changed files recorded for this PR.',
      degraded: false,
      reason: null,
    });
    expect(index.getBlastRadius).not.toHaveBeenCalled();
    expect(index.getIndexState).not.toHaveBeenCalled();
  });

  it('reads the facade exactly once per method, never re-indexes, and logs one index read', async () => {
    const prs = fakePrs({ prId: 'pr-1', repoId: 'repo-1', files: ['src/a.ts', 'src/b.ts'] });
    const index = fakeIndex();
    const log = fakeLog();
    const service = new BlastService({
      prs,
      index,
      log,
      repoIntelEnabled: true,
      maxCallersPerSymbol: 20,
    });

    const out = await service.forPull('ws-1', 'pr-1');

    expect(out).not.toBeNull();
    expect(index.getBlastRadius).toHaveBeenCalledTimes(1);
    expect(index.getBlastRadius).toHaveBeenCalledWith('repo-1', ['src/a.ts', 'src/b.ts']);
    expect(index.getIndexState).toHaveBeenCalledTimes(1);
    expect(index.getIndexState).toHaveBeenCalledWith('repo-1');
    expect(index.indexRepo).not.toHaveBeenCalled();
    expect(index.refreshIndex).not.toHaveBeenCalled();
    expect(index.resyncRepo).not.toHaveBeenCalled();

    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.info.mock.calls[0]!;
    expect(msg).toBe('blast radius read from repo-intel index (no re-index)');
    expect(fields).toMatchObject({
      source: 'index',
      indexStatus: 'full',
      prId: 'pr-1',
      repoId: 'repo-1',
      changedFiles: 2,
    });
  });

  it('reports flag_off and logs source:fallback when repo-intel is disabled', async () => {
    const prs = fakePrs({ prId: 'pr-1', repoId: 'repo-1', files: ['src/a.ts'] });
    const index = fakeIndex();
    const log = fakeLog();
    const service = new BlastService({
      prs,
      index,
      log,
      repoIntelEnabled: false,
      maxCallersPerSymbol: 20,
    });

    const out = await service.forPull('ws-1', 'pr-1');

    expect(out!.degraded).toBe(true);
    expect(out!.reason).toBe('flag_off');
    const [fields] = log.info.mock.calls[0]!;
    expect(fields).toMatchObject({ source: 'fallback' });
  });
});
