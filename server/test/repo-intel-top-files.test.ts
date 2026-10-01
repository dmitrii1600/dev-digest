import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';

/**
 * Onboarding AC-6 — `getTopFilesByRank` is what picks the Guided reading path:
 * tests, configs, declaration files and migrations never appear, order is the
 * ranked order, and the junk does not eat into the N. No Postgres: the service's
 * `repo` is patched (same harness as repo-intel-critical-paths.test.ts), so this
 * is a plain `*.test.ts`.
 */

function build(rows: string[], enabled = true): { svc: RepoIntelService; limits: number[] } {
  const limits: number[] = [];
  const container = { config: { repoIntelEnabled: enabled }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    // honours LIMIT like SQL does, rank order = array order
    getRankedPaths: async (_id: string, limit: number) => {
      limits.push(limit);
      return rows.slice(0, limit).map((path, i) => ({ path, rank: 1 - i / 1000 }));
    },
  };
  return { svc, limits };
}

const JUNK = [
  'src/foo.test.ts',
  'src/foo.spec.ts',
  'src/types.d.ts',
  'vite.config.ts',
  'server/src/db/migrations/0001_init.ts',
  'src/__tests__/a.ts',
  'server/test/helpers/pg.ts',
  'eslint.config.mjs',
];

describe('getTopFilesByRank — reading-path selection (AC-6)', () => {
  it('drops tests, configs, declaration files and migrations; keeps ranked order', async () => {
    const real = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const { svc } = build([JUNK[0]!, real[0]!, ...JUNK.slice(1, 4), real[1]!, ...JUNK.slice(4), real[2]!]);
    expect(await svc.getTopFilesByRank('r1', 8)).toEqual(real);
  });

  it('junk at the top of the ranking does not shrink the result below N', async () => {
    const junk = Array.from({ length: 30 }, (_, i) => `src/gen${i}.test.ts`);
    const real = Array.from({ length: 12 }, (_, i) => `src/real${String(i).padStart(2, '0')}.ts`);
    const { svc, limits } = build([...junk, ...real]);
    const top = await svc.getTopFilesByRank('r1', 8);
    expect(top).toEqual(real.slice(0, 8));
    expect(limits[0]).toBeGreaterThan(30); // over-fetched past the junk
  });

  it('drops root-level test/tests/migrations/__fixtures__ directories too (no leading slash in the path)', async () => {
    const real = ['src/a.ts', 'src/b.ts'];
    const rootJunk = ['test/x.ts', 'tests/x.ts', 'migrations/0001.ts', '__fixtures__/a.ts', 'Tests/Y.ts'];
    const { svc } = build([...rootJunk.slice(0, 3), real[0]!, ...rootJunk.slice(3), real[1]!]);
    expect(await svc.getTopFilesByRank('r1', 8)).toEqual(real);
  });

  it('does not drop a path that merely contains a junk word inside a segment', async () => {
    const real = ['src/contest/x.ts', 'latest/x.ts', 'src/attests/a.ts', 'src/migrations-guide.ts'];
    const { svc } = build(real);
    expect(await svc.getTopFilesByRank('r1', 8)).toEqual(real);
  });

  it('flag off → [] and the index is never read', async () => {
    const { svc, limits } = build(['src/a.ts'], false);
    expect(await svc.getTopFilesByRank('r1', 8)).toEqual([]);
    expect(limits).toEqual([]);
  });
});
