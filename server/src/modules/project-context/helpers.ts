import type { ContextDocKind } from '@devdigest/shared';

/** Pure rules — no I/O. Kind is derived from the path alone (first match wins). */
export function kindForPath(path: string): ContextDocKind {
  const segments = path.split('/');
  const dirs = segments.slice(0, -1);
  const base = segments[segments.length - 1] ?? '';
  if (dirs.includes('specs')) return 'specs';
  if (dirs.includes('docs')) return 'docs';
  if (base === 'INSIGHTS.md' || dirs.includes('insights')) return 'insights';
  return 'other';
}

/** Agent paths first, then each skill's list in order; first occurrence wins. */
export function orderForInjection(
  agentPaths: readonly string[],
  skillPathLists: ReadonlyArray<readonly string[]>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [agentPaths, ...skillPathLists]) {
    for (const p of list) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Distinct agents per path. */
export function countUsedBy(
  pairs: ReadonlyArray<{ agentId: string; path: string }>,
): Map<string, number> {
  const agentsByPath = new Map<string, Set<string>>();
  for (const { agentId, path } of pairs) {
    let set = agentsByPath.get(path);
    if (!set) agentsByPath.set(path, (set = new Set()));
    set.add(agentId);
  }
  const out = new Map<string, number>();
  for (const [path, set] of agentsByPath) out.set(path, set.size);
  return out;
}

/** Requested paths not already persisted — only these need the listing check. */
export function newPaths(requested: readonly string[], persisted: readonly string[]): string[] {
  const have = new Set(persisted);
  return requested.filter((p) => !have.has(p));
}
