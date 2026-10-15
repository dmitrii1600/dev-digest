import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
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
import { Agent, CiExport, CiPreview, CiRun, AgentCi, type WorkflowRunMeta } from '@devdigest/shared';
import type { RunnerBundleSource } from '../src/modules/ci/types.js';

/**
 * Export-to-CI against real Postgres, GitHub and the LLM mocked: the PR and zip install,
 * `.gitattributes`, EC-1/2/3, update, verified pull ingest, idempotent refresh, filters and
 * the no-secret / no-LLM guarantees.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const OR_SECRET = 'sk-or-SENTINEL';
const GH_SECRET = 'ghp_SENTINEL';
const SHA = 'f'.repeat(64);
const bundle: RunnerBundleSource = {
  read: async () => ({
    files: [
      { name: 'index.js', contents: 'console.log("runner")' },
      { name: 'package.json', contents: '{"type":"commonjs"}' },
    ],
    sha256: SHA,
  }),
};
const ARTIFACT = {
  findings_count: 3,
  critical: 1,
  warning: 2,
  suggestion: 0,
  cost_usd: 0.01,
  duration_ms: 4200,
  agent: 'CI agent',
  pr_number: 7,
};
const WORKFLOW = '.github/workflows/devdigest-review.yml';

function runMeta(over: Partial<WorkflowRunMeta>): WorkflowRunMeta {
  return {
    id: 1,
    head_sha: 'c0ffee',
    repository_id: 4242,
    path: WORKFLOW,
    html_url: 'https://github.com/acme/ci-app/actions/runs/1',
    conclusion: 'success',
    display_title: 'Fix the thing',
    updated_at: '2026-10-11T10:00:00Z',
    pull_requests: [7],
    ...over,
  };
}

d('Export to CI (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const llm = new MockLLMProvider('openai');
  const REPO = 'acme/ci-app';

  const db = () => pg.handle.db;
  const makeApp = (gh: MockGitHubClient) =>
    buildApp({
      config: config(),
      db: db(),
      overrides: {
        git: new MockGitClient({ diff: '' }),
        github: gh,
        embedder: new MockEmbedder(),
        llm: { openai: llm },
        runnerBundle: bundle,
        secrets: new MockSecretsProvider({ OPENROUTER_API_KEY: OR_SECRET, GITHUB_TOKEN: GH_SECRET }),
      },
    });
  type App = Awaited<ReturnType<typeof makeApp>>;
  const post = (app: App, url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, payload: payload as object });
  const get = (app: App, url: string) => app.inject({ method: 'GET', url });

  let seq = 0;
  async function newAgent(app: App, extra: Record<string, unknown> = {}) {
    const n = ++seq;
    const res = await post(app, '/agents', {
      name: `CI agent ${n}`,
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: `Review carefully ${n}.`,
      ...extra,
    });
    expect(res.statusCode).toBeLessThan(300);
    return Agent.parse(res.json());
  }
  async function newRepo(fullName: string) {
    const [owner = '', name = ''] = fullName.split('/');
    const [r] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner, name, fullName, defaultBranch: 'trunk' })
      .returning();
    return r!;
  }
  async function newSkill(agentId: string, name: string) {
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId, name, description: 'd', type: 'security', source: 'manual', body: `Rule of ${name}.`, version: 1 })
      .returning();
    await db().insert(t.agentSkills).values({ agentId, skillId: s!.id, order: 0, enabled: true });
    return s!;
  }
  const exportBody = (over: Record<string, unknown> = {}) => ({ repo: REPO, ...over });

  beforeAll(async () => {
    pg = await startPg();
    await seed(db());
    const [ws] = await db().select().from(t.workspaces);
    workspaceId = ws!.id;
    await newRepo(REPO);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-8 / EC-3 / AC-9 / AC-10 / EC-2: install, reinstall, zip, update and a taken repo', async () => {
    const gh = new MockGitHubClient();
    const app = await makeApp(gh);
    try {
      const agent = await newAgent(app);
      await newSkill(agent.id, 'Sec Rules');

      const edited = 'name: edited\non:\n  pull_request:\n    types: [opened]\n';
      const res = await post(app, `/agents/${agent.id}/export-ci`, exportBody({ workflow_yaml: edited }));
      expect(res.statusCode).toBe(200);
      const out = CiExport.parse(res.json());
      expect(gh.committed).toHaveLength(1);
      const commit = gh.committed[0]!;
      expect(commit.branch).toBe('devdigest/ci');
      expect(commit.base).toBe('trunk');
      const paths = commit.files.map((f) => f.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^\.devdigest\/agents\/.+\.yaml$/),
          '.devdigest/skills/sec-rules.md',
          '.devdigest/memory.jsonl',
          '.devdigest/runner/index.js',
          '.devdigest/runner/package.json',
          '.gitattributes',
          WORKFLOW,
        ]),
      );
      expect(commit.files.find((f) => f.path === '.gitattributes')!.contents).toBe(
        '.devdigest/runner/** linguist-generated=true\n',
      );
      expect(commit.files.find((f) => f.path === WORKFLOW)!.contents).toBe(edited);
      expect(gh.openedPrs[0]!.title).toBe('Add DevDigest CI review');
      expect(out.pr_url).toBeTruthy();

      const [inst] = await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id));
      expect(inst!.agentVersion).toBe(agent.version);
      expect(inst!.githubRepoId).toBe(4242);
      expect(inst!.exportMeta).toMatchObject({ model: 'gpt-4.1', runner_sha256: SHA });

      // EC-3: same agent, same repo → one PR, one installation.
      expect((await post(app, `/agents/${agent.id}/export-ci`, exportBody())).statusCode).toBe(200);
      expect(gh.openedPrs).toHaveLength(1);
      expect(await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id))).toHaveLength(1);

      // EC-2: another agent is refused.
      const other = await newAgent(app);
      const taken = await post(app, `/agents/${other.id}/export-ci`, exportBody());
      expect(taken.statusCode).toBe(409);
      expect(JSON.stringify(taken.json())).toContain(agent.name);

      // AC-10: change the model, update.
      const upd = await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { model: 'gpt-4.1-mini' } });
      expect(upd.statusCode).toBe(200);
      const next = Agent.parse(upd.json());
      const before = gh.committed.length;
      const up = await post(app, `/agents/${agent.id}/ci/update`, {});
      expect(up.statusCode).toBe(200);
      expect(up.json().results[0]).toMatchObject({ repo: REPO, error: null });
      expect(gh.committed.length).toBe(before + 1);
      const [after] = await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id));
      expect(after!.agentVersion).toBe(next.version);
      expect(after!.exportMeta).toMatchObject({ model: 'gpt-4.1-mini' });
      expect(llm.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('R41: an existing .gitattributes is never committed over', async () => {
    const gh = new MockGitHubClient({ existingPaths: ['.gitattributes'] });
    const app = await makeApp(gh);
    try {
      await newRepo('acme/has-attrs');
      const agent = await newAgent(app);
      const res = await post(app, `/agents/${agent.id}/export-ci`, exportBody({ repo: 'acme/has-attrs' }));
      expect(res.statusCode).toBe(200);
      expect(gh.committed[0]!.files.some((f) => f.path.endsWith('.gitattributes'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('EC-1: a refused commit is a 502 with GitHub\'s message and no installation', async () => {
    const app = await makeApp(new MockGitHubClient({ commitError: 'Resource not accessible by integration' }));
    try {
      await newRepo('acme/refused');
      const agent = await newAgent(app);
      const res = await post(app, `/agents/${agent.id}/export-ci`, exportBody({ repo: 'acme/refused' }));
      expect(res.statusCode).toBe(502);
      expect(JSON.stringify(res.json())).toContain('Resource not accessible by integration');
      expect(await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id))).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('AC-9: the zip holds exactly the previewed paths, writes nothing to GitHub, records one installation', async () => {
    const gh = new MockGitHubClient();
    const app = await makeApp(gh);
    try {
      await newRepo('acme/zipped');
      const agent = await newAgent(app);
      await newSkill(agent.id, 'Zip Rule');
      const q = 'repo=acme%2Fzipped&post_as=github_review&triggers=opened,synchronize';
      const pv = await get(app, `/agents/${agent.id}/export-ci/preview?${q}`);
      expect(pv.statusCode).toBe(200);
      const preview = CiPreview.parse(pv.json());
      const res = await post(app, `/agents/${agent.id}/export-ci`, exportBody({ repo: 'acme/zipped', action: 'files' }));
      expect(res.statusCode).toBe(200);
      const out = CiExport.parse(res.json());
      const entries = unzipSync(Buffer.from(out.zip_base64!, 'base64'));
      expect(Object.keys(entries).sort()).toEqual(preview.files.map((f) => f.path).sort());
      expect(Object.keys(entries)).toContain('.gitattributes');
      expect(gh.committed).toHaveLength(0);
      expect(await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, agent.id))).toHaveLength(1);
      // 422 on a bad querystring
      expect((await get(app, `/agents/${agent.id}/export-ci/preview?repo=nope`)).statusCode).toBe(422);
      expect(
        (await get(app, `/agents/${agent.id}/export-ci/preview?repo=acme%2Fzipped&triggers=pull_request_target`)).statusCode,
      ).toBe(422);
    } finally {
      await app.close();
    }
  });

  it('AC-11 / AC-12 / EC-6 / EC-7 / EC-8: verified ingest, stored once', async () => {
    const REPO_NAME = 'acme/ingest';
    const gh = new MockGitHubClient({
      workflowRuns: [
        runMeta({ id: 101, html_url: 'https://github.com/acme/ingest/actions/runs/101' }),
        runMeta({ id: 102, repository_id: 999, html_url: 'https://github.com/acme/ingest/actions/runs/102' }),
        runMeta({ id: 103, html_url: 'https://github.com/acme/ingest/actions/runs/103' }),
        runMeta({ id: 104, conclusion: 'skipped' }),
      ],
      artifacts: {
        101: { kind: 'ok', text: JSON.stringify(ARTIFACT) },
        102: { kind: 'ok', text: JSON.stringify(ARTIFACT) },
        103: { kind: 'missing' },
      },
    });
    const app = await makeApp(gh);
    try {
      await newRepo(REPO_NAME);
      const agent = await newAgent(app, { ci_fail_on: 'critical' });
      const skill = await newSkill(agent.id, 'Ingest Skill');
      expect((await post(app, `/agents/${agent.id}/export-ci`, exportBody({ repo: REPO_NAME }))).statusCode).toBe(200);

      const r1 = await post(app, '/ci/runs/refresh', { agent_id: agent.id });
      expect(r1.statusCode).toBe(200);
      expect(r1.json().ingested).toBe(3);

      const rows = await db().select().from(t.ciRuns);
      const byRun = (id: number) => rows.find((r) => r.githubRunId === id);
      const ok = byRun(101)!;
      expect(ok).toMatchObject({
        headSha: 'c0ffee',
        prNumber: 7,
        prTitle: 'Fix the thing',
        critical: 1,
        warning: 2,
        suggestion: 0,
        findingsCount: 3,
        githubUrl: 'https://github.com/acme/ingest/actions/runs/101',
      });
      const [run] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, ok.agentRunId!));
      expect(run).toMatchObject({ source: 'ci', prId: null, model: 'gpt-4.1', durationMs: 4200, findingsCount: 3, blockers: 1 });
      const [trace] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, run!.id));
      const log = (trace!.trace as { log: { msg: string }[] }).log.map((l) => l.msg);
      expect(log).toEqual(
        expect.arrayContaining([
          'commit c0ffee',
          expect.stringMatching(/^manifest version \d+$/),
          `runner sha256 ${SHA}`,
          expect.stringContaining('ingest-skill'),
        ]),
      );
      void skill;

      // EC-6: wrong repository id → failed / result_rejected, no counts or cost.
      const rejected = byRun(102)!;
      expect(rejected).toMatchObject({ status: 'failed', critical: null, findingsCount: null, costUsd: null });
      const [rejRun] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, rejected.agentRunId!));
      expect(rejRun).toMatchObject({ status: 'failed', error: 'result_rejected', prId: null });

      // EC-7: no artifact → failed / no_result with its job link.
      const none = byRun(103)!;
      expect(none.githubUrl).toBe('https://github.com/acme/ingest/actions/runs/103');
      const [noneRun] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, none.agentRunId!));
      expect(noneRun).toMatchObject({ status: 'failed', error: 'no_result' });
      expect(byRun(104)).toBeUndefined();

      // EC-8: a second refresh stores nothing new.
      const countBefore = (await db().select().from(t.ciRuns)).length;
      const r2 = await post(app, '/ci/runs/refresh', {});
      expect(r2.json().ingested).toBe(0);
      expect((await db().select().from(t.ciRuns)).length).toBe(countBefore);

      // GET filters, newest first.
      const list = await get(app, `/ci/runs?agent_id=${agent.id}`);
      expect(list.statusCode).toBe(200);
      const runs = (list.json() as unknown[]).map((r) => CiRun.parse(r));
      expect(runs).toHaveLength(3);
      const times = runs.map((r) => Date.parse(r.ran_at!));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(runs.find((r) => r.failure_reason === 'no_result')).toBeTruthy();
      expect((await get(app, '/ci/runs?repo_id=not-a-uuid')).statusCode).toBe(422);
      const agentCi = AgentCi.parse((await get(app, `/agents/${agent.id}/ci`)).json());
      expect(agentCi.runs).toHaveLength(3);

      // NFR-1: no secret anywhere we store or return.
      const dump = JSON.stringify([
        list.json(),
        await db().select().from(t.ciInstallations),
        await db().select().from(t.ciRuns),
        await db().select().from(t.agentRuns),
        await db().select().from(t.runTraces),
        gh.committed,
      ]);
      expect(dump).not.toContain(OR_SECRET);
      expect(dump).not.toContain(GH_SECRET);
      // NFR-2
      expect(llm.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('NFR-1: no response or zip entry carries a secret', async () => {
    const app = await makeApp(new MockGitHubClient());
    try {
      await newRepo('acme/clean');
      const agent = await newAgent(app);
      const res = await post(app, `/agents/${agent.id}/export-ci`, exportBody({ repo: 'acme/clean', action: 'files' }));
      const out = CiExport.parse(res.json());
      const text = Object.values(unzipSync(Buffer.from(out.zip_base64!, 'base64'))).map((u) => strFromU8(u)).join('\n');
      expect(res.body + text).not.toContain(OR_SECRET);
      expect(res.body + text).not.toContain(GH_SECRET);
    } finally {
      await app.close();
    }
  });
});
