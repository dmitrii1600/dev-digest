import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { walkClone } from '../src/modules/repo-intel/pipeline/walk.js';
import { findConfigFiles } from '../src/modules/conventions/repository-samples.js';
import { readRunSources } from '../src/modules/onboarding/repository-files.js';

/**
 * NFR-3: authored files under `.devdigest/specs/` never reach the repo-intel index,
 * the Conventions samples or the Onboarding run-sources.
 *
 * The PR-diff half of NFR-3 is structural, not tested here: diffs are commit-to-commit
 * (`git diff base...head`, `adapters/git/simple-git.ts`), and an untracked authored file is
 * never in a commit.
 */

let clone: string;

beforeAll(async () => {
  clone = await mkdtemp(join(tmpdir(), 'pc-isolation-'));
  const files: Record<string, string> = {
    '.devdigest/specs/x.md': '# authored spec',
    '.devdigest/specs/y.ts': 'export const authored = 1;',
    '.devdigest/specs/tsconfig.json': '{}',
    '.devdigest/specs/README.md': '# authored readme',
    '.devdigest/specs/package.json': '{}',
    'src/a.ts': 'export const a = 1;',
    'README.md': '# root readme',
    'package.json': '{"name":"x"}',
    'tsconfig.json': '{}',
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(clone, ...rel.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
});

afterAll(async () => {
  await rm(clone, { recursive: true, force: true });
});

const underDevdigest = (p: string) => p === '.devdigest' || p.startsWith('.devdigest/');

describe('NFR-3 isolation of .devdigest/specs/', () => {
  it('repo-intel walkClone never yields an authored .md file', async () => {
    // FINDING: walkClone does NOT skip dot-folders - it would yield `.devdigest/specs/y.ts`.
    // The spec's claim rests on the indexer's SUPPORTED_EXT (.ts/.tsx/.js/...), which never
    // includes `.md`, and authoring only ever writes `.md` (names must end in .md). So only
    // the `.md` case is asserted; the indexer is deliberately left unchanged (plan, step 5).
    const { files } = await walkClone(clone);
    expect(files).toContain('src/a.ts');
    expect(files.filter((p) => underDevdigest(p) && p.toLowerCase().endsWith('.md'))).toEqual([]);
  });

  it('conventions findConfigFiles never returns a .devdigest/ path', async () => {
    const files = await findConfigFiles(clone);
    expect(files).toContain('tsconfig.json');
    expect(files.filter(underDevdigest)).toEqual([]);
  });

  it('onboarding readRunSources never returns a .devdigest/ path', async () => {
    const sources = await readRunSources(clone);
    expect(sources.map((s) => s.path)).toContain('README.md');
    expect(sources.filter((s) => underDevdigest(s.path))).toEqual([]);
    expect(sources.every((s) => !s.text.includes('authored'))).toBe(true);
  });
});
