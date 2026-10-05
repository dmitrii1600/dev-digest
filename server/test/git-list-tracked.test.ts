import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { MockGitClient } from '../src/adapters/mocks.js';

// Hermetic: a throwaway `git init` in tmpdirs (the git CLI is on PATH), no Postgres.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}

let repo: string;
let empty: string;
let outerSub: string;
let base: string;
const client = new SimpleGitClient('/unused');

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'pc-tracked-'));

  repo = join(base, 'repo');
  await mkdir(join(repo, '.devdigest/specs'), { recursive: true });
  await mkdir(join(repo, 'docs'), { recursive: true });
  git(repo, 'init', '-q');
  await writeFile(join(repo, '.gitignore'), '.devdigest/specs/c.md\n');
  await writeFile(join(repo, '.devdigest/specs/a.md'), 'a');
  await writeFile(join(repo, 'docs/x.md'), 'x');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  await writeFile(join(repo, '.devdigest/specs/b.md'), 'b'); // untracked
  await writeFile(join(repo, '.devdigest/specs/c.md'), 'c'); // gitignored

  // A plain subdirectory (no .git of its own) inside an outer repo.
  const outer = join(base, 'outer');
  outerSub = join(outer, 'sub');
  await mkdir(join(outerSub, '.devdigest/specs'), { recursive: true });
  git(outer, 'init', '-q');
  await writeFile(join(outerSub, '.devdigest/specs/a.md'), 'a');
  git(outer, 'add', '-A');
  git(outer, 'commit', '-q', '-m', 'init');

  // A repo with no commit.
  empty = join(base, 'empty');
  await mkdir(empty, { recursive: true });
  git(empty, 'init', '-q');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('SimpleGitClient.listTracked', () => {
  it('returns a committed file under the dir', async () => {
    expect(await client.listTracked(repo, '.devdigest/specs')).toEqual(['.devdigest/specs/a.md']);
  });

  it('does not return an untracked or a gitignored file', async () => {
    const tracked = await client.listTracked(repo, '.devdigest/specs');
    expect(tracked).not.toContain('.devdigest/specs/b.md');
    expect(tracked).not.toContain('.devdigest/specs/c.md');
  });

  it('does not return a committed file outside the dir', async () => {
    expect(await client.listTracked(repo, '.devdigest/specs')).not.toContain('docs/x.md');
  });

  it('throws for a directory with no .git of its own (never walks up to an outer repo)', async () => {
    await expect(client.listTracked(outerSub, '.devdigest/specs')).rejects.toThrow();
  });

  it('throws for a repo with no commit', async () => {
    await expect(client.listTracked(empty, '.devdigest/specs')).rejects.toThrow();
  });
});

describe('MockGitClient.listTracked', () => {
  it('filters to entries under the dir, [] by default, throws on "fail"', async () => {
    const m = new MockGitClient({ tracked: ['.devdigest/specs/a.md', 'docs/x.md'] });
    expect(await m.listTracked('/c', '.devdigest/specs')).toEqual(['.devdigest/specs/a.md']);
    expect(await new MockGitClient().listTracked('/c', '.devdigest/specs')).toEqual([]);
    await expect(
      new MockGitClient({ tracked: 'fail' }).listTracked('/c', '.devdigest/specs'),
    ).rejects.toThrow();
  });
});
