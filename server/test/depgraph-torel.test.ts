/**
 * depgraph adapter — `toRel` must emit repo-relative POSIX paths on every
 * platform. On Windows `path.relative()` returns backslashes, which never
 * matched the POSIX `files` set in `buildEdges`, so every edge was dropped and
 * `references.decl_file` stayed NULL (blast radius showed zero callers).
 */
import { describe, expect, it } from 'vitest';
import { resolve, sep } from 'node:path';
import { toRel } from '../src/adapters/depgraph/index.js';

const ROOT = resolve('/repo/clone');

describe('depgraph toRel', () => {
  it('returns a forward-slash repo-relative path for an absolute input', () => {
    const abs = resolve(ROOT, 'client', 'src', 'app', 'page.tsx');
    expect(toRel(ROOT, abs)).toBe('client/src/app/page.tsx');
  });

  it('keeps bracketed Next.js segments intact', () => {
    const abs = resolve(ROOT, 'client', 'src', 'app', 'repos', '[repoId]', 'page.tsx');
    expect(toRel(ROOT, abs)).toBe('client/src/app/repos/[repoId]/page.tsx');
  });

  it('never contains the platform separator when it is not "/"', () => {
    const abs = resolve(ROOT, 'server', 'src', 'index.ts');
    const rel = toRel(ROOT, abs);
    if (sep !== '/') expect(rel).not.toContain(sep);
    expect(rel).toBe('server/src/index.ts');
  });
});
