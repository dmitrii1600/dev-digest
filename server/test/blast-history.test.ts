import { describe, it, expect, vi } from 'vitest';
import {
  buildHistoryNote,
  buildPrHistory,
  collectUniqueCommits,
  selectHistoryFiles,
  type GhCommitRef,
  type GhPrRef,
} from '../src/modules/blast/helpers.js';
import { PrHistoryService } from '../src/modules/blast/service.js';
import type { CachedHistory, PrHistoryScope } from '../src/modules/blast/repository.js';

/**
 * Hermetic tests for "Prior PRs touching these files" (spec 09, P3-d):
 *   - the pure helpers (`helpers.ts`) — file selection, commit dedupe/cap,
 *     the note sentence, and the PR grouping/exclusion/cap/order;
 *   - `PrHistoryService` — cache hit/miss, self/unmerged exclusion, and the
 *     GitHub-adapter-failure → empty path — with plain fakes, no Postgres.
 */

describe('selectHistoryFiles', () => {
  it('skips docs and lockfiles entirely', () => {
    const files = ['README.md', 'pnpm-lock.yaml', 'src/a.ts', 'docs/notes.md'];
    expect(selectHistoryFiles(files, 10)).toEqual(['src/a.ts']);
  });

  it('orders non-test source files ahead of test files', () => {
    const files = ['src/a.test.ts', 'src/b.ts', 'src/__tests__/c.ts', 'src/d.ts'];
    expect(selectHistoryFiles(files, 10)).toEqual(['src/b.ts', 'src/d.ts', 'src/a.test.ts', 'src/__tests__/c.ts']);
  });

  it('caps at the injected limit', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    expect(selectHistoryFiles(files, 2)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('collectUniqueCommits', () => {
  it('maps each sha to the set of files whose history surfaced it', () => {
    const commitsByFile = new Map<string, GhCommitRef[]>([
      ['a.ts', [{ sha: 'c1' }, { sha: 'c2' }]],
      ['b.ts', [{ sha: 'c1' }]],
    ]);
    const out = collectUniqueCommits(commitsByFile, 10);
    expect(out.get('c1')).toEqual(new Set(['a.ts', 'b.ts']));
    expect(out.get('c2')).toEqual(new Set(['a.ts']));
  });

  it('caps the number of unique shas, keeping the first ones seen', () => {
    const commitsByFile = new Map<string, GhCommitRef[]>([
      ['a.ts', [{ sha: 'c1' }, { sha: 'c2' }, { sha: 'c3' }]],
    ]);
    const out = collectUniqueCommits(commitsByFile, 2);
    expect([...out.keys()]).toEqual(['c1', 'c2']);
  });
});

describe('buildHistoryNote', () => {
  it('names the overlap count and the merge date', () => {
    expect(buildHistoryNote(3, '2026-03-18T10:00:00Z')).toBe(
      "Touched 3 of this PR's files; merged 2026-03-18.",
    );
  });
});

describe('buildPrHistory', () => {
  const PR_401: GhPrRef = {
    number: 401,
    title: 'Introduce public API namespace',
    merged_at: '2026-03-18T00:00:00Z',
    author: 'marisa.koch',
  };
  const PR_SELF: GhPrRef = { number: 1, title: 'self', merged_at: '2026-01-01T00:00:00Z', author: 'x' };
  const PR_UNMERGED: GhPrRef = { number: 2, title: 'open pr', merged_at: null, author: 'y' };

  it('excludes the viewed PR itself and anything unmerged', () => {
    const commitFiles = new Map([['c1', new Set(['src/a.ts'])]]);
    const pullsByCommit = new Map<string, GhPrRef[]>([['c1', [PR_401, PR_SELF, PR_UNMERGED]]]);
    const out = buildPrHistory({ commitFiles, pullsByCommit, excludeNumber: 1, maxPrs: 5 });
    expect(out.map((h) => h.pr_number)).toEqual([401]);
  });

  it('unions files_overlap across every commit that surfaced the PR, and notes the count', () => {
    const commitFiles = new Map([
      ['c1', new Set(['src/a.ts'])],
      ['c2', new Set(['src/b.ts'])],
    ]);
    const pullsByCommit = new Map<string, GhPrRef[]>([
      ['c1', [PR_401]],
      ['c2', [PR_401]],
    ]);
    const out = buildPrHistory({ commitFiles, pullsByCommit, excludeNumber: 0, maxPrs: 5 });
    expect(out).toEqual([
      {
        pr_number: 401,
        title: 'Introduce public API namespace',
        merged_at: '2026-03-18T00:00:00Z',
        author: 'marisa.koch',
        files_overlap: ['src/a.ts', 'src/b.ts'],
        notes: "Touched 2 of this PR's files; merged 2026-03-18.",
      },
    ]);
  });

  it('caps the returned PRs and orders by merged_at desc', () => {
    const prs: GhPrRef[] = Array.from({ length: 7 }, (_, i) => ({
      number: 100 + i,
      title: `pr ${i}`,
      merged_at: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
      author: 'x',
    }));
    const commitFiles = new Map(prs.map((pr, i) => [`c${i}`, new Set([`f${i}.ts`])]));
    const pullsByCommit = new Map(prs.map((pr, i) => [`c${i}`, [pr]]));
    const out = buildPrHistory({ commitFiles, pullsByCommit, excludeNumber: -1, maxPrs: 3 });
    expect(out).toHaveLength(3);
    const dates = out.map((h) => h.merged_at);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('PrHistoryService', () => {
  function scope(overrides: Partial<PrHistoryScope> = {}): PrHistoryScope {
    return {
      prId: 'pr-1',
      repoId: 'repo-1',
      number: 1,
      headSha: 'sha-new',
      owner: 'acme',
      name: 'payments-api',
      files: ['src/a.ts'],
      ...overrides,
    };
  }

  function makeDeps(overrides: {
    scope?: PrHistoryScope | null;
    cached?: CachedHistory | null;
    listCommitsForPath?: ReturnType<typeof vi.fn>;
    listPullsForCommit?: ReturnType<typeof vi.fn>;
  } = {}) {
    const prs = {
      getPrHistoryScope: vi.fn().mockResolvedValue(overrides.scope === undefined ? scope() : overrides.scope),
      getCachedHistory: vi.fn().mockResolvedValue(overrides.cached ?? null),
      upsertHistory: vi.fn().mockResolvedValue(undefined),
    };
    const github = {
      listCommitsForPath: overrides.listCommitsForPath ?? vi.fn().mockResolvedValue([]),
      listPullsForCommit: overrides.listPullsForCommit ?? vi.fn().mockResolvedValue([]),
    };
    const log = { warn: vi.fn() };
    const service = new PrHistoryService({
      prs,
      github,
      log,
      maxFiles: 12,
      maxCommitsPerFile: 5,
      maxUniqueCommits: 40,
      maxPrs: 5,
    });
    return { service, prs, github, log };
  }

  it('returns null when the PR is not in the workspace', async () => {
    const { service, github } = makeDeps({ scope: null });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out).toBeNull();
    expect(github.listCommitsForPath).not.toHaveBeenCalled();
  });

  it('returns an empty map with no GitHub calls when the PR has no changed files', async () => {
    const { service, github, prs } = makeDeps({ scope: scope({ files: [] }) });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out).toEqual({ history: [] });
    expect(github.listCommitsForPath).not.toHaveBeenCalled();
    expect(prs.getCachedHistory).not.toHaveBeenCalled();
  });

  it('a cache hit at the current head sha returns the cached value with no GitHub calls', async () => {
    const cachedHistory = [
      {
        pr_number: 401,
        title: 'Introduce public API namespace',
        merged_at: '2026-03-18T00:00:00Z',
        author: 'marisa.koch',
        files_overlap: ['src/a.ts'],
        notes: "Touched 1 of this PR's files; merged 2026-03-18.",
      },
    ];
    const { service, github, prs } = makeDeps({
      cached: { computedForSha: 'sha-new', history: cachedHistory },
    });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out).toEqual({ history: cachedHistory });
    expect(github.listCommitsForPath).not.toHaveBeenCalled();
    expect(prs.upsertHistory).not.toHaveBeenCalled();
  });

  it('a stale cache (different head sha) recomputes and re-persists', async () => {
    const listCommitsForPath = vi.fn().mockResolvedValue([{ sha: 'c1' }]);
    const listPullsForCommit = vi.fn().mockResolvedValue([
      { number: 401, title: 'Introduce public API namespace', merged_at: '2026-03-18T00:00:00Z', author: 'marisa.koch' },
    ]);
    const { service, prs } = makeDeps({
      cached: { computedForSha: 'sha-old', history: [] },
      listCommitsForPath,
      listPullsForCommit,
    });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out?.history).toHaveLength(1);
    expect(out?.history[0]!.pr_number).toBe(401);
    expect(prs.upsertHistory).toHaveBeenCalledWith('pr-1', 'sha-new', out?.history);
  });

  it('excludes the PR itself from its own history', async () => {
    const listCommitsForPath = vi.fn().mockResolvedValue([{ sha: 'c1' }]);
    const listPullsForCommit = vi.fn().mockResolvedValue([
      { number: 1, title: 'self', merged_at: '2026-01-01T00:00:00Z', author: 'x' },
    ]);
    const { service } = makeDeps({ listCommitsForPath, listPullsForCommit });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out).toEqual({ history: [] });
  });

  it('excludes an unmerged PR', async () => {
    const listCommitsForPath = vi.fn().mockResolvedValue([{ sha: 'c1' }]);
    const listPullsForCommit = vi.fn().mockResolvedValue([
      { number: 9, title: 'still open', merged_at: null, author: 'x' },
    ]);
    const { service } = makeDeps({ listCommitsForPath, listPullsForCommit });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out).toEqual({ history: [] });
  });

  it('caps the candidate files and the unique commits fanned out to listPullsForCommit', async () => {
    const files = Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`);
    const listCommitsForPath = vi.fn().mockImplementation(async (_repo: unknown, path: string) => [
      { sha: `sha-${path}` },
    ]);
    const listPullsForCommit = vi.fn().mockResolvedValue([]);
    const { service } = makeDeps({
      scope: scope({ files }),
      listCommitsForPath,
      listPullsForCommit,
    });
    await service.forPull('ws1', 'pr-1');
    expect(listCommitsForPath).toHaveBeenCalledTimes(12); // MAX_HISTORY_FILES via maxFiles: 12
    expect(listPullsForCommit).toHaveBeenCalledTimes(12); // 12 unique commits, well under maxUniqueCommits: 40
  });

  it('falls back to an empty history and logs a warning when the GitHub adapter throws', async () => {
    const listCommitsForPath = vi.fn().mockRejectedValue(new Error('GITHUB_TOKEN is not configured'));
    const { service, log, prs } = makeDeps({ listCommitsForPath });
    const out = await service.forPull('ws1', 'pr-1');
    expect(out).toEqual({ history: [] });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(prs.upsertHistory).not.toHaveBeenCalled();
  });
});
