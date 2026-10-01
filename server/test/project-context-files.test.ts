import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listMarkdown, readDoc } from '../src/modules/project-context/repository-files.js';
import { MAX_DOC_BYTES, TRUNCATION_MARKER } from '../src/modules/project-context/constants.js';

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pc-root-'));
  outside = await mkdtemp(join(tmpdir(), 'pc-out-'));
  for (const d of ['.git', 'node_modules/pkg', 'docs', 'specs']) {
    await mkdir(join(root, d), { recursive: true });
  }
  await writeFile(join(root, '.git/x.md'), 'x');
  await writeFile(join(root, 'node_modules/pkg/y.md'), 'y');
  await writeFile(join(root, 'docs/a.md'), 'alpha');
  await writeFile(join(root, 'specs/b.md'), 'beta');
  await writeFile(join(root, 'README.md'), 'readme');
  await writeFile(join(root, 'big.md'), 'a'.repeat(MAX_DOC_BYTES + 100));
  await writeFile(join(root, 'notes.txt'), 'nope');
  await writeFile(join(outside, 'secret.md'), 'secret');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('listMarkdown', () => {
  it('excludes .git and node_modules, finds nested, sorts', async () => {
    const r = await listMarkdown(root);
    expect(r.cloned).toBe(true);
    expect(r.files.map((f) => f.path)).toEqual(['README.md', 'big.md', 'docs/a.md', 'specs/b.md']);
    expect(r.total).toBe(4);
  });

  it('null clone -> cloned false', async () => {
    expect(await listMarkdown(null)).toEqual({ cloned: false, total: 0, files: [] });
  });

  it('missing root -> cloned false', async () => {
    expect((await listMarkdown(join(root, 'nope'))).cloned).toBe(false);
  });

  it('501 files -> 500 listed, total 501', async () => {
    const many = await mkdtemp(join(tmpdir(), 'pc-many-'));
    try {
      await Promise.all(
        Array.from({ length: 501 }, (_, i) =>
          writeFile(join(many, `f${String(i).padStart(4, '0')}.md`), 'x'),
        ),
      );
      const r = await listMarkdown(many);
      expect(r.files).toHaveLength(500);
      expect(r.total).toBe(501);
    } finally {
      await rm(many, { recursive: true, force: true });
    }
  });

  it('does not list or read a symlink to an outside file', async () => {
    try {
      await symlink(join(outside, 'secret.md'), join(root, 'link.md'));
    } catch {
      return; // EPERM on Windows without privilege
    }
    const r = await listMarkdown(root);
    expect(r.files.map((f) => f.path)).not.toContain('link.md');
    expect(await readDoc(root, 'link.md')).toBeNull();
  });
});

describe('readDoc', () => {
  it('reads a file', async () => {
    expect(await readDoc(root, 'docs/a.md')).toEqual({ text: 'alpha', truncated: false });
  });
  it('rejects traversal and absolute paths', async () => {
    expect(await readDoc(root, '../x.md')).toBeNull();
    expect(await readDoc(root, join(outside, 'secret.md'))).toBeNull();
    expect(await readDoc(root, '/etc/passwd.md')).toBeNull();
  });
  it('cuts a >64 KB file with the marker', async () => {
    const r = await readDoc(root, 'big.md');
    expect(r?.truncated).toBe(true);
    expect(r?.text.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(r?.text.length).toBe(MAX_DOC_BYTES + TRUNCATION_MARKER.length);
  });
  it('missing file -> null', async () => {
    expect(await readDoc(root, 'nope.md')).toBeNull();
  });
});
