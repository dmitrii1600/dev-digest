import { describe, it, expect } from 'vitest';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import type {
  ProjectContextDeps,
  ProjectContextStore,
} from '../src/modules/project-context/types.js';

type PathsForRun = Awaited<ReturnType<ProjectContextStore['pathsForRun']>>;

/**
 * `enabled` is the SQL's job (`enabledAgentIds` returns enabled agents only, in
 * `created_at asc, id asc`); it is covered on Postgres in `brief.it.test.ts`. The
 * fake returns exactly the ids the real query would.
 */
function makeService(opts: {
  enabled: string[];
  runs: Record<string, PathsForRun>;
  unreadable?: string[];
}) {
  const reads: string[] = [];
  const store = {
    enabledAgentIds: async () => opts.enabled,
    pathsForRun: async (agentId: string) => opts.runs[agentId] ?? { agentPaths: [], skills: [] },
  } as unknown as ProjectContextStore;
  const deps = {
    repo: store,
    readDoc: async (_clone: string, rel: string) => {
      reads.push(rel);
      if (opts.unreadable?.includes(rel)) return null;
      return { text: `body of ${rel}`, truncated: rel === 'cut.md', version: 'v' };
    },
    countTokens: (s: string) => s.length,
  } as unknown as ProjectContextDeps;
  return { service: new ProjectContextService(deps), reads };
}

const input = (clonePath: string | null = '/clone') => ({
  workspaceId: 'ws',
  repoId: 'r1',
  clonePath,
});

describe('ProjectContextService.resolveForRepo', () => {
  it("lists agent A's documents before agent B's, and A's own before A's skills'", async () => {
    const { service } = makeService({
      enabled: ['A', 'B'],
      runs: {
        A: { agentPaths: ['a1.md', 'a2.md'], skills: [{ skillId: 's', paths: ['as1.md'] }] },
        B: { agentPaths: ['b1.md'], skills: [] },
      },
    });
    const out = await service.resolveForRepo(input());
    expect(out.docs.map((d) => d.path)).toEqual(['a1.md', 'a2.md', 'as1.md', 'b1.md']);
  });

  it("keeps a path attached to both B and A's skill once, at A's position", async () => {
    const { service, reads } = makeService({
      enabled: ['A', 'B'],
      runs: {
        A: { agentPaths: ['a1.md'], skills: [{ skillId: 's', paths: ['shared.md'] }] },
        B: { agentPaths: ['shared.md', 'b1.md'], skills: [] },
      },
    });
    const out = await service.resolveForRepo(input());
    expect(out.docs.map((d) => d.path)).toEqual(['a1.md', 'shared.md', 'b1.md']);
    expect(reads.filter((r) => r === 'shared.md')).toHaveLength(1);
  });

  it('puts an unreadable path in skipped and a cut one in truncated, and sums tokens', async () => {
    const { service } = makeService({
      enabled: ['A'],
      runs: { A: { agentPaths: ['gone.md', 'cut.md', 'ok.md'], skills: [] } },
      unreadable: ['gone.md'],
    });
    const out = await service.resolveForRepo(input());
    expect(out.skipped).toEqual(['gone.md']);
    expect(out.truncated).toEqual(['cut.md']);
    expect(out.docs.map((d) => d.path)).toEqual(['cut.md', 'ok.md']);
    expect(out.tokens).toBeGreaterThan(0);
  });

  it('yields an empty result for a null clone, without reading', async () => {
    const { service, reads } = makeService({
      enabled: ['A'],
      runs: { A: { agentPaths: ['a1.md'], skills: [] } },
    });
    const out = await service.resolveForRepo(input(null));
    expect(out).toEqual({ docs: [], skipped: [], truncated: [], tokens: 0 });
    expect(reads).toEqual([]);
  });

  it("only reads the enabled agents' documents (a disabled agent is not returned by the store)", async () => {
    const { service } = makeService({
      enabled: ['A'],
      runs: {
        A: { agentPaths: ['a1.md'], skills: [] },
        DISABLED: { agentPaths: ['secret.md'], skills: [] },
      },
    });
    const out = await service.resolveForRepo(input());
    expect(out.docs.map((d) => d.path)).toEqual(['a1.md']);
  });
});
