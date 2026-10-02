import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import { OnboardingPage, type OnboardingDraft, type StructuredRequest } from '@devdigest/shared';

/**
 * Onboarding generator — what a generation is *scoped to*, against real Postgres:
 * the Settings model (AC-5), the caller's workspace (identity), one row per repo
 * that Regenerate replaces (NFR-11), "opening the page makes no model call"
 * (NFR-1), and the index ordering that only real SQL can break — equal ranks
 * inserted in the *wrong* order must still come back by path (AC-6, AC-8, NFR-2),
 * with tests / configs / declaration files / migrations kept out of the reading
 * path (AC-6). Companion to `onboarding.it.test.ts`, which owns the main flow and
 * the error codes; it is an `.it` because every case reads or writes the DB.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding-scope] Docker not available — skipping integration tests.');
}

const DEFAULT_MODEL = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } as const;
const OTHER_MODEL = { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } as const;

const draft = (architecture: string): OnboardingDraft => ({
  architecture,
  diagram: null,
  file_reasons: [],
  commands: [],
  first_tasks: [],
});

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Onboarding scope (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clone: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    clone = await mkdtemp(join(tmpdir(), 'dd-onb-scope-'));
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clone, { recursive: true, force: true });
  });

  async function makeApp(architecture = 'prose') {
    const mock = new MockLLMProvider('openai', { structuredBySchema: { OnboardingDraft: draft(architecture) } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        embedder: new MockEmbedder(),
        llm: { openai: mock, openrouter: mock },
      },
    });
    return { app, mock };
  }

  /** A repo in `ws`, indexed with exactly these rank rows (insert order preserved) and edges. */
  async function newIndexedRepo(
    ranks: [string, number][],
    edges: [string, string][] = [],
    ws: string = workspaceId,
  ) {
    const db = pg.handle.db;
    const name = `onb-scope-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath: clone })
      .returning();
    for (const [filePath, rank] of ranks) {
      // one INSERT per row so the heap order is the order given
      await db.insert(t.fileRank).values({
        repoId: repo!.id,
        filePath,
        pagerank: rank,
        hotness: 0,
        rank,
        percentile: Math.round(rank * 100),
      });
    }
    for (const [fromFile, toFile] of edges) {
      await db.insert(t.fileEdges).values({ repoId: repo!.id, fromFile, toFile });
    }
    await db.insert(t.repoIndexState).values({
      repoId: repo!.id,
      lastIndexedSha: 'sha1',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: ranks.length,
      filesSkipped: 0,
    });
    return repo!;
  }

  type App = Awaited<ReturnType<typeof makeApp>>['app'];
  const get = (app: App, id: string) => app.inject({ method: 'GET', url: `/repos/${id}/onboarding` });
  const post = (app: App, id: string) =>
    app.inject({ method: 'POST', url: `/repos/${id}/onboarding/generate`, payload: {} });
  const structuredCalls = (mock: MockLLMProvider) => mock.calls.filter((c) => c.method === 'completeStructured');

  it('AC-5: generation uses the model chosen in Settings and records it with the tour', async () => {
    const { app, mock } = await makeApp();
    const repo = await newIndexedRepo([['src/a.ts', 0.9]]);

    const put = (feature: typeof OTHER_MODEL | typeof DEFAULT_MODEL) =>
      app.inject({ method: 'PUT', url: '/settings', payload: { feature_models: { onboarding: feature } } });
    try {
      expect((await put(OTHER_MODEL)).statusCode).toBe(200);
      const tour = OnboardingPage.parse((await post(app, repo.id)).json()).tour!;

      expect(structuredCalls(mock)).toHaveLength(1);
      expect((structuredCalls(mock)[0]!.req as StructuredRequest<unknown>).model).toBe(OTHER_MODEL.model);
      expect(tour).toMatchObject(OTHER_MODEL);
    } finally {
      await put(DEFAULT_MODEL);
      await app.close();
    }
  });

  it('NFR-11 / NFR-1: Regenerate replaces the one stored tour; reading the page never calls the model', async () => {
    const first = await makeApp('first version');
    const repo = await newIndexedRepo([['src/a.ts', 0.9]]);
    const rows = () => pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));

    const before = OnboardingPage.parse((await post(first.app, repo.id)).json()).tour!;
    for (let i = 0; i < 3; i += 1) await get(first.app, repo.id);
    expect(structuredCalls(first.mock)).toHaveLength(1); // the three GETs added none
    await first.app.close();

    await new Promise((r) => setTimeout(r, 15)); // generated_at must differ
    const second = await makeApp('second version');
    const after = OnboardingPage.parse((await post(second.app, repo.id)).json()).tour!;
    expect(await rows()).toHaveLength(1);
    expect(after.architecture.prose).toBe('second version');
    expect(before.architecture.prose).toBe('first version');
    expect(after.generated_at > before.generated_at).toBe(true);
    expect(OnboardingPage.parse((await get(second.app, repo.id)).json()).tour).toEqual(after);
    await second.app.close();
  });

  it('identity: a repo in another workspace is a 404 for GET and POST, and no model call is made', async () => {
    const { app, mock } = await makeApp();
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'someone else' }).returning();
    const foreign = await newIndexedRepo([['src/a.ts', 0.9]], [], other!.id);

    expect((await get(app, foreign.id)).statusCode).toBe(404);
    expect((await post(app, foreign.id)).statusCode).toBe(404);
    expect(structuredCalls(mock)).toHaveLength(0);
    await app.close();
  });

  it('AC-6 / NFR-2: equal ranks come back by path whatever the insert order; at most 8; junk files never appear', async () => {
    const { app } = await makeApp();
    const ties = Array.from({ length: 12 }, (_, i) => `src/f${String(i + 1).padStart(2, '0')}.ts`);
    const ranks: [string, number][] = [
      // junk with the top ranks: must not be listed, and must not shrink the list
      ['src/types.d.ts', 0.99],
      ['vite.config.ts', 0.98],
      ['server/src/db/migrations/0001_init.ts', 0.97],
      ['src/util.test.ts', 0.96],
      // twelve equal-rank files, inserted in REVERSE path order
      ...[...ties].reverse().map((p): [string, number] => [p, 0.5]),
    ];
    const repo = await newIndexedRepo(ranks);

    const tour = OnboardingPage.parse((await post(app, repo.id)).json()).tour!;
    expect(tour.reading_path.map((f) => f.path)).toEqual(ties.slice(0, 8));

    const again = OnboardingPage.parse((await post(app, repo.id)).json()).tour!;
    expect(again.reading_path.map((f) => f.path)).toEqual(tour.reading_path.map((f) => f.path));
    await app.close();
  });

  it('AC-8 / NFR-2: a chain follows the lexically smaller of two equal-rank imports, whatever the edge insert order', async () => {
    const { app } = await makeApp();
    const repo = await newIndexedRepo(
      [
        ['src/root.ts', 0.9],
        ['src/t_b.ts', 0.5],
        ['src/t_a.ts', 0.5],
      ],
      [
        ['src/root.ts', 'src/t_b.ts'], // inserted first
        ['src/root.ts', 'src/t_a.ts'],
      ],
    );

    const tour = OnboardingPage.parse((await post(app, repo.id)).json()).tour!;
    expect(tour.critical_paths.map((f) => f.path)).toEqual(['src/root.ts', 'src/t_a.ts']);
    await app.close();
  });
});
