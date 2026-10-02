import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import {
  OnboardingPage,
  type LLMProvider,
  type OnboardingDraft,
  type StructuredRequest,
} from '@devdigest/shared';

/**
 * Onboarding generator — routes end to end against real Postgres, with the model
 * mocked (`structuredBySchema.OnboardingDraft`), a temp clone on disk and index
 * rows (file_rank, file_edges, repo_index_state) inserted directly. The real
 * RepoIntel facade is used, so the deterministic ordering fix is exercised too.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

const DEFAULT_MODEL = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' }; // registry default

const DRAFT: OnboardingDraft = {
  architecture: 'A small API.',
  diagram: 'flowchart LR\nA-->B',
  file_reasons: [
    { path: 'src/a.ts', reason: 'The entry point.' },
    { path: 'src/b.ts', reason: 'Wires the thing.' },
    { path: 'src/invented.ts', reason: 'A ghost.' },
  ],
  commands: [
    { line: 'npm install', source_path: 'README.md' },
    { line: 'npm run dev', source_path: 'package.json' },
    { line: 'npm run ghost', source_path: 'src/invented.ts' },
  ],
  first_tasks: [
    { text: 'Read the entry point', paths: ['src/a.ts'], complexity: 'low' },
    { text: 'Fix the ghost', paths: ['src/invented.ts'], complexity: 'high' },
  ],
};

const RANKS: [string, number][] = [
  ['src/foo.test.ts', 1.0], // top rank, but a test → never in the tour
  ['src/a.ts', 0.9],
  ['src/b.ts', 0.5], // equal-rank pair: b before c by path
  ['src/c.ts', 0.5],
  ['src/d.ts', 0.3],
  ['src/e.ts', 0.2],
];
const EDGES: [string, string][] = [
  ['src/a.ts', 'src/b.ts'],
  ['src/a.ts', 'src/d.ts'],
  ['src/b.ts', 'src/e.ts'],
];

const config = (extra: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', ...extra } as NodeJS.ProcessEnv);

function fakeLlm(completeStructured: <T>(req: StructuredRequest<T>) => Promise<never>): LLMProvider {
  return {
    id: 'openai',
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
    completeStructured: completeStructured as LLMProvider['completeStructured'],
  };
}

d('Onboarding module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clone: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    clone = await mkdtemp(join(tmpdir(), 'dd-onb-it-'));
    await mkdir(join(clone, 'src'), { recursive: true });
    for (const [path] of RANKS) await writeFile(join(clone, path), `export const x = '${path}';\n`);
    await writeFile(join(clone, 'README.md'), '# Demo\nrun npm install\n');
    await writeFile(join(clone, 'package.json'), '{ "scripts": { "dev": "vite" } }');
    await writeFile(join(clone, '.env'), 'SECRET=x');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clone, { recursive: true, force: true });
  });

  async function makeApp(
    opts: {
      llm?: LLMProvider;
      draft?: unknown;
      flag?: boolean;
      secrets?: MockSecretsProvider;
      noLlmOverride?: boolean;
    } = {},
  ) {
    const mock = new MockLLMProvider('openai', {
      structuredBySchema: { OnboardingDraft: opts.draft ?? DRAFT },
    });
    const llm = opts.llm ?? mock;
    const app = await buildApp({
      config: config(opts.flag === false ? { REPO_INTEL_ENABLED: 'false' } : {}),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        embedder: new MockEmbedder(),
        ...(opts.secrets ? { secrets: opts.secrets } : {}),
        ...(opts.noLlmOverride ? {} : { llm: { openai: llm, openrouter: llm } }),
      },
    });
    return { app, mock };
  }

  async function newRepo(opts: { clonePath?: string | null; indexed?: boolean } = {}) {
    const name = `onb-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: opts.clonePath === undefined ? clone : opts.clonePath,
      })
      .returning();
    if (opts.indexed !== false) await indexRepo(repo!.id);
    return repo!;
  }

  async function indexRepo(repoId: string) {
    const db = pg.handle.db;
    await db.insert(t.fileRank).values(
      RANKS.map(([filePath, rank]) => ({
        repoId,
        filePath,
        pagerank: rank,
        hotness: 0,
        rank,
        percentile: Math.round(rank * 100),
      })),
    );
    await db.insert(t.fileEdges).values(EDGES.map(([fromFile, toFile]) => ({ repoId, fromFile, toFile })));
    // The state row goes in last: it is what marks the index usable.
    await db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'sha1',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 42,
      filesSkipped: 0,
    });
  }

  const get = async (app: Awaited<ReturnType<typeof makeApp>>['app'], id: string) =>
    app.inject({ method: 'GET', url: `/repos/${id}/onboarding` });
  const post = async (app: Awaited<ReturnType<typeof makeApp>>['app'], id: string) =>
    app.inject({ method: 'POST', url: `/repos/${id}/onboarding/generate`, payload: {} });
  const structuredCalls = (mock: MockLLMProvider) => mock.calls.filter((c) => c.method === 'completeStructured');

  it('EC-1: GET before generation → no tour, not generating', async () => {
    const { app } = await makeApp();
    const repo = await newRepo();
    const res = await get(app, repo.id);
    expect(res.statusCode).toBe(200);
    const body = OnboardingPage.parse(res.json());
    expect(body).toMatchObject({ tour: null, generating: false, stale: false });
    expect(body.repo).toEqual({ name: repo.name, full_name: repo.fullName, default_branch: 'main' });
    await app.close();
  });

  it('AC-5 / AC-6 / AC-8 / AC-16 / AC-17 / NFR-1 / NFR-2 / NFR-5: one call, index-fixed files, grounded text, stable on repeat', async () => {
    const { app, mock } = await makeApp();
    const repo = await newRepo();

    const res = await post(app, repo.id);
    expect(res.statusCode).toBe(200);
    const page = OnboardingPage.parse(res.json());
    const tour = page.tour!;

    expect(structuredCalls(mock)).toHaveLength(1);
    expect((structuredCalls(mock)[0]!.req as StructuredRequest<unknown>).maxRetries).toBe(0);

    // AC-6: the test file is excluded; the equal-rank pair is ordered by path; at most 8.
    expect(tour.reading_path.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
      'src/e.ts',
    ]);
    expect(tour.reading_path.length).toBeLessThanOrEqual(8);
    expect(tour.reading_path[0]!.reason).toBe('The entry point.');
    expect(tour.reading_path[2]!.reason).toBeNull();
    // AC-8: distinct chain files, rank order, at most 6.
    expect(tour.critical_paths.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/e.ts']);

    // AC-16 (amended): src/invented.ts survives nowhere; package.json and README.md do.
    expect(tour.run_locally).toEqual([
      { line: 'npm install', source_path: 'README.md' },
      { line: 'npm run dev', source_path: 'package.json' },
    ]);
    expect(tour.first_tasks).toEqual([{ text: 'Read the entry point', paths: ['src/a.ts'], complexity: 'low' }]);
    expect(JSON.stringify(tour)).not.toContain('invented');
    expect(tour.architecture.diagram).toBe('flowchart LR\nA-->B');

    // AC-17: provider/model recorded; a later Settings change does not rewrite the stored tour.
    expect(tour).toMatchObject({ ...DEFAULT_MODEL, index_sha: 'sha1', files_indexed: 42 });

    // NFR-5: no secret reached the model, and clone text sits inside untrusted blocks.
    const req = structuredCalls(mock)[0]!.req as StructuredRequest<unknown>;
    const all = req.messages.map((m) => m.content).join('\n');
    expect(all).not.toContain('SECRET=x');
    const user = req.messages[1]!.content;
    const outside = user.replace(/<untrusted [\s\S]*?\n<\/untrusted>/g, '');
    expect(outside).not.toContain('Demo');
    expect(outside).not.toContain('vite');
    expect(user).toContain('<untrusted source="file:README.md">');

    // NFR-2: a second run on the same index gives identical file lists.
    const again = OnboardingPage.parse((await post(app, repo.id)).json()).tour!;
    expect(again.reading_path.map((f) => f.path)).toEqual(tour.reading_path.map((f) => f.path));
    expect(again.critical_paths.map((f) => f.path)).toEqual(tour.critical_paths.map((f) => f.path));

    // AC-17: change the Settings choice → the stored tour keeps its provider/model.
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } } },
    });
    expect(put.statusCode).toBe(200);
    const stored = OnboardingPage.parse((await get(app, repo.id)).json()).tour!;
    expect(stored.model).toBe(DEFAULT_MODEL.model);
    await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: DEFAULT_MODEL } },
    });
    await app.close();
  });

  it('EC-2: no clone → 422 repo_not_cloned', async () => {
    const { app, mock } = await makeApp();
    const repo = await newRepo({ clonePath: null });
    const res = await post(app, repo.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('repo_not_cloned');
    expect(structuredCalls(mock)).toHaveLength(0);
    await app.close();
  });

  it('EC-3: never indexed / no ranked files / flag off → 422 repo_not_indexed with a reason, no LLM call', async () => {
    const { app, mock } = await makeApp();
    const never = await newRepo({ indexed: false });
    const r1 = await post(app, never.id);
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error).toMatchObject({ code: 'repo_not_indexed', details: { reason: 'never_indexed' } });

    const empty = await newRepo({ indexed: false });
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: empty.id,
      lastIndexedSha: 'sha1',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 0,
    });
    const r2 = await post(app, empty.id);
    expect(r2.json().error).toMatchObject({ code: 'repo_not_indexed', details: { reason: 'no_ranked_files' } });
    expect(structuredCalls(mock)).toHaveLength(0);
    await app.close();

    const off = await makeApp({ flag: false });
    const indexed = await newRepo();
    const r3 = await post(off.app, indexed.id);
    expect(r3.statusCode).toBe(422);
    expect(r3.json().error).toMatchObject({ code: 'repo_not_indexed', details: { reason: 'flag_off' } });
    expect(structuredCalls(off.mock)).toHaveLength(0);
    await off.app.close();
  });

  it('EC-5: no API key → 422 provider_key_missing, no call, the earlier tour is unchanged', async () => {
    const first = await makeApp();
    const repo = await newRepo();
    const before = OnboardingPage.parse((await post(first.app, repo.id)).json()).tour!;
    await first.app.close();

    const { app } = await makeApp({ secrets: new MockSecretsProvider({}), noLlmOverride: true });
    const res = await post(app, repo.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'provider_key_missing',
      details: { provider: 'openrouter' },
    });
    const after = OnboardingPage.parse((await get(app, repo.id)).json()).tour!;
    expect(after).toEqual(before);
    await app.close();
  });

  it('EC-4: a failing model → 502 generation_failed, the previous tour is unchanged', async () => {
    const first = await makeApp();
    const repo = await newRepo();
    const before = OnboardingPage.parse((await post(first.app, repo.id)).json()).tour!;
    await first.app.close();

    const { app } = await makeApp({
      llm: fakeLlm(async () => {
        throw new Error('boom');
      }),
    });
    const res = await post(app, repo.id);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'generation_failed', details: { reason: 'llm_error' } });
    const after = OnboardingPage.parse((await get(app, repo.id)).json());
    expect(after.tour).toEqual(before);
    expect(after.generating).toBe(false);
    await app.close();
  });

  it('EC-6 / AC-15 / EC-12: a second POST while one runs → 409; GET shows generating and the old tour; one call', async () => {
    const first = await makeApp();
    const repo = await newRepo();
    const old = OnboardingPage.parse((await post(first.app, repo.id)).json()).tour!;
    await first.app.close();

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const slow = fakeLlm(async <T>(req: StructuredRequest<T>) => {
      calls += 1;
      await gate;
      return {
        data: req.schema.parse(DRAFT),
        model: req.model,
        tokensIn: 1,
        tokensOut: 1,
        costUsd: null,
        raw: '',
        attempts: 1,
      } as never;
    });
    const { app } = await makeApp({ llm: slow });

    const a = post(app, repo.id); // not awaited
    await new Promise((r) => setTimeout(r, 100));
    const mid = OnboardingPage.parse((await get(app, repo.id)).json());
    expect(mid.generating).toBe(true);
    expect(mid.tour).toEqual(old);

    const b = await post(app, repo.id);
    expect(b.statusCode).toBe(409);
    expect(b.json().error.code).toBe('generation_running');

    release();
    expect((await a).statusCode).toBe(200);
    const done = OnboardingPage.parse((await get(app, repo.id)).json());
    expect(done.generating).toBe(false);
    expect(done.tour!.generated_at).not.toBe(old.generated_at);
    expect(calls).toBe(1);
    await app.close();
  });

  it('EC-9: the index moves to another commit → stale', async () => {
    const { app } = await makeApp();
    const repo = await newRepo();
    await post(app, repo.id);
    expect(OnboardingPage.parse((await get(app, repo.id)).json()).stale).toBe(false);
    await pg.handle.db
      .update(t.repoIndexState)
      .set({ lastIndexedSha: 'sha2' })
      .where(eq(t.repoIndexState.repoId, repo.id));
    expect(OnboardingPage.parse((await get(app, repo.id)).json()).stale).toBe(true);
    await app.close();
  });

  it('NFR-4: the stored tour stays viewable with the flag off, no keys and the index rows gone', async () => {
    const first = await makeApp();
    const repo = await newRepo();
    const tour = OnboardingPage.parse((await post(first.app, repo.id)).json()).tour!;
    await first.app.close();

    await pg.handle.db.delete(t.fileRank).where(eq(t.fileRank.repoId, repo.id));
    await pg.handle.db.delete(t.fileEdges).where(eq(t.fileEdges.repoId, repo.id));
    await pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repo.id));

    const { app } = await makeApp({ flag: false, secrets: new MockSecretsProvider({}), noLlmOverride: true });
    const res = await get(app, repo.id);
    expect(res.statusCode).toBe(200);
    expect(OnboardingPage.parse(res.json()).tour).toEqual(tour);
    await app.close();
  });

  it('NFR-11: deleting the repo deletes its tour', async () => {
    const { app } = await makeApp();
    const repo = await newRepo();
    await post(app, repo.id);
    const rows = () => pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(await rows()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/repos/${repo.id}` })).statusCode).toBe(200);
    expect(await rows()).toHaveLength(0);
    await app.close();
  });

  it('identity: unknown uuid → 404, non-uuid → 422, a non-empty body → 422', async () => {
    const { app } = await makeApp();
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await get(app, unknown)).statusCode).toBe(404);
    expect((await post(app, unknown)).statusCode).toBe(404);
    expect((await get(app, 'not-a-uuid')).statusCode).toBe(422);
    expect((await post(app, 'not-a-uuid')).statusCode).toBe(422);

    const repo = await newRepo();
    const bad = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/onboarding/generate`,
      payload: { x: 1 },
    });
    expect(bad.statusCode).toBe(422);
    await app.close();
  });
});
