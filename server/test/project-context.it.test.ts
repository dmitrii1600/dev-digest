import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, unlink, readFile, readdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { IntentPort } from '../src/modules/intent/types.js';
import type { ProjectContextPort } from '../src/modules/project-context/types.js';
import type { Review } from '@devdigest/shared';

/**
 * Project Context — routes and run-time injection end to end against real
 * Postgres, a temp clone on disk, and a mocked model (never called by the
 * list / file / PUT routes). The "authoring" block at the end drives the write
 * routes (create / upload / save / delete) over HTTP: name suffixing, layout
 * refusal, byte rules, version conflicts, the NFR-9 log line and the NFR-2
 * "only paths in Postgres" pin for both agent and skill attachments.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const REVIEW_FIXTURE: Review = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };
const GHOST = '00000000-0000-0000-0000-000000000000';

const diffFor = (files: string[]) =>
  files
    .map(
      (f) => `diff --git a/${f} b/${f}
--- a/${f}
+++ b/${f}
@@ -1,2 +1,3 @@
 line one
+line two
 line three
`,
    )
    .join('');

const intentStub: IntentPort = {
  get: async () => null,
  ensure: async () => null,
  derive: async () => {
    throw new Error('not used');
  },
};

d('Project Context module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const dirs: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  async function makeApp(overrides: Record<string, unknown> = {}) {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: diffFor(['src/a.ts']) }),
        github: new MockGitHubClient(),
        embedder: new MockEmbedder(),
        intent: intentStub,
        llm: { openai: llm, openrouter: llm },
        ...overrides,
      },
    });
    return { app, llm };
  }

  async function makeClone(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'dd-pc-it-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    return dir;
  }

  async function newRepo(clonePath: string | null) {
    const name = `pc-repo-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  async function newAgent(opts: { strategy?: 'single-pass' | 'map-reduce'; repoIntel?: boolean } = {}) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `pc-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review.',
        strategy: opts.strategy ?? 'single-pass',
        repoIntel: opts.repoIntel ?? true,
      })
      .returning();
    return agent!;
  }

  async function newSkill(enabled = true) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `pc-skill-${seq++}`,
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: 'Be careful.',
        enabled,
      })
      .returning();
    return skill!;
  }

  async function link(agentId: string, skillId: string, order: number, enabled = true) {
    await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId, order, enabled });
  }

  const put = (app: Awaited<ReturnType<typeof makeApp>>['app'], kind: 'agents' | 'skills', id: string, repoId: string, paths: unknown) =>
    app.inject({ method: 'PUT', url: `/${kind}/${id}/context?repoId=${repoId}`, payload: { paths } });
  const get = (app: Awaited<ReturnType<typeof makeApp>>['app'], kind: 'agents' | 'skills', id: string, repoId: string) =>
    app.inject({ method: 'GET', url: `/${kind}/${id}/context?repoId=${repoId}` });

  const CLONE = {
    'specs/a.md': '# Spec A',
    'docs/b.md': '# Doc B',
    'INSIGHTS.md': '# Insights',
    'node_modules/x.md': 'ignored',
  };

  it('lists sorted .md files with kinds, no content, and makes no LLM call (AC-1, AC-2, NFR-1, NFR-2)', async () => {
    const repo = await newRepo(await makeClone(CLONE));
    const { app, llm } = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cloned).toBe(true);
    expect(body.total).toBe(3);
    expect(body.files.map((f: { path: string }) => f.path)).toEqual(['INSIGHTS.md', 'docs/b.md', 'specs/a.md']);
    expect(body.files.map((f: { kind: string }) => f.kind)).toEqual(['insights', 'docs', 'specs']);
    for (const f of body.files) {
      expect(f.content ?? undefined).toBeUndefined();
      expect(f.tokens).toBeGreaterThan(0);
    }

    const one = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/file?path=specs/a.md` });
    expect(one.statusCode).toBe(200);
    expect(one.json().content).toBe('# Spec A');
    const bad = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/file?path=nope.md` });
    expect(bad.statusCode).toBe(422);

    const agent = await newAgent();
    await put(app, 'agents', agent.id, repo.id, ['specs/a.md']);
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  it('EC-1: a repo without a clone lists cloned:false; 404 for unknown repo', async () => {
    const repo = await newRepo(null);
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.json()).toEqual({ cloned: false, total: 0, files: [] });
    const ghost = await app.inject({ method: 'GET', url: `/repos/${GHOST}/context` });
    expect(ghost.statusCode).toBe(404);
    await app.close();
  });

  it('EC-3: 501 files -> 500 listed, total 501', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 501; i++) files[`n/f${String(i).padStart(4, '0')}.md`] = 'x';
    const repo = await newRepo(await makeClone(files));
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    expect(body.files).toHaveLength(500);
    expect(body.total).toBe(501);
    await app.close();
  });

  it('AC-7 / AC-8: PUT then GET returns the same order; EC-8: bad paths 422 and persist nothing', async () => {
    const repo = await newRepo(await makeClone(CLONE));
    const agent = await newAgent();
    const { app } = await makeApp();

    const ok = await put(app, 'agents', agent.id, repo.id, ['specs/a.md', 'INSIGHTS.md']);
    expect(ok.statusCode).toBe(200);
    expect((await get(app, 'agents', agent.id, repo.id)).json().paths).toEqual(['specs/a.md', 'INSIGHTS.md']);
    await put(app, 'agents', agent.id, repo.id, ['INSIGHTS.md', 'specs/a.md']);
    expect((await get(app, 'agents', agent.id, repo.id)).json().paths).toEqual(['INSIGHTS.md', 'specs/a.md']);

    for (const bad of [['../x.md'], ['a.txt'], ['z.md']]) {
      const res = await put(app, 'agents', agent.id, repo.id, bad);
      expect(res.statusCode).toBe(422);
    }
    expect((await get(app, 'agents', agent.id, repo.id)).json().paths).toEqual(['INSIGHTS.md', 'specs/a.md']);

    expect((await put(app, 'agents', agent.id, repo.id, ['specs/a.md', 'specs/a.md'])).statusCode).toBe(422);
    expect((await put(app, 'agents', GHOST, repo.id, [])).statusCode).toBe(404);
    expect((await put(app, 'agents', agent.id, GHOST, [])).statusCode).toBe(404);
    expect((await get(app, 'skills', GHOST, repo.id)).statusCode).toBe(404);
    await app.close();
  });

  it('A1: a PUT may keep an attached path whose file was deleted, and add a listed one', async () => {
    const clone = await makeClone(CLONE);
    const repo = await newRepo(clone);
    const agent = await newAgent();
    const { app } = await makeApp();
    await put(app, 'agents', agent.id, repo.id, ['specs/a.md']);
    await unlink(join(clone, 'specs/a.md'));
    const res = await put(app, 'agents', agent.id, repo.id, ['specs/a.md', 'docs/b.md']);
    expect(res.statusCode).toBe(200);
    expect(res.json().paths).toEqual(['specs/a.md', 'docs/b.md']);
    await app.close();
  });

  it('EC-12: two concurrent PUTs leave exactly one of the two bodies, no duplicates', async () => {
    const repo = await newRepo(await makeClone(CLONE));
    const agent = await newAgent();
    const { app } = await makeApp();
    const [r1, r2] = await Promise.all([
      put(app, 'agents', agent.id, repo.id, ['specs/a.md']),
      put(app, 'agents', agent.id, repo.id, []),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agent.id));
    const paths = rows.map((r) => r.path);
    expect([[], ['specs/a.md']]).toContainEqual(paths);
    await app.close();
  });

  it('AC-5: used_by counts direct and enabled-skill agents once each; a disabled link does not count', async () => {
    const repo = await newRepo(await makeClone(CLONE));
    const direct = await newAgent();
    const viaSkill = await newAgent();
    const viaDisabled = await newAgent();
    const skill = await newSkill();
    await link(viaSkill.id, skill.id, 0, true);
    await link(viaDisabled.id, skill.id, 0, false);
    const { app } = await makeApp();
    await put(app, 'agents', direct.id, repo.id, ['specs/a.md']);
    await put(app, 'skills', skill.id, repo.id, ['specs/a.md']);
    const body = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    const a = body.files.find((f: { path: string }) => f.path === 'specs/a.md');
    // direct + viaSkill; viaDisabled's link is off. Agents seeded by other tests hold no attachments on this repo.
    expect(a.used_by).toBe(2);
    await app.close();
  });

  // ------------------------------------------------------------ run-time
  async function newPr(repoId: string, files: string[]) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: ++seq,
        title: 'Change',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: files.length,
        deletions: 0,
        filesCount: files.length,
        status: 'needs_review',
        body: '',
      })
      .returning();
    for (const path of files) {
      await pg.handle.db.insert(t.prFiles).values({
        prId: pr!.id,
        path,
        additions: 1,
        deletions: 0,
        patch: '@@ -1,2 +1,3 @@\n line one\n+line two\n line three',
      });
    }
    return pr!;
  }

  async function runReview(
    app: Awaited<ReturnType<typeof makeApp>>['app'],
    prId: string,
    agentId: string,
  ) {
    const run = await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    expect(run.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, prId, { expected: 1, timeoutMs: 20_000 });
    const runId = run.json().runs[0].run_id as string;
    // The run row turns `done` before the trace document is saved, so poll for it.
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (res.statusCode === 200) return res.json();
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`trace for run ${runId} was never saved`);
  }

  it('AC-11/12/13, EC-9: agent [b] + enabled skill [a,b] + disabled-link skill [c] -> specs_read [b, a]', async () => {
    const repo = await newRepo(await makeClone({ 'specs/a.md': '# Spec A body', 'docs/b.md': '# Doc B body', 'docs/c.md': 'C' }));
    const agent = await newAgent();
    const s1 = await newSkill();
    const s2 = await newSkill();
    await link(agent.id, s1.id, 0, true);
    await link(agent.id, s2.id, 1, false);
    const { app } = await makeApp();
    await put(app, 'agents', agent.id, repo.id, ['docs/b.md']);
    await put(app, 'skills', s1.id, repo.id, ['specs/a.md', 'docs/b.md']);
    await put(app, 'skills', s2.id, repo.id, ['docs/c.md']);
    const pr = await newPr(repo.id, ['src/a.ts']);
    const trace = await runReview(app, pr.id, agent.id);

    expect(trace.specs_read).toEqual(['docs/b.md', 'specs/a.md']);
    const specs: string = trace.prompt_assembly.specs;
    expect(specs.indexOf('<untrusted source="doc:docs/b.md">')).toBeGreaterThanOrEqual(0);
    expect(specs.indexOf('<untrusted source="doc:docs/b.md">')).toBeLessThan(
      specs.indexOf('<untrusted source="doc:specs/a.md">'),
    );
    expect(specs).not.toContain('docs/c.md');
    expect(specs).toContain('# Spec A body');
    expect(trace.prompt_tokens.specs).toBeGreaterThan(0);
    expect(JSON.stringify(trace.log)).toContain('project context: 2 document(s)');
    await app.close();
  });

  it('EC-4: a deleted attached file is skipped, named in the log, and the run is done', async () => {
    const clone = await makeClone({ 'docs/b.md': 'B', 'docs/gone.md': 'G' });
    const repo = await newRepo(clone);
    const agent = await newAgent();
    const { app } = await makeApp();
    await put(app, 'agents', agent.id, repo.id, ['docs/b.md', 'docs/gone.md']);
    await unlink(join(clone, 'docs/gone.md'));
    const pr = await newPr(repo.id, ['src/a.ts']);
    const trace = await runReview(app, pr.id, agent.id);
    expect(trace.specs_read).toEqual(['docs/b.md']);
    expect(JSON.stringify(trace.log)).toContain('docs/gone.md');
    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs[0]!.status).toBe('done');
    await app.close();
  });

  it('EC-5: a 70 KB file is cut with the marker and the log names it', async () => {
    const repo = await newRepo(await makeClone({ 'docs/big.md': 'a'.repeat(70 * 1024) }));
    const agent = await newAgent();
    const { app } = await makeApp();
    await put(app, 'agents', agent.id, repo.id, ['docs/big.md']);
    const pr = await newPr(repo.id, ['src/a.ts']);
    const trace = await runReview(app, pr.id, agent.id);
    expect(trace.prompt_assembly.specs).toContain('[truncated at 64 KB]');
    expect(JSON.stringify(trace.log)).toContain('docs/big.md');
    await app.close();
  });

  it('EC-6: attachments for repo B do not reach a PR in repo A', async () => {
    const cloneA = await makeClone({ 'docs/a.md': 'A' });
    const cloneB = await makeClone({ 'docs/b.md': 'B' });
    const repoA = await newRepo(cloneA);
    const repoB = await newRepo(cloneB);
    const agent = await newAgent();
    const { app } = await makeApp();
    await put(app, 'agents', agent.id, repoB.id, ['docs/b.md']);
    const pr = await newPr(repoA.id, ['src/a.ts']);
    const trace = await runReview(app, pr.id, agent.id);
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs ?? null).toBeNull();
    await app.close();
  });

  it('AC-15: no attachments -> no specs slot', async () => {
    const repo = await newRepo(await makeClone({ 'docs/a.md': 'A' }));
    const agent = await newAgent();
    const { app } = await makeApp();
    const pr = await newPr(repo.id, ['src/a.ts']);
    const trace = await runReview(app, pr.id, agent.id);
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs ?? null).toBeNull();
    expect(JSON.stringify(trace.log)).toContain('project context: 0 document(s)');
    await app.close();
  });

  it('NFR-5: repo-intel off for the agent -> documents still injected', async () => {
    const repo = await newRepo(await makeClone({ 'docs/a.md': 'A body' }));
    const agent = await newAgent({ repoIntel: false });
    const { app } = await makeApp();
    await put(app, 'agents', agent.id, repo.id, ['docs/a.md']);
    const pr = await newPr(repo.id, ['src/a.ts']);
    const trace = await runReview(app, pr.id, agent.id);
    expect(trace.specs_read).toEqual(['docs/a.md']);
    await app.close();
  });

  it('NFR-9: resolveForRun runs exactly once per agent run, even in map-reduce over two files', async () => {
    const repo = await newRepo(await makeClone({ 'docs/a.md': 'A body' }));
    const agent = await newAgent({ strategy: 'map-reduce' });
    const { app } = await makeApp({
      git: new MockGitClient({ diff: diffFor(['src/a.ts', 'src/b.ts']) }),
    });
    await put(app, 'agents', agent.id, repo.id, ['docs/a.md']);
    const real = app.container.projectContext;
    let calls = 0;
    const counting: ProjectContextPort = Object.assign(Object.create(real) as ProjectContextPort, {
      resolveForRun: (input: Parameters<ProjectContextPort['resolveForRun']>[0]) => {
        calls++;
        return real.resolveForRun(input);
      },
    });
    app.container['overrides'].projectContext = counting;
    const pr = await newPr(repo.id, ['src/a.ts', 'src/b.ts']);
    const trace = await runReview(app, pr.id, agent.id);
    expect(calls).toBe(1);
    expect(trace.specs_read).toEqual(['docs/a.md']);
    await app.close();
  });

  // ------------------------------------------------------------ authoring
  const SPECS = '.devdigest/specs';
  type TestApp = Awaited<ReturnType<typeof makeApp>>['app'];

  const create = (app: TestApp, repoId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/repos/${repoId}/context/files`, payload: payload as object });
  const upload = (app: TestApp, repoId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/repos/${repoId}/context/upload`, payload: payload as object });
  const save = (app: TestApp, repoId: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/repos/${repoId}/context/file`, payload: payload as object });
  const del = (app: TestApp, repoId: string, path: string, version: string) =>
    app.inject({
      method: 'DELETE',
      url: `/repos/${repoId}/context/file?path=${encodeURIComponent(path)}&version=${version}`,
    });
  const onDisk = (clone: string, rel: string) => readFile(join(clone, ...rel.split('/')), 'utf8');
  const fileExists = (clone: string, rel: string) =>
    stat(join(clone, ...rel.split('/'))).then(
      () => true,
      () => false,
    );

  it('EC-1: every write to a repo without a clone is 409 repo_not_cloned; unknown or foreign repo is 404', async () => {
    const repo = await newRepo(null);
    const { app } = await makeApp();
    const bodies = [
      await create(app, repo.id, { kind: 'file', name: 'a.md' }),
      await upload(app, repo.id, { name: 'a.md', content_base64: '' }),
      await save(app, repo.id, { path: `${SPECS}/a.md`, content: 'x', version: null }),
      await del(app, repo.id, `${SPECS}/a.md`, 'a'.repeat(64)),
    ];
    for (const res of bodies) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('repo_not_cloned');
    }

    expect((await create(app, GHOST, { kind: 'file', name: 'a.md' })).statusCode).toBe(404);
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'x',
        name: `pc-foreign-${seq++}`,
        fullName: `x/pc-foreign-${seq}`,
        clonePath: await makeClone({}),
      })
      .returning();
    expect((await create(app, foreign!.id, { kind: 'file', name: 'a.md' })).statusCode).toBe(404);
    await app.close();
  });

  it('untrusted shapes: an extra key, a malformed version and bad base64 are 422', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const { app } = await makeApp();
    expect((await create(app, repo.id, { kind: 'file', name: 'a.md', extra: 1 })).statusCode).toBe(422);
    expect((await create(app, repo.id, { kind: 'symlink', name: 'a.md' })).statusCode).toBe(422);
    expect(
      (await save(app, repo.id, { path: `${SPECS}/a.md`, content: 'x', version: 'not-a-hash' })).statusCode,
    ).toBe(422);
    expect((await upload(app, repo.id, { name: 'a.md', content_base64: 'ab!d' })).statusCode).toBe(422);
    expect((await del(app, repo.id, `${SPECS}/a.md`, 'nope')).statusCode).toBe(422);
    expect(await fileExists(clone, '.devdigest')).toBe(false);
    await app.close();
  });

  it('AC-2 / AC-3: create file, create folder and upload land on disk with the exact bytes', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const { app } = await makeApp();

    const f = await create(app, repo.id, { kind: 'file', name: 'untitled.md' });
    expect(f.statusCode).toBe(201);
    expect(f.json().path).toBe(`${SPECS}/untitled.md`);
    expect(await onDisk(clone, `${SPECS}/untitled.md`)).toBe('# Untitled spec\n\n## Goals\n- ');

    const d = await create(app, repo.id, { kind: 'folder', name: 'new-folder' });
    expect(d.statusCode).toBe(201);
    expect(d.json().path).toBe(`${SPECS}/new-folder/spec.md`);
    expect(await onDisk(clone, `${SPECS}/new-folder/spec.md`)).toBe('# New folder spec\n');

    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# T\r\nbody\r\n')]);
    const u = await upload(app, repo.id, { name: 'prd.md', content_base64: bytes.toString('base64') });
    expect(u.statusCode).toBe(201);
    const raw = await readFile(join(clone, '.devdigest', 'specs', 'prd.md'));
    expect(raw.equals(bytes)).toBe(true);
    await app.close();
  });

  it('AC-8: save changes size and tokens in the listing; EC-6: a stale PUT is 409 changed', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const { app } = await makeApp();
    const made = (await create(app, repo.id, { kind: 'file', name: 'a.md' })).json();
    const before = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    const rowBefore = before.files.find((f: { path: string }) => f.path === made.path);

    const body = 'line one\r\nline two with a good many more words in it\r\n';
    const ok = await save(app, repo.id, { path: made.path, content: body, version: made.version });
    expect(ok.statusCode).toBe(200);
    expect(await onDisk(clone, made.path)).toBe(body.replaceAll('\r\n', '\n'));

    const after = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    const rowAfter = after.files.find((f: { path: string }) => f.path === made.path);
    expect(rowAfter.size).toBe(Buffer.byteLength(body.replaceAll('\r\n', '\n')));
    expect(rowAfter.tokens).not.toBe(rowBefore.tokens);
    expect(rowAfter.version).toBe(ok.json().version);
    expect(rowAfter).toMatchObject({ editable: true, read_only_reason: null });

    const stale = await save(app, repo.id, { path: made.path, content: 'other', version: made.version });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('version_conflict');
    expect(stale.json().error.details.reason).toBe('changed');
    expect(stale.json().error.details.current_version).toBe(ok.json().version);
    await app.close();
  });

  it('AC-10: delete is 204, prunes empty folders and drops the row', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const { app } = await makeApp();
    const made = (await create(app, repo.id, { kind: 'folder', name: 'sub' })).json();
    const res = await del(app, repo.id, made.path, made.version);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await fileExists(clone, `${SPECS}/sub`)).toBe(false);
    expect(await fileExists(clone, SPECS)).toBe(true);
    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    expect(list.files.map((f: { path: string }) => f.path)).not.toContain(made.path);
    await app.close();
  });

  it('EC-10: a tracked root file is read-only in the listing and PUT is 422', async () => {
    const clone = await makeClone({ [`${SPECS}/t.md`]: 'tracked text', [`${SPECS}/free.md`]: 'free' });
    const repo = await newRepo(clone);
    const { app } = await makeApp({
      git: new MockGitClient({ diff: diffFor(['src/a.ts']), tracked: [`${SPECS}/t.md`] }),
    });
    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    const row = list.files.find((f: { path: string }) => f.path === `${SPECS}/t.md`);
    expect(row).toMatchObject({ editable: false, read_only_reason: 'tracked' });
    expect(list.files.find((f: { path: string }) => f.path === `${SPECS}/free.md`).editable).toBe(true);

    const res = await save(app, repo.id, { path: `${SPECS}/t.md`, content: 'x', version: row.version });
    expect(res.statusCode).toBe(422);
    expect(await onDisk(clone, `${SPECS}/t.md`)).toBe('tracked text');
    await app.close();
  });

  it('EC-11: a root file past the 500-row cap is readable, savable and attachable', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++) files[`!f-${String(i).padStart(3, '0')}.md`] = 'x';
    const clone = await makeClone(files);
    const repo = await newRepo(clone);
    const agent = await newAgent();
    const { app } = await makeApp();

    const made = (await create(app, repo.id, { kind: 'file', name: 'untitled.md' })).json();
    const list = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json();
    expect(list.files).toHaveLength(500);
    expect(list.total).toBe(501);
    expect(list.files.map((f: { path: string }) => f.path)).not.toContain(made.path);

    const one = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent(made.path)}`,
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().editable).toBe(true);

    const saved = await save(app, repo.id, { path: made.path, content: '# kept', version: one.json().version });
    expect(saved.statusCode).toBe(200);
    expect((await put(app, 'agents', agent.id, repo.id, [made.path])).statusCode).toBe(200);
    await app.close();
  });

  it('EC-12: the next run injects the saved text, then skips a deleted document', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const agent = await newAgent();
    const { app } = await makeApp();
    const made = (await create(app, repo.id, { kind: 'file', name: 'spec.md' })).json();
    expect((await put(app, 'agents', agent.id, repo.id, [made.path])).statusCode).toBe(200);
    const saved = await save(app, repo.id, {
      path: made.path,
      content: '# Fresh text from the author',
      version: made.version,
    });
    expect(saved.statusCode).toBe(200);

    const trace1 = await runReview(app, (await newPr(repo.id, ['src/a.ts'])).id, agent.id);
    expect(trace1.specs_read).toEqual([made.path]);
    expect(trace1.prompt_assembly.specs).toContain('# Fresh text from the author');

    expect((await del(app, repo.id, made.path, saved.json().version)).statusCode).toBe(204);
    const trace2 = await runReview(app, (await newPr(repo.id, ['src/a.ts'])).id, agent.id);
    expect(trace2.specs_read).toEqual([]);
    expect(JSON.stringify(trace2.log)).toContain(made.path);
    await app.close();
  });

  it('NFR-2 / NFR-8 / NFR-9: no model call, only paths persisted, one log line per write, never the content', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const agent = await newAgent();
    const skill = await newSkill();
    const { app, llm } = await makeApp();
    const infoSpy = vi.spyOn(app.log, 'info');
    const writeLines = () =>
      infoSpy.mock.calls
        .filter((c) => c[1] === 'project-context write')
        .map((c) => c[0] as { repoId: string; path: string; bytes: number; outcome: string });

    const SECRET = 'SECRET-BODY-TEXT-12345';
    const made = (await create(app, repo.id, { kind: 'file', name: 'a.md' })).json();
    expect(writeLines().map((l) => l.outcome)).toEqual(['created']);
    await put(app, 'agents', agent.id, repo.id, [made.path]);
    expect((await put(app, 'skills', skill.id, repo.id, [made.path])).statusCode).toBe(200);

    const ok = await save(app, repo.id, { path: made.path, content: SECRET, version: made.version });
    expect(ok.statusCode).toBe(200);
    expect(
      (await save(app, repo.id, { path: made.path, content: SECRET, version: made.version })).statusCode,
    ).toBe(409);
    expect(
      (await save(app, repo.id, { path: 'docs/a.md', content: SECRET, version: null })).statusCode,
    ).toBe(422);
    expect(
      (await save(app, repo.id, { path: made.path, content: SECRET, version: 'bad' })).statusCode,
    ).toBe(422);
    expect((await del(app, repo.id, made.path, ok.json().version)).statusCode).toBe(204);

    const lines = writeLines();
    expect(lines.map((l) => l.outcome)).toEqual([
      'created',
      'saved',
      'conflict',
      'rejected',
      'rejected',
      'deleted',
    ]);
    expect(lines.every((l) => l.repoId === repo.id)).toBe(true);
    expect(lines[1]).toMatchObject({ path: made.path, bytes: Buffer.byteLength(SECRET) });
    // Fastify's own request log hands pino the raw request; the assertion is about OUR lines.
    expect(JSON.stringify(lines)).not.toContain(SECRET);

    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agent.id));
    for (const r of rows) expect(Object.keys(r)).not.toContain('content');
    expect(JSON.stringify(rows)).not.toContain(SECRET);

    // Same pin for the skill side (20-verify-1 row 76): the table holds the path, never the text.
    const skillRows = await pg.handle.db
      .select()
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skill.id));
    expect(skillRows).toHaveLength(1);
    expect(skillRows[0]).toMatchObject({ path: made.path, repoId: repo.id });
    expect(Object.keys(skillRows[0]!).sort()).toEqual(['createdAt', 'order', 'path', 'repoId', 'skillId']);
    expect(JSON.stringify(skillRows)).not.toContain(SECRET);
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  it('EC-2 / NFR-9: a taken name gets -2, -3 over HTTP and never overwrites; an upload logs "uploaded"', async () => {
    const clone = await makeClone({ [`${SPECS}/untitled.md`]: 'mine', [`${SPECS}/prd.md`]: 'my prd' });
    const repo = await newRepo(clone);
    const { app } = await makeApp();
    const infoSpy = vi.spyOn(app.log, 'info');

    // Case-insensitive: Untitled.md collides with untitled.md.
    const a = await create(app, repo.id, { kind: 'file', name: 'Untitled.md' });
    expect(a.json().path).toBe(`${SPECS}/Untitled-2.md`); // the entered casing is kept
    const b = await create(app, repo.id, { kind: 'file', name: 'untitled.md' });
    expect(b.json().path).toBe(`${SPECS}/untitled-3.md`);
    expect(await onDisk(clone, `${SPECS}/untitled.md`)).toBe('mine');

    const f1 = await create(app, repo.id, { kind: 'folder', name: 'new-folder' });
    const f2 = await create(app, repo.id, { kind: 'folder', name: 'new-folder' });
    expect(f1.json().path).toBe(`${SPECS}/new-folder/spec.md`);
    expect(f2.json().path).toBe(`${SPECS}/new-folder-2/spec.md`);

    const u = await upload(app, repo.id, { name: 'PRD.md', content_base64: Buffer.from('# new').toString('base64') });
    expect(u.statusCode).toBe(201);
    expect(u.json().path).toBe(`${SPECS}/PRD-2.md`);
    expect(await onDisk(clone, `${SPECS}/prd.md`)).toBe('my prd');

    const lines = infoSpy.mock.calls
      .filter((c) => c[1] === 'project-context write')
      .map((c) => (c[0] as { outcome: string }).outcome);
    expect(lines).toEqual(['created', 'created', 'created', 'created', 'uploaded']);
    await app.close();
  });

  it('EC-4: a linked .devdigest/specs is refused with 422 over HTTP and the link target is untouched', async () => {
    const clone = await makeClone({});
    const outside = await makeClone({ 'keep.md': 'keep' });
    await mkdir(join(clone, '.devdigest'));
    await symlink(outside, join(clone, '.devdigest', 'specs'), process.platform === 'win32' ? 'junction' : 'dir');
    const repo = await newRepo(clone);
    const { app } = await makeApp();

    const results = [
      await create(app, repo.id, { kind: 'file', name: 'a.md' }),
      await create(app, repo.id, { kind: 'folder', name: 'sub' }),
      await upload(app, repo.id, { name: 'a.md', content_base64: Buffer.from('x').toString('base64') }),
      await save(app, repo.id, { path: `${SPECS}/a.md`, content: 'x', version: null }),
    ];
    for (const res of results) {
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    expect(await readdir(outside)).toEqual(['keep.md']);
    expect(await onDisk(outside, 'keep.md')).toBe('keep');
    await app.close();
  });

  it('EC-3 / EC-5: a bad name, over-cap bytes, a NUL and invalid UTF-8 are 422 naming the field and write nothing', async () => {
    const clone = await makeClone({ [`${SPECS}/a.md`]: 'original' });
    const repo = await newRepo(clone);
    const { app } = await makeApp();
    const version = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/file?path=${encodeURIComponent(`${SPECS}/a.md`)}` })
    ).json().version as string;
    const b64 = (b: Buffer) => b.toString('base64');
    const field = (res: { json: () => { error: { details: { field: string } } } }) => res.json().error.details.field;

    // 21,846 euro signs: under the contract's 65,536-character cap, over the 65,536-byte cap.
    const wide = await save(app, repo.id, { path: `${SPECS}/wide.md`, content: '€'.repeat(21_846), version: null });
    expect(wide.statusCode).toBe(422);
    expect(field(wide)).toBe('content');
    const nul = await save(app, repo.id, { path: `${SPECS}/a.md`, content: 'a\u0000b', version });
    expect(nul.statusCode).toBe(422);
    expect(field(nul)).toBe('content');

    const big = await upload(app, repo.id, { name: 'big.md', content_base64: b64(Buffer.alloc(65_537, 0x61)) });
    const badUtf8 = await upload(app, repo.id, { name: 'bad.md', content_base64: b64(Buffer.from([0xc3, 0x28])) });
    const nulUp = await upload(app, repo.id, { name: 'zero.md', content_base64: b64(Buffer.from('a\u0000b')) });
    for (const res of [big, badUtf8, nulUp]) {
      expect(res.statusCode).toBe(422);
      expect(field(res)).toBe('content');
    }
    const reserved = await upload(app, repo.id, { name: 'CON.md', content_base64: b64(Buffer.from('x')) });
    expect(reserved.statusCode).toBe(422);
    expect(field(reserved)).toBe('name');
    expect((await create(app, repo.id, { kind: 'file', name: 'a|b.md' })).statusCode).toBe(422);
    expect((await save(app, repo.id, { path: `${SPECS}/../x.md`, content: 'x', version: null })).statusCode).toBe(422);

    expect(await readdir(join(clone, '.devdigest', 'specs'))).toEqual(['a.md']);
    expect(await onDisk(clone, `${SPECS}/a.md`)).toBe('original');
    await app.close();
  });

  it('EC-6: a stale DELETE is 409 changed and keeps the file; a SAVE over a file deleted on disk is 409 deleted', async () => {
    const clone = await makeClone({});
    const repo = await newRepo(clone);
    const { app } = await makeApp();
    const made = (await create(app, repo.id, { kind: 'file', name: 'a.md' })).json();
    const saved = await save(app, repo.id, { path: made.path, content: 'v2', version: made.version });
    expect(saved.statusCode).toBe(200);

    const stale = await del(app, repo.id, made.path, made.version);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details).toEqual({ reason: 'changed', current_version: saved.json().version });
    expect(await onDisk(clone, made.path)).toBe('v2');

    await unlink(join(clone, ...made.path.split('/')));
    const gone = await save(app, repo.id, { path: made.path, content: 'v3', version: saved.json().version });
    expect(gone.statusCode).toBe(409);
    expect(gone.json().error.details).toEqual({ reason: 'deleted', current_version: null });
    expect(await fileExists(clone, made.path)).toBe(false);
    await app.close();
  });
});
