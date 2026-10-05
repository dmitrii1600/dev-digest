import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';

/**
 * Onboarding step 1 — getCriticalPaths is deterministic (AC-8, NFR-2).
 * Equal-rank import targets must resolve by path ASC whatever order the edge
 * list comes back in. No Postgres: the service's `repo` is patched.
 */

type Edge = { fromFile: string; toFile: string };

function build(edges: Edge[]): RepoIntelService {
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getEdges: async () => edges,
    getRankedPaths: async () => [
      { path: 'src/root.ts', rank: 0.9 },
      { path: 'src/a.ts', rank: 0.5 },
      { path: 'src/b.ts', rank: 0.5 },
    ],
  };
  return svc;
}

const toA: Edge = { fromFile: 'src/root.ts', toFile: 'src/a.ts' };
const toB: Edge = { fromFile: 'src/root.ts', toFile: 'src/b.ts' };

describe('getCriticalPaths — tie-break by path', () => {
  it('picks the lexically smaller of two equal-rank targets, in both edge orders', async () => {
    const ab = await build([toA, toB]).getCriticalPaths('r1');
    const ba = await build([toB, toA]).getCriticalPaths('r1');
    expect(ab).toEqual([['src/root.ts', 'src/a.ts']]);
    expect(ba).toEqual(ab);
  });

  it('two calls give identical results (NFR-2)', async () => {
    const svc = build([toB, toA]);
    const first = await svc.getCriticalPaths('r1');
    const second = await svc.getCriticalPaths('r1');
    expect(second).toEqual(first);
  });
});
