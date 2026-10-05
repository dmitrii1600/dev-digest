import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkLayout,
  createExclusive,
  readCurrent,
  removeAndPrune,
  replaceAtomic,
  resolveRealRoot,
  versionOf,
} from '../src/modules/project-context/repository-writes.js';

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

let base: string;
let clone: string;
let realRoot: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'pc-writes-'));
  clone = join(base, 'clone');
  await mkdir(clone);
  realRoot = (await resolveRealRoot(clone)) as string;
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('checkLayout (EC-4)', () => {
  it('a regular file at .devdigest -> layout', async () => {
    await writeFile(join(clone, '.devdigest'), 'x');
    expect(await checkLayout(realRoot, '.devdigest/specs/a.md', { createDirs: true })).toEqual({
      ok: false,
      rule: 'layout',
    });
  });

  it('.devdigest/specs as a symlink -> layout, and the link target is untouched', async () => {
    const target = join(base, 'elsewhere');
    await mkdir(target);
    await writeFile(join(target, 'keep.md'), 'keep');
    await mkdir(join(clone, '.devdigest'));
    await symlink(target, join(clone, '.devdigest', 'specs'), LINK_TYPE);
    const res = await checkLayout(realRoot, '.devdigest/specs/a.md', { createDirs: true });
    expect(res).toEqual({ ok: false, rule: 'layout' });
    expect(await readdir(target)).toEqual(['keep.md']);
  });

  it('a sub-folder link -> layout', async () => {
    const target = join(base, 'elsewhere');
    await mkdir(target);
    await mkdir(join(clone, '.devdigest/specs'), { recursive: true });
    await symlink(target, join(clone, '.devdigest/specs/sub'), LINK_TYPE);
    expect(await checkLayout(realRoot, '.devdigest/specs/sub/a.md', { createDirs: true })).toEqual({
      ok: false,
      rule: 'layout',
    });
  });

  it('a clone root that is itself a junction stays writable', async () => {
    const real = join(base, 'real-clone');
    await mkdir(real);
    const linked = join(base, 'linked-clone');
    await symlink(real, linked, LINK_TYPE);
    const root = (await resolveRealRoot(linked)) as string;
    const res = await checkLayout(root, '.devdigest/specs/a.md', { createDirs: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.exists).toBe(false);
      await createExclusive(res.abs, Buffer.from('hi'));
    }
    expect(await readFile(join(real, '.devdigest/specs/a.md'), 'utf8')).toBe('hi');
  });

  it('missing dirs without createDirs -> exists false, nothing created', async () => {
    const res = await checkLayout(realRoot, '.devdigest/specs/a.md', { createDirs: false });
    expect(res).toMatchObject({ ok: true, exists: false });
    await expect(stat(join(clone, '.devdigest'))).rejects.toThrow();
  });

  it('a directory named like the target -> layout', async () => {
    await mkdir(join(clone, '.devdigest/specs/a.md'), { recursive: true });
    expect(await checkLayout(realRoot, '.devdigest/specs/a.md', { createDirs: false })).toEqual({
      ok: false,
      rule: 'layout',
    });
  });

  it('an existing regular file -> exists true', async () => {
    await mkdir(join(clone, '.devdigest/specs'), { recursive: true });
    await writeFile(join(clone, '.devdigest/specs/a.md'), 'x');
    expect(await checkLayout(realRoot, '.devdigest/specs/a.md', { createDirs: false })).toMatchObject({
      ok: true,
      exists: true,
    });
  });
});

describe('removeAndPrune (AC-10)', () => {
  it('removes now-empty folders but never the root itself', async () => {
    const dir = join(clone, '.devdigest/specs/a/b');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'x.md'), 'x');
    await removeAndPrune(realRoot, join(realRoot, '.devdigest/specs/a/b/x.md'));
    await expect(stat(join(clone, '.devdigest/specs/a'))).rejects.toThrow();
    expect((await stat(join(clone, '.devdigest/specs'))).isDirectory()).toBe(true);
  });

  it('a sibling file keeps its folder', async () => {
    const dir = join(clone, '.devdigest/specs/a');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'x.md'), 'x');
    await writeFile(join(dir, 'y.md'), 'y');
    await removeAndPrune(realRoot, join(realRoot, '.devdigest/specs/a/x.md'));
    expect(await readdir(dir)).toEqual(['y.md']);
  });

  it('a root-level file leaves the (empty) root in place', async () => {
    await mkdir(join(clone, '.devdigest/specs'), { recursive: true });
    await writeFile(join(clone, '.devdigest/specs/x.md'), 'x');
    await removeAndPrune(realRoot, join(realRoot, '.devdigest/specs/x.md'));
    expect((await stat(join(clone, '.devdigest/specs'))).isDirectory()).toBe(true);
  });
});

describe('atomic and exclusive writes (NFR-4)', () => {
  it('replaceAtomic leaves no .tmp behind', async () => {
    const abs = join(clone, 'a.md');
    await writeFile(abs, 'old');
    await replaceAtomic(abs, Buffer.from('new'));
    expect(await readFile(abs, 'utf8')).toBe('new');
    expect((await readdir(clone)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a concurrent reader only ever sees the old or the new bytes', async () => {
    const abs = join(clone, 'a.md');
    const oldBytes = 'o'.repeat(50_000);
    const newBytes = 'n'.repeat(50_000);
    await writeFile(abs, oldBytes);
    let done = false;
    const seen = new Set<string>();
    const reader = (async () => {
      while (!done) {
        try {
          seen.add(await readFile(abs, 'utf8'));
        } catch {
          // Windows can refuse a read while rename swaps the file; that is not a mixed read.
        }
        // Yield: a zero-gap read loop would hold the file open permanently on Windows,
        // which no real reader does and which starves any rename (EPERM) - not an atomicity bug.
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    let replaced = 0;
    for (let i = 0; i < 50; i++) {
      try {
        await replaceAtomic(abs, Buffer.from(i % 2 === 0 ? newBytes : oldBytes));
        replaced++;
      } catch (e) {
        // Windows refuses rename over a file a reader keeps opening (EPERM) - the documented
        // risk (plan, Risks). The old bytes stay and the temp file is removed; any other error is real.
        if (process.platform !== 'win32' || (e as { code?: string }).code !== 'EPERM') throw e;
      }
    }
    done = true;
    await reader;
    expect(replaced).toBeGreaterThan(0);
    for (const s of seen) expect([oldBytes, newBytes]).toContain(s);
    expect((await readdir(clone)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  }, 30_000); // Windows rename retries can take a few seconds under a looping reader

  it('createExclusive on an existing path rejects with EEXIST', async () => {
    const abs = join(clone, 'a.md');
    await writeFile(abs, 'x');
    await expect(createExclusive(abs, Buffer.from('y'))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(abs, 'utf8')).toBe('x');
  });
});

describe('readCurrent / versionOf', () => {
  it('returns bytes, size and the SHA-256 version; null on ENOENT', async () => {
    const abs = join(clone, 'a.md');
    await writeFile(abs, 'héllo');
    const cur = await readCurrent(abs);
    expect(cur?.size).toBe(Buffer.byteLength('héllo'));
    expect(cur?.version).toBe(versionOf(Buffer.from('héllo')));
    expect(cur?.version).toMatch(/^[0-9a-f]{64}$/);
    expect(await readCurrent(join(clone, 'nope.md'))).toBeNull();
  });
});
