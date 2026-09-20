import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { parseImport } from '../src/modules/skills/helpers.js';
import { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_TOTAL_UNCOMPRESSED } from '../src/modules/skills/constants.js';

/**
 * A1 — pure tests of `parseImport` / the zip parser (`helpers.ts`). No I/O:
 * every archive is built in memory with `fflate.zipSync` and torn down after
 * the assertion; nothing is written to or read from disk except this test
 * file's own static "no fs import" guard below.
 */

const enc = (s: string) => new TextEncoder().encode(s);

describe('parseImport — .md happy path', () => {
  it('frontmatter metadata wins over the H1/derived fallback', () => {
    const md =
      '---\nname: API Contract Rules\ndescription: Keep request/response contracts in sync\ntype: convention\n---\n# ignored heading\n\nBody text here.\n';
    const bytes = enc(md);
    const res = parseImport('skill.md', bytes);

    expect(res.name).toBe('API Contract Rules');
    expect(res.description).toBe('Keep request/response contracts in sync');
    expect(res.type).toBe('convention');
    expect(res.source).toBe('imported_file');
    expect(res.body.startsWith('# ignored heading')).toBe(true);
    expect(res.entries).toEqual([
      { path: 'skill.md', bytes: bytes.byteLength, kept: true, reason: 'skill body' },
    ]);
    expect(res.discarded).toBe(0);
    expect(res.warnings).toEqual([]);
  });

  it('an unrecognized frontmatter type falls back to "custom"', () => {
    const md = '---\nname: X\ntype: not-a-real-type\n---\nBody.\n';
    const res = parseImport('skill.md', enc(md));
    expect(res.type).toBe('custom');
  });

  it('H1-derived metadata when there is no frontmatter', () => {
    const md = '# Test Quality Bar\n\nEvery PR needs a regression test.\n\nMore body below.\n';
    const res = parseImport('skill.md', enc(md));

    expect(res.name).toBe('Test Quality Bar');
    expect(res.description).toBe('Every PR needs a regression test.');
    expect(res.type).toBe('custom');
    expect(res.source).toBe('imported_file');
    // No frontmatter to strip — the body IS the raw upload.
    expect(res.body).toBe(md);
  });

  it('falls back to "Untitled skill" when there is no H1 (description still picks the first non-empty line)', () => {
    const md = 'Just some prose, no heading at all.\n';
    const res = parseImport('skill.md', enc(md));
    expect(res.name).toBe('Untitled skill');
    expect(res.description).toBe('Just some prose, no heading at all.');
  });

  it('description is empty when the file is only a heading with nothing after it', () => {
    const md = '# Heading Only\n';
    const res = parseImport('skill.md', enc(md));
    expect(res.name).toBe('Heading Only');
    expect(res.description).toBe('');
  });
});

describe('parseImport — .zip core selection order', () => {
  it('prefers SKILL.md over README.md and any other .md', () => {
    const zip = zipSync({
      'SKILL.md': enc('# The Core\n\nThis is the body.'),
      'README.md': enc('# Not the core\n\nIgnore me.'),
      'notes.md': enc('# Also not the core'),
    });
    const res = parseImport('bundle.zip', zip);

    expect(res.warnings).toEqual([]);
    expect(res.name).toBe('The Core');
    const kept = res.entries.filter((e) => e.kept);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.path).toBe('SKILL.md');
    expect(res.entries.find((e) => e.path === 'README.md')).toMatchObject({
      kept: false,
      reason: 'markdown, not selected as the skill body',
    });
  });

  it('falls back to README.md when there is no SKILL.md', () => {
    const zip = zipSync({
      'README.md': enc('# Readme Core\n\nBody from the readme.'),
      'notes.md': enc('# Not selected'),
    });
    const res = parseImport('bundle.zip', zip);
    expect(res.name).toBe('Readme Core');
    expect(res.entries.find((e) => e.path === 'README.md')).toMatchObject({ kept: true });
  });

  it('falls back to the sole .md file when there is no SKILL.md or README.md', () => {
    const zip = zipSync({
      'convention.md': enc('# Sole Markdown\n\nThe only candidate.'),
      'notes.txt': enc('not markdown'),
    });
    const res = parseImport('bundle.zip', zip);
    expect(res.name).toBe('Sole Markdown');
    expect(res.entries.find((e) => e.path === 'convention.md')).toMatchObject({ kept: true });
    expect(res.entries.find((e) => e.path === 'notes.txt')).toMatchObject({
      kept: false,
      reason: 'not markdown',
    });
  });

  it('rejects with "no markdown core found" when several .md files tie and none is SKILL.md/README.md', () => {
    const zip = zipSync({
      'a.md': enc('# A'),
      'b.md': enc('# B'),
    });
    const res = parseImport('bundle.zip', zip);
    expect(res.warnings).toContain('no markdown core found');
    expect(res.entries.every((e) => !e.kept)).toBe(true);
    expect(res.body).toBe('');
  });

  it('rejects with "no markdown core found" when the archive has no .md at all', () => {
    const zip = zipSync({ 'notes.txt': enc('plain text, not markdown') });
    const res = parseImport('bundle.zip', zip);
    expect(res.warnings).toContain('no markdown core found');
  });

  it('SKILL.md wins by name even when a shallower README.md also exists', () => {
    const zip = zipSync({
      'nested/deep/SKILL.md': enc('# Nested Core\n\nBody.'),
      'README.md': enc('# Root Readme'),
    });
    const res = parseImport('bundle.zip', zip);
    expect(res.name).toBe('Nested Core');
  });
});

describe('parseImport — malicious .zip archives', () => {
  it('rejects a path-traversal entry, and still keeps a co-located valid core', () => {
    const zip = zipSync({
      '../evil.md': enc('# Evil\n\nShould never be read as the core.'),
      'SKILL.md': enc('# Good Core\n\nSafe body.'),
    });
    const res = parseImport('bundle.zip', zip);

    const evil = res.entries.find((e) => e.path === '../evil.md');
    expect(evil).toBeDefined();
    expect(evil!.kept).toBe(false);
    expect(evil!.reason).toBe('path escapes archive root — discarded');
    expect(res.name).toBe('Good Core'); // the safe core is still selected
  });

  it('rejects a symlink entry (unix external attributes S_IFLNK)', () => {
    // fflate exposes the raw PKZIP external-attributes word via per-file
    // ZipAttributes; os:3 (unix) + mode 0o120777 (S_IFLNK | rwxrwxrwx) shifted
    // into the high 16 bits is exactly what helpers.ts's isSymlinkAttrs checks.
    const zip = zipSync({
      'SKILL.md': enc('# Good Core\n\nSafe body.'),
      'link.md': [enc('../../etc/passwd'), { os: 3, attrs: 0o120777 << 16 }],
    });
    const res = parseImport('bundle.zip', zip);

    const link = res.entries.find((e) => e.path === 'link.md');
    expect(link).toBeDefined();
    expect(link!.kept).toBe(false);
    expect(link!.reason).toBe('symlink entry — discarded');
    expect(res.name).toBe('Good Core');
  });

  it('rejects entries beyond the 200-entry cap (300 entries)', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 300; i++) {
      files[`file-${String(i).padStart(3, '0')}.md`] = enc(`# File ${i}`);
    }
    const zip = zipSync(files);
    const res = parseImport('bundle.zip', zip);

    const overLimit = res.entries.filter((e) => e.reason.startsWith(`entry limit (${MAX_ENTRIES})`));
    expect(overLimit).toHaveLength(300 - MAX_ENTRIES);
    expect(overLimit.every((e) => e.kept === false)).toBe(true);
  });

  it('rejects a single oversized member (10 MiB, over the 256 KiB per-entry cap)', () => {
    const big = new Uint8Array(10 * 1024 * 1024).fill(97);
    const zip = zipSync({ 'SKILL.md': big });
    const res = parseImport('bundle.zip', zip);

    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({ path: 'SKILL.md', kept: false });
    expect(res.entries[0]!.reason).toContain(`max ${MAX_ENTRY_BYTES}`);
    expect(res.warnings).toContain('no markdown core found');
  });

  it('rejects a zip-bomb-shaped total uncompressed size (over the 4 MiB cumulative cap)', () => {
    // Each member is well under the 256 KiB per-entry cap, but enough of them
    // together blow the 4 MiB cumulative budget — checked mid-inflate.
    const entryBytes = 250_000;
    const count = Math.ceil((MAX_TOTAL_UNCOMPRESSED + entryBytes) / entryBytes);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < count; i++) {
      files[`chunk-${String(i).padStart(3, '0')}.md`] = new Uint8Array(entryBytes).fill(98);
    }
    const zip = zipSync(files);
    const res = parseImport('bundle.zip', zip);

    const overBudget = res.entries.filter((e) => e.reason.includes('zip bomb suspected'));
    expect(overBudget.length).toBeGreaterThan(0);
    expect(overBudget.every((e) => e.kept === false)).toBe(true);
  });

  it('every rejected entry names its reason (never a blank string)', () => {
    const zip = zipSync({
      '../evil.md': enc('bad path'),
      'link.md': [enc('bad symlink'), { os: 3, attrs: 0o120777 << 16 }],
      'script.js': enc('console.log(1)'),
    });
    const res = parseImport('bundle.zip', zip);
    for (const entry of res.entries) {
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('rejects an executable extension outright', () => {
    const zip = zipSync({
      'SKILL.md': enc('# Good Core'),
      'run.sh': enc('#!/bin/sh\necho hi'),
    });
    const res = parseImport('bundle.zip', zip);
    expect(res.entries.find((e) => e.path === 'run.sh')).toMatchObject({
      kept: false,
      reason: 'executable — discarded',
    });
  });
});

describe('parseImport — no filesystem access', () => {
  it('the helpers module never imports node:fs', async () => {
    const src = await readFile(
      new URL('../src/modules/skills/helpers.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/from\s+['"]node:fs/);
    expect(src).not.toMatch(/require\(\s*['"]fs/);
  });
});
