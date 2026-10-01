import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExcerpts, readRunSources } from '../src/modules/onboarding/repository-files.js';
import { README_MAX_CHARS, TRUNCATION_MARKER } from '../src/modules/onboarding/constants.js';

/** Filesystem only — no Postgres, so this stays in the hermetic suite. */

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'onb-clone-'));
  outside = await mkdtemp(join(tmpdir(), 'onb-outside-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('readRunSources', () => {
  it('reads README.md, package.json and .env.example in allowlist order', async () => {
    await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"vite"}}');
    await writeFile(join(root, 'README.md'), '# hi');
    await writeFile(join(root, '.env.example'), 'PORT=3000');
    await writeFile(join(root, 'other.txt'), 'not on the list');
    const out = await readRunSources(root);
    expect(out.map((s) => s.path)).toEqual(['README.md', 'package.json', '.env.example']);
    expect(out[1]!.text).toContain('"dev"');
  });

  it('never returns a secret .env file or its content', async () => {
    await writeFile(join(root, '.env'), 'SECRET=x');
    await writeFile(join(root, '.env.local'), 'SECRET=x');
    await writeFile(join(root, 'README.md'), '# hi');
    const out = await readRunSources(root);
    expect(out.map((s) => s.path)).toEqual(['README.md']);
    expect(JSON.stringify(out)).not.toContain('SECRET=x');
  });

  it('ignores a nested package.json', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub', 'package.json'), '{}');
    expect(await readRunSources(root)).toEqual([]);
  });

  it('cuts a 20 KB README with the marker', async () => {
    await writeFile(join(root, 'README.md'), 'a'.repeat(20_000));
    const [readme] = await readRunSources(root);
    expect(readme!.text.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(readme!.text).toHaveLength(README_MAX_CHARS + TRUNCATION_MARKER.length);
  });

  it('a non-existent root gives []', async () => {
    expect(await readRunSources(join(root, 'nope'))).toEqual([]);
  });

  it('does not read a symlinked README that points outside the clone', async () => {
    await writeFile(join(outside, 'secret.md'), 'OUTSIDE');
    try {
      await symlink(join(outside, 'secret.md'), join(root, 'README.md'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return; // Windows without symlink rights
      throw err;
    }
    const out = await readRunSources(root);
    expect(JSON.stringify(out)).not.toContain('OUTSIDE');
  });
});

describe('readExcerpts', () => {
  it('keeps the given order, cuts at 150 lines, skips unsafe and missing paths', async () => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'b.ts'), 'bbb');
    await writeFile(
      join(root, 'src', 'a.ts'),
      Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n'),
    );
    await writeFile(join(outside, 'x.ts'), 'OUTSIDE');
    const out = await readExcerpts(root, [
      'src/b.ts',
      'src/a.ts',
      '../x.ts',
      join(outside, 'x.ts'),
      'src/missing.ts',
    ]);
    expect(out.map((e) => e.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(out[0]!.text).toBe('bbb');
    const lines = out[1]!.text.split('\n');
    expect(lines[149]).toBe('line 150');
    expect(out[1]!.text.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(out[1]!.text).not.toContain('line 151');
    expect(JSON.stringify(out)).not.toContain('OUTSIDE');
  });

  it('refuses a symlink whose real path leaves the clone', async () => {
    await writeFile(join(outside, 'x.ts'), 'OUTSIDE');
    try {
      await symlink(join(outside, 'x.ts'), join(root, 'link.ts'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    expect(await readExcerpts(root, ['link.ts'])).toEqual([]);
  });

  it('a non-existent root gives []', async () => {
    expect(await readExcerpts(join(root, 'nope'), ['a.ts'])).toEqual([]);
  });
});
