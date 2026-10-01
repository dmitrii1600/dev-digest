import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises';
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
 * list / file / PUT routes).
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
});
