/**
 * depgraph adapter — `toRel` must emit repo-relative POSIX paths on every
 * platform and for every spelling of the clone root. Two silent failure modes
 * are pinned here, because each one yields 0 edges (and so 0 resolved callers
 * in the blast radius) with the index still stamped `full`:
 *   1. On Windows `path.relative()` returns backslashes, which never matched
 *      the POSIX `files` set in `buildEdges`.
 *   2. When the clone dir sits behind a junction/symlink, cruise reports a
 *      module's `source` through the given path but its dependencies'
 *      `resolved` paths through the real one, so `relative()` climbed out of
 *      the root (`../../…`). Both sides now go through `realpath`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
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

describe('depgraph toRel — clone dir behind a junction/symlink', () => {
  let base = '';
  let real = '';
  let link = '';
  let linkOk = false;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'devdigest-depgraph-'));
    real = join(base, 'real', 'owner', 'repo');
    mkdirSync(join(real, 'src'), { recursive: true });
    writeFileSync(join(real, 'src', 'a.ts'), 'export const a = 1;\n');
    link = join(base, 'link');
    try {
      // 'junction' needs no privileges on Windows; on POSIX it is a plain
      // directory symlink.
      symlinkSync(join(base, 'real'), link, 'junction');
      linkOk = true;
    } catch {
      linkOk = false;
    }
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('maps a real-path dependency back under a junction root', () => {
    if (!linkOk) return; // no symlink support here — nothing to pin
    const rootViaLink = join(link, 'owner', 'repo');
    const depViaRealPath = join(real, 'src', 'a.ts');
    expect(toRel(rootViaLink, depViaRealPath)).toBe('src/a.ts');
  });

  it('maps a junction-path source under a real-path root', () => {
    if (!linkOk) return;
    const sourceViaLink = join(link, 'owner', 'repo', 'src', 'a.ts');
    expect(toRel(real, sourceViaLink)).toBe('src/a.ts');
  });
});
