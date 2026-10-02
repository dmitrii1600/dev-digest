import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { listMarkdown, readDoc } from '../src/modules/project-context/repository-files.js';
import * as writes from '../src/modules/project-context/repository-writes.js';
import type { ProjectContextDeps, ProjectContextStore } from '../src/modules/project-context/types.js';
import { AppError } from '../src/platform/errors.js';

const WS = 'ws';
const REPO = 'r1';
const ROOT = '.devdigest/specs';

let clone: string;
let tracked: string[] | 'fail';
let hideFromListing: (path: string) => boolean;
let agentPaths: Map<string, string[]>;

function makeStore(clonePath: string | null): ProjectContextStore {
  return {
    getRepo: async (_ws, id) => (id === REPO ? { id, clonePath } : null),
    agentExists: async () => true,
    skillExists: async () => true,
    agentPaths: async (agentId) => agentPaths.get(agentId) ?? [],
    skillPaths: async () => [],
    replaceAgentPaths: async (agentId, _repo, paths) => {
      agentPaths.set(agentId, paths);
    },
    replaceSkillPaths: async () => undefined,
    pathsForRun: async () => ({ agentPaths: [], skills: [] }),
    usedByPairs: async () => [],
    enabledAgentIds: async () => [],
  };
}

function makeService(clonePath: string | null = clone) {
  const deps: ProjectContextDeps = {
    repo: makeStore(clonePath),
    listMarkdown: async (p) => {
      const r = await listMarkdown(p);
      return { ...r, files: r.files.filter((f) => !hideFromListing(f.path)) };
    },
    readDoc,
    countTokens: (s) => s.length,
    writes,
    listTracked: async (_clone, under) => {
      if (tracked === 'fail') throw new Error('git failed');
      return tracked.filter((p) => p.startsWith(under + '/'));
    },
  };
  return new ProjectContextService(deps);
}

const read = (rel: string) => readFile(join(clone, ...rel.split('/')), 'utf8');
const exists = (rel: string) =>
  stat(join(clone, ...rel.split('/'))).then(
    () => true,
    () => false,
  );

async function seedFile(rel: string, content: string | Buffer) {
  const abs = join(clone, ...rel.split('/'));
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content);
}

async function expectAppError(p: Promise<unknown>, status: number, code?: string) {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as AppError | null;
  expect(err).toBeInstanceOf(AppError);
  expect(err?.statusCode).toBe(status);
  if (code) expect(err?.code).toBe(code);
  return err as AppError;
}

beforeEach(async () => {
  clone = await mkdtemp(join(tmpdir(), 'pc-service-'));
  tracked = [];
  hideFromListing = () => false;
  agentPaths = new Map();
});

afterEach(async () => {
  await rm(clone, { recursive: true, force: true });
});

describe('create (AC-2, EC-2, NFR-4)', () => {
  it('file: untitled.md with the template; the root is created on first use', async () => {
    const svc = makeService();
    expect(await exists(ROOT)).toBe(false);
    const f = await svc.create(WS, REPO, { kind: 'file', name: 'untitled.md' });
    expect(f.path).toBe(`${ROOT}/untitled.md`);
    expect(await read(f.path)).toBe('# Untitled spec\n\n## Goals\n- ');
    expect(f.editable).toBe(true);
    expect(f.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('folder: new-folder/spec.md with the folder template', async () => {
    const svc = makeService();
    const f = await svc.create(WS, REPO, { kind: 'folder', name: 'new-folder' });
    expect(f.path).toBe(`${ROOT}/new-folder/spec.md`);
    expect(await read(f.path)).toBe('# New folder spec\n');
  });

  it('suffixes instead of overwriting, case-insensitively', async () => {
    const svc = makeService();
    await svc.create(WS, REPO, { kind: 'file', name: 'untitled.md' });
    expect((await svc.create(WS, REPO, { kind: 'file', name: 'untitled.md' })).path).toBe(
      `${ROOT}/untitled-2.md`,
    );
    await seedFile(`${ROOT}/Notes.MD`, 'x');
    expect((await svc.create(WS, REPO, { kind: 'file', name: 'notes.md' })).path).toBe(
      `${ROOT}/notes-2.md`,
    );
    await svc.create(WS, REPO, { kind: 'folder', name: 'new-folder' });
    expect((await svc.create(WS, REPO, { kind: 'folder', name: 'new-folder' })).path).toBe(
      `${ROOT}/new-folder-2/spec.md`,
    );
  });

  it('Untitled.MD on disk forces -2', async () => {
    await seedFile(`${ROOT}/Untitled.MD`, 'x');
    const f = await makeService().create(WS, REPO, { kind: 'file', name: 'untitled.md' });
    expect(f.path).toBe(`${ROOT}/untitled-2.md`);
  });

  it('a tracked path is taken even when the working tree no longer has it', async () => {
    tracked = [`${ROOT}/untitled.md`];
    const f = await makeService().create(WS, REPO, { kind: 'file', name: 'untitled.md' });
    expect(f.path).toBe(`${ROOT}/untitled-2.md`);
  });

  it('NFR-4: two simultaneous creates produce two distinct files', async () => {
    const svc = makeService();
    const [a, b] = await Promise.all([
      svc.create(WS, REPO, { kind: 'file', name: 'untitled.md' }),
      svc.create(WS, REPO, { kind: 'file', name: 'untitled.md' }),
    ]);
    expect(new Set([a.path, b.path]).size).toBe(2);
    expect((await readdir(join(clone, '.devdigest/specs'))).sort()).toEqual([
      'untitled-2.md',
      'untitled.md',
    ]);
  });

  it('EC-3: a reserved name -> 422 naming the field', async () => {
    const err = await expectAppError(
      makeService().create(WS, REPO, { kind: 'file', name: 'CON.md' }),
      422,
    );
    expect(err.details).toMatchObject({ field: 'name', rule: 'reserved' });
  });

  it('Q5: a throwing listTracked -> create is 422 tracked and writes nothing', async () => {
    tracked = 'fail';
    const err = await expectAppError(
      makeService().create(WS, REPO, { kind: 'file', name: 'untitled.md' }),
      422,
    );
    expect(err.details).toMatchObject({ rule: 'tracked' });
    expect(await exists('.devdigest')).toBe(false);
  });
});

describe('upload (AC-3)', () => {
  it('writes a BOM + CRLF file byte-for-byte, in the root', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# T\r\nbody\r\n')]);
    const f = await makeService().upload(WS, REPO, {
      name: 'notes.md',
      content_base64: bytes.toString('base64'),
    });
    expect(f.path).toBe(`${ROOT}/notes.md`);
    const onDisk = await readFile(join(clone, '.devdigest/specs/notes.md'));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it('a name with a folder part is refused', async () => {
    const err = await expectAppError(
      makeService().upload(WS, REPO, { name: 'sub/a.md', content_base64: '' }),
      422,
    );
    expect(err.details).toMatchObject({ field: 'name' });
  });

  it('invalid UTF-8 -> 422 content', async () => {
    const err = await expectAppError(
      makeService().upload(WS, REPO, {
        name: 'a.md',
        content_base64: Buffer.from([0xc3, 0x28]).toString('base64'),
      }),
      422,
    );
    expect(err.details).toMatchObject({ field: 'content', rule: 'not_utf8' });
  });

  it('an empty file is allowed', async () => {
    const f = await makeService().upload(WS, REPO, { name: 'empty.md', content_base64: '' });
    expect(f.size).toBe(0);
  });
});

describe('save (AC-8, EC-5, EC-6, EC-10, Q2)', () => {
  async function created() {
    const svc = makeService();
    const f = await svc.create(WS, REPO, { kind: 'file', name: 'a.md' });
    return { svc, f };
  }

  it('writes LF, returns a new version', async () => {
    const { svc, f } = await created();
    const saved = await svc.save(WS, REPO, {
      path: f.path,
      content: 'line1\r\nline2\r\n',
      version: f.version ?? null,
    });
    expect(await read(f.path)).toBe('line1\nline2\n');
    expect(saved.version).not.toBe(f.version);
    expect(saved.size).toBe(Buffer.byteLength('line1\nline2\n'));
    expect(saved.tokens).not.toBe(f.tokens);
  });

  it('EC-6: a stale version -> 409 changed with current_version; disk unchanged', async () => {
    const { svc, f } = await created();
    await svc.save(WS, REPO, { path: f.path, content: 'first', version: f.version ?? null });
    const err = await expectAppError(
      svc.save(WS, REPO, { path: f.path, content: 'second', version: f.version ?? null }),
      409,
      'version_conflict',
    );
    expect(err.details).toMatchObject({ reason: 'changed' });
    expect((err.details as { current_version: string }).current_version).toMatch(/^[0-9a-f]{64}$/);
    expect(await read(f.path)).toBe('first');
  });

  it('EC-6: a file deleted on disk -> 409 deleted with current_version null', async () => {
    const { svc, f } = await created();
    await rm(join(clone, ...f.path.split('/')));
    const err = await expectAppError(
      svc.save(WS, REPO, { path: f.path, content: 'x', version: f.version ?? null }),
      409,
      'version_conflict',
    );
    expect(err.details).toEqual({ reason: 'deleted', current_version: null });
  });

  it('Q2: version null recreates an absent path, including pruned parents', async () => {
    const svc = makeService();
    const path = `${ROOT}/gone/deep/x.md`;
    const f = await svc.save(WS, REPO, { path, content: 'back', version: null });
    expect(await read(path)).toBe('back');
    expect(f.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Q2: version null on an existing path -> 409 changed', async () => {
    const { svc, f } = await created();
    const err = await expectAppError(
      svc.save(WS, REPO, { path: f.path, content: 'x', version: null }),
      409,
      'version_conflict',
    );
    expect(err.details).toMatchObject({ reason: 'changed', current_version: f.version });
  });

  it('EC-3: a path outside the root -> 422 path; a bad segment name -> 422 path', async () => {
    const svc = makeService();
    const outside = await expectAppError(
      svc.save(WS, REPO, { path: 'docs/a.md', content: 'x', version: null }),
      422,
    );
    expect(outside.details).toMatchObject({ field: 'path', rule: 'outside_root' });
    const bad = await expectAppError(
      svc.save(WS, REPO, { path: `${ROOT}/CON/a.md`, content: 'x', version: null }),
      422,
    );
    expect(bad.details).toMatchObject({ field: 'path', rule: 'reserved' });
  });

  it('EC-5: 65,537 bytes after LF -> 422 content; 65,536 is fine', async () => {
    const { svc, f } = await created();
    const err = await expectAppError(
      svc.save(WS, REPO, { path: f.path, content: 'a'.repeat(65_537), version: f.version ?? null }),
      422,
    );
    expect(err.details).toMatchObject({ field: 'content', rule: 'too_large' });
    const ok = await svc.save(WS, REPO, {
      path: f.path,
      content: 'a'.repeat(65_536),
      version: f.version ?? null,
    });
    expect(ok.size).toBe(65_536);
  });

  it('EC-5: CRLF text over the cap before LF but under after it is accepted', async () => {
    const { svc, f } = await created();
    const text = ('a'.repeat(99) + '\r\n').repeat(655);
    const saved = await svc.save(WS, REPO, { path: f.path, content: text, version: f.version ?? null });
    expect(saved.size).toBe(65_500);
  });

  it('EC-10: a tracked root file -> 422 for save', async () => {
    await seedFile(`${ROOT}/t.md`, 'tracked');
    tracked = [`${ROOT}/t.md`];
    const cur = await writes.readCurrent(join(clone, '.devdigest/specs/t.md'));
    const err = await expectAppError(
      makeService().save(WS, REPO, { path: `${ROOT}/t.md`, content: 'x', version: cur!.version }),
      422,
    );
    expect(err.details).toMatchObject({ rule: 'tracked' });
    expect(await read(`${ROOT}/t.md`)).toBe('tracked');
  });

  it('EC-10: a 70,000-byte root file -> 422 too_large', async () => {
    await seedFile(`${ROOT}/big.md`, 'a'.repeat(70_000));
    const cur = await writes.readCurrent(join(clone, '.devdigest/specs/big.md'));
    const err = await expectAppError(
      makeService().save(WS, REPO, { path: `${ROOT}/big.md`, content: 'x', version: cur!.version }),
      422,
    );
    expect(err.details).toMatchObject({ rule: 'too_large' });
  });

  it('Q5: a throwing listTracked -> save is 422 tracked', async () => {
    const { svc, f } = await created();
    tracked = 'fail';
    const err = await expectAppError(
      svc.save(WS, REPO, { path: f.path, content: 'x', version: f.version ?? null }),
      422,
    );
    expect(err.details).toMatchObject({ rule: 'tracked' });
  });
});

describe('remove (AC-10, EC-10)', () => {
  it('deletes, prunes empty folders and keeps the root', async () => {
    const svc = makeService();
    const f = await svc.create(WS, REPO, { kind: 'folder', name: 'sub' });
    const res = await svc.remove(WS, REPO, { path: f.path, version: f.version as string });
    expect(res.path).toBe(f.path);
    expect(await exists(`${ROOT}/sub`)).toBe(false);
    expect(await exists(ROOT)).toBe(true);
  });

  it('a stale version -> 409 changed and the file stays', async () => {
    const svc = makeService();
    const f = await svc.create(WS, REPO, { kind: 'file', name: 'a.md' });
    await svc.save(WS, REPO, { path: f.path, content: 'new', version: f.version ?? null });
    const err = await expectAppError(
      svc.remove(WS, REPO, { path: f.path, version: f.version as string }),
      409,
      'version_conflict',
    );
    expect(err.details).toMatchObject({ reason: 'changed' });
    expect(await exists(f.path)).toBe(true);
  });

  it('a file already gone -> 409 deleted', async () => {
    const err = await expectAppError(
      makeService().remove(WS, REPO, { path: `${ROOT}/nope.md`, version: 'a'.repeat(64) }),
      409,
      'version_conflict',
    );
    expect(err.details).toEqual({ reason: 'deleted', current_version: null });
  });

  it('a tracked file -> 422', async () => {
    await seedFile(`${ROOT}/t.md`, 'tracked');
    tracked = [`${ROOT}/t.md`];
    const cur = await writes.readCurrent(join(clone, '.devdigest/specs/t.md'));
    await expectAppError(
      makeService().remove(WS, REPO, { path: `${ROOT}/t.md`, version: cur!.version }),
      422,
    );
    expect(await exists(`${ROOT}/t.md`)).toBe(true);
  });
});

describe('EC-1: no clone', () => {
  it('every write -> 409 repo_not_cloned and nothing is written', async () => {
    const svc = makeService(null);
    await expectAppError(svc.create(WS, REPO, { kind: 'file', name: 'a.md' }), 409, 'repo_not_cloned');
    await expectAppError(
      svc.upload(WS, REPO, { name: 'a.md', content_base64: '' }),
      409,
      'repo_not_cloned',
    );
    await expectAppError(
      svc.save(WS, REPO, { path: `${ROOT}/a.md`, content: 'x', version: null }),
      409,
      'repo_not_cloned',
    );
    await expectAppError(
      svc.remove(WS, REPO, { path: `${ROOT}/a.md`, version: 'a'.repeat(64) }),
      409,
      'repo_not_cloned',
    );
    expect(await readdir(clone)).toEqual([]);
  });

  it('an unknown repo -> 404', async () => {
    await expectAppError(
      makeService().create(WS, 'ghost', { kind: 'file', name: 'a.md' }),
      404,
    );
  });
});

describe('list: editability (AC-6, Q5)', () => {
  it('root files are editable; non-root are outside_root; tracked and big are read-only', async () => {
    await seedFile(`${ROOT}/a.md`, 'a');
    await seedFile(`${ROOT}/t.md`, 't');
    await seedFile(`${ROOT}/big.md`, 'b'.repeat(70_000));
    await seedFile('docs/x.md', 'x');
    tracked = [`${ROOT}/t.md`];
    const list = await makeService().list(WS, REPO);
    const by = Object.fromEntries(list.files.map((f) => [f.path, f]));
    expect(by[`${ROOT}/a.md`]).toMatchObject({ editable: true, read_only_reason: null });
    expect(by[`${ROOT}/t.md`]).toMatchObject({ editable: false, read_only_reason: 'tracked' });
    expect(by[`${ROOT}/big.md`]).toMatchObject({ editable: false, read_only_reason: 'too_large' });
    expect(by['docs/x.md']).toMatchObject({ editable: false, read_only_reason: 'outside_root' });
    expect(by[`${ROOT}/a.md`]?.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Q5: a throwing listTracked marks every root row tracked', async () => {
    await seedFile(`${ROOT}/a.md`, 'a');
    await seedFile('docs/x.md', 'x');
    tracked = 'fail';
    const list = await makeService().list(WS, REPO);
    const by = Object.fromEntries(list.files.map((f) => [f.path, f]));
    expect(by[`${ROOT}/a.md`]?.read_only_reason).toBe('tracked');
    expect(by[`${ROOT}/a.md`]?.editable).toBe(false);
    expect(by['docs/x.md']?.read_only_reason).toBe('outside_root');
  });
});

describe('EC-11: a root file past the listing cap', () => {
  it('file() and putAgent() accept an existing root path missing from the listing; P8 holds elsewhere', async () => {
    await seedFile(`${ROOT}/late.md`, 'late');
    await seedFile('docs/x.md', 'x');
    hideFromListing = () => true; // the capped listing shows nothing
    const svc = makeService();

    const f = await svc.file(WS, REPO, `${ROOT}/late.md`);
    expect(f.content).toBe('late');
    expect(f.editable).toBe(true);

    const put = await svc.putAgent(WS, 'agent-1', REPO, [`${ROOT}/late.md`]);
    expect(put.paths).toEqual([`${ROOT}/late.md`]);

    await expectAppError(svc.file(WS, REPO, 'docs/x.md'), 422);
    await expectAppError(svc.putAgent(WS, 'agent-2', REPO, ['docs/x.md']), 422);
    await expectAppError(svc.file(WS, REPO, `${ROOT}/missing.md`), 422);
  });
});
