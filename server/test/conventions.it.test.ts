import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { ConventionExtraction, Review } from '@devdigest/shared';

/**
 * Conventions extractor — routes end to end against real Postgres, with the
 * model mocked (`structuredBySchema.ConventionExtraction`), a temp clone on
 * disk, and a `RepoIntel` override that returns the sampled paths. Covers:
 * extract + persistence, 409/422 edges, rescan-keeps-decisions, PATCH
 * accept/reject/edit, skill preview (writes nothing), skill create (skill +
 * v1 + links + skill_id), and the trust rule in the review prompt.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

const USERS_TS = [
  "import { db } from '../db';",
  '',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  return user;',
  '}',
].join('\n');
const REDIS_TS = "export const redis = new Redis(config.redisUrl);\n";

const RULE_ASYNC = 'Always use async/await instead of .then() chains';
const RULE_REDIS = 'Redis access goes through the src/lib/redis.ts singleton';

const EXTRACTION: ConventionExtraction = {
  candidates: [
    {
      category: 'async',
      rule: RULE_ASYNC,
      evidence: { path: 'src/api/users.ts', line: 9, snippet: 'const user = await db.users.find(id);' },
      confidence: 0.91,
    },
    {
      category: 'structure',
      rule: RULE_REDIS,
      evidence: { path: 'src/lib/redis.ts', line: 1, snippet: 'export const redis = new Redis(config.redisUrl);' },
      confidence: 0.85,
    },
    {
      category: 'naming',
      rule: 'Hallucinated: cites a file that was never sampled',
      evidence: { path: 'src/never.ts', line: 1, snippet: 'export const redis = new Redis(config.redisUrl);' },
      confidence: 0.99,
    },
    {
      category: 'naming',
      rule: 'Hallucinated: snippet is not in the file',
      evidence: { path: 'src/api/users.ts', line: 2, snippet: 'this text is nowhere in users.ts' },
      confidence: 0.99,
    },
  ],
};

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'ok',
  score: 100,
  findings: [],
};

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clone: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    clone = await mkdtemp(join(tmpdir(), 'dd-conv-it-'));
    await mkdir(join(clone, 'src', 'api'), { recursive: true });
    await mkdir(join(clone, 'src', 'lib'), { recursive: true });
    await writeFile(join(clone, 'src', 'api', 'users.ts'), USERS_TS);
    await writeFile(join(clone, 'src', 'lib', 'redis.ts'), REDIS_TS);
    await writeFile(join(clone, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(clone, { recursive: true, force: true });
  });

  /**
   * The real facade with ONE method replaced: `getConventionSamples` returns the
   * temp clone's paths (there is no index to rank). Everything else — the repo
   * map, callers, rank — keeps its graceful "unindexed → empty" behaviour, which
   * the review run at the end of this file relies on.
   */
  async function makeApp(opts: { paths?: string[]; extraction?: unknown; review?: unknown } = {}) {
    const llm = new MockLLMProvider('openai', {
      structured: opts.review ?? REVIEW_FIXTURE,
      structuredBySchema: { ConventionExtraction: opts.extraction ?? EXTRACTION },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        embedder: new MockEmbedder(),
        llm: { openai: llm, openrouter: llm },
      },
    });
    const paths = opts.paths ?? ['src/api/users.ts', 'src/lib/redis.ts'];
    const real = app.container.repoIntel;
    const patched: RepoIntel = Object.assign(Object.create(real) as RepoIntel, {
      getConventionSamples: async () => paths,
    });
    app.container['overrides'].repoIntel = patched;
    return app;
  }

  async function newRepo(clonePath: string | null = clone) {
    const name = `conv-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  it('GET on a fresh repo: no scan, no candidates; the seeded demo repo has both', async () => {
    const app = await makeApp();
    const repo = await newRepo();
    const fresh = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json();
    expect(fresh).toEqual({ scan: null, candidates: [], rejected_count: 0 });

    const [demo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const seeded = (await app.inject({ method: 'GET', url: `/repos/${demo!.id}/conventions` })).json();
    expect(seeded.scan).toMatchObject({ status: 'done', candidates_grounded: 3 });
    expect(seeded.candidates).toHaveLength(3);
    expect(seeded.candidates.map((c: { status: string }) => c.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    await app.close();
  });

  it('extract: samples in code, one structured call, grounding drops hallucinations, result persists', async () => {
    const app = await makeApp();
    const repo = await newRepo();
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const page = res.json();

    expect(page.scan).toMatchObject({
      status: 'done',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash', // registry default — no override set
      sampled_files: ['tsconfig.json', 'src/api/users.ts', 'src/lib/redis.ts'],
      candidates_total: 4,
      candidates_grounded: 2,
      dropped_ungrounded: 2,
      dropped_duplicate: 0,
      tokens_in: 100,
      tokens_out: 50,
    });
    expect(page.candidates).toHaveLength(2);
    // sorted by confidence desc; the async rule was claimed at line 9 but FOUND at 4
    expect(page.candidates[0]).toMatchObject({
      category: 'async',
      rule: RULE_ASYNC,
      evidence_path: 'src/api/users.ts',
      evidence_line: 4,
      evidence_snippet: 'const user = await db.users.find(id);',
      confidence: 0.91,
      status: 'pending',
      edited: false,
      skill_id: null,
    });
    expect(page.candidates[1]).toMatchObject({ rule: RULE_REDIS, evidence_line: 1 });

    // Exactly one model call, with the numbered samples in the user message.
    const llm = app.container['overrides'].llm!.openai as MockLLMProvider;
    const calls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(calls).toHaveLength(1);
    const req = calls[0]!.req as { schemaName: string; model: string; messages: { content: string }[] };
    expect(req.schemaName).toBe('ConventionExtraction');
    expect(req.messages[1]!.content).toContain('<untrusted source="sample:src/api/users.ts">');
    expect(req.messages[1]!.content).toContain('4:   const user = await db.users.find(id);');
    expect(req.messages[1]!.content).toContain('## Config files (1)');

    // Persisted: a second app instance reads the same page.
    await app.close();
    const app2 = await makeApp();
    const again = (await app2.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json();
    expect(again.candidates).toHaveLength(2);
    expect(again.scan.id).toBe(page.scan.id);
    await app2.close();
  });

  it('extract edges: 422 repo_not_cloned, 422 repo_not_indexed, 409 scan_running, 404 unknown repo', async () => {
    const notCloned = await newRepo(null);
    const app = await makeApp();
    const a = await app.inject({ method: 'POST', url: `/repos/${notCloned.id}/conventions/extract` });
    expect(a.statusCode).toBe(422);
    expect(a.json().error.code).toBe('repo_not_cloned');
    await app.close();

    const appNoIndex = await makeApp({ paths: [] });
    const repo = await newRepo();
    const b = await appNoIndex.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(b.statusCode).toBe(422);
    expect(b.json().error.code).toBe('repo_not_indexed');

    await pg.handle.db.insert(t.conventionScans).values({
      workspaceId,
      repoId: repo.id,
      status: 'running',
      provider: 'openai',
      model: 'x',
    });
    const c = await appNoIndex.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(c.statusCode).toBe(409);
    expect(c.json().error.code).toBe('scan_running');

    const ghost = await appNoIndex.inject({
      method: 'POST',
      url: '/repos/00000000-0000-0000-0000-000000000000/conventions/extract',
    });
    expect(ghost.statusCode).toBe(404);
    await appNoIndex.close();
  });

  it('a failed model call marks the scan failed and surfaces the error', async () => {
    const app = await makeApp({ extraction: { candidates: 'not-an-array' } });
    const repo = await newRepo();
    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const [scan] = await pg.handle.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repo.id));
    expect(scan!.status).toBe('failed');
    expect(scan!.error).toContain('fixture failed schema');
    await app.close();
  });

  it('PATCH: accept, edit (marks edited, evidence untouched), reject hides; rescan keeps decisions', async () => {
    const app = await makeApp();
    const repo = await newRepo();
    const first = (
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` })
    ).json();
    const [asyncC, redisC] = first.candidates as { id: string }[];

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/repos/${repo.id}/conventions/${asyncC!.id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'accepted', edited: false });

    const edited = await app.inject({
      method: 'PATCH',
      url: `/repos/${repo.id}/conventions/${asyncC!.id}`,
      payload: { rule: 'Use async/await; never chain .then()', category: 'style' },
    });
    expect(edited.json()).toMatchObject({
      rule: 'Use async/await; never chain .then()',
      category: 'style',
      edited: true,
      status: 'accepted',
      evidence_line: 4,
    });

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/repos/${repo.id}/conventions/${redisC!.id}`,
      payload: { status: 'rejected' },
    });
    expect(rejected.json().status).toBe('rejected');

    const empty = await app.inject({
      method: 'PATCH',
      url: `/repos/${repo.id}/conventions/${redisC!.id}`,
      payload: {},
    });
    expect(empty.statusCode).toBe(422);

    const page = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json();
    expect(page.candidates).toHaveLength(1);
    expect(page.rejected_count).toBe(1);

    // Rescan: the fixture still proposes the redis rule (→ dropped as duplicate
    // of the rejection) and the async rule (→ the accepted, edited row wins).
    const second = (
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` })
    ).json();
    expect(second.scan.id).not.toBe(first.scan.id);
    expect(second.scan.dropped_duplicate).toBe(1); // the rejected redis rule
    expect(second.scan.candidates_grounded).toBe(1); // the async rule re-proposed
    expect(second.candidates).toHaveLength(2); // accepted (edited) + the fresh pending async
    const rules = second.candidates.map((c: { rule: string; status: string }) => [c.rule, c.status]);
    expect(rules).toContainEqual(['Use async/await; never chain .then()', 'accepted']);
    expect(rules).toContainEqual([RULE_ASYNC, 'pending']);
    expect(second.rejected_count).toBe(1);
    const [redisRow] = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.id, redisC!.id));
    expect(redisRow!.status).toBe('rejected');
    await app.close();
  });

  it('skill preview writes nothing; create writes the skill, v1, the links and skill_id; the prompt trusts it', async () => {
    const app = await makeApp();
    const repo = await newRepo();
    const page = (
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` })
    ).json();
    const ids = (page.candidates as { id: string }[]).map((c) => c.id);

    // Nothing accepted yet → preview is an empty draft, create is 422.
    const emptyPreview = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/skill/preview`, payload: {} });
    expect(emptyPreview.statusCode).toBe(200);
    expect(emptyPreview.json().candidate_ids).toEqual([]);

    for (const id of ids) {
      await app.inject({
        method: 'PATCH',
        url: `/repos/${repo.id}/conventions/${id}`,
        payload: { status: 'accepted' },
      });
    }

    const preview = (
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/skill/preview`, payload: {} })
    ).json();
    expect(preview).toMatchObject({
      name: 'repo-conventions',
      type: 'convention',
      evidence_files: ['src/api/users.ts', 'src/lib/redis.ts'],
    });
    expect(preview.candidate_ids).toHaveLength(2);
    expect(preview.body).toContain('## Async & concurrency');
    expect(preview.body).toContain(`- ${RULE_ASYNC} *(confidence 91%)*`);
    expect(preview.body).toContain('<untrusted source="convention-evidence">');
    const skillsBefore = (await app.inject({ method: 'GET', url: '/skills' })).json();

    // A rejected id in candidate_ids is refused.
    await app.inject({
      method: 'PATCH',
      url: `/repos/${repo.id}/conventions/${ids[1]}`,
      payload: { status: 'rejected' },
    });
    const bad = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill/preview`,
      payload: { candidate_ids: ids },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details.candidate_ids).toEqual([ids[1]]);
    expect((await app.inject({ method: 'GET', url: '/skills' })).json()).toHaveLength(skillsBefore.length);

    // Create with an edited body, bound to two agents.
    const agents = (await app.inject({ method: 'GET', url: '/agents' })).json() as { id: string; name: string }[];
    const general = agents.find((a) => a.name === 'General Reviewer')!;
    const security = agents.find((a) => a.name === 'Security Reviewer')!;
    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill`,
      payload: {
        name: 'payments-conventions',
        description: 'House rules',
        body: preview.body + '\n- Edited by hand in the modal.\n',
        agent_ids: [general.id, security.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const { skill_id } = created.json();

    const skill = (await app.inject({ method: 'GET', url: `/skills/${skill_id}` })).json();
    expect(skill).toMatchObject({
      name: 'payments-conventions',
      source: 'extracted',
      type: 'convention',
      enabled: true,
      version: 1,
      evidence_files: ['src/api/users.ts'],
      agent_count: 2,
    });
    expect(skill.body).toContain('- Edited by hand in the modal.');
    const versions = (await app.inject({ method: 'GET', url: `/skills/${skill_id}/versions` })).json();
    expect(versions).toHaveLength(1);

    const links = (await app.inject({ method: 'GET', url: `/agents/${general.id}/skills` })).json() as {
      skill_id: string;
      enabled: boolean;
      order: number;
    }[];
    const link = links.find((l) => l.skill_id === skill_id)!;
    expect(link.enabled).toBe(true);
    expect(link.order).toBe(links.length - 1);

    const [absorbed] = await pg.handle.db.select().from(t.conventions).where(eq(t.conventions.id, ids[0]!));
    expect(absorbed!.skillId).toBe(skill_id);
    // Absorbed candidates are excluded from the next draft.
    const after = (
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/skill/preview`, payload: {} })
    ).json();
    expect(after.candidate_ids).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` })).json().candidates[0].skill_id).toBe(skill_id);

    // The trust rule: an extracted body reaches the model UNWRAPPED, its
    // evidence wrapped; the seeded imported skill stays wrapped whole.
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: '',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    const run = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: general.id } });
    expect(run.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });
    const runId = run.json().runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const skillsBlock: string = trace.prompt_assembly.skills;
    expect(skillsBlock).toContain(`- ${RULE_ASYNC}`);
    expect(skillsBlock).not.toContain(`<untrusted source="skill-${skill_id}">`);
    expect(skillsBlock).toContain('<untrusted source="convention-evidence">');
    expect(trace.prompt_tokens.skills).toBeGreaterThan(0);
    await app.close();
  });

  it('create with no agents is allowed — the skill lands unbound in Skills Lab', async () => {
    const app = await makeApp();
    const repo = await newRepo();
    const page = (
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` })
    ).json();
    for (const c of page.candidates as { id: string }[]) {
      await app.inject({
        method: 'PATCH',
        url: `/repos/${repo.id}/conventions/${c.id}`,
        payload: { status: 'accepted' },
      });
    }
    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill`,
      payload: { name: 'unbound-conventions', agent_ids: [] },
    });
    expect(created.statusCode).toBe(201);
    const { skill_id } = created.json();
    const skill = (await app.inject({ method: 'GET', url: `/skills/${skill_id}` })).json();
    expect(skill).toMatchObject({ name: 'unbound-conventions', source: 'extracted', agent_count: 0 });
    const links = await pg.handle.db.select().from(t.agentSkills).where(eq(t.agentSkills.skillId, skill_id));
    expect(links).toHaveLength(0);
    await app.close();
  });
});
