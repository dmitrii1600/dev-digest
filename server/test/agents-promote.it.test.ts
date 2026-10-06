import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import {
  Agent,
  AgentSkillLink,
  AgentVersion,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

/**
 * POST /agents/:id/promote against real Postgres, the model mocked: the restore as a new
 * version (AC-3), history untouched (AC-4 / NFR-3), a deleted skill (EC-2), the stale-version
 * 409 (EC-4), a double submit (EC-6), a run in flight (EC-7), agent-owned run lookup, no model
 * call (NFR-1) and the log line (NFR-7).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-promote] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FILE = 'src/config.ts';
const DIFF = `--- a/${FILE}\n+++ b/${FILE}\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,`;
const TARGET = { file: FILE, start_line: 11, end_line: 11 };

/** Flags `src/config.ts:11`; can be held back behind a gate. */
class EvalLlm extends MockLLMProvider {
  gate: Promise<void> | null = null;
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.gate) await this.gate;
    const data = {
      verdict: 'comment',
      summary: 'one issue',
      score: 70,
      findings: [
        {
          id: 'f1',
          severity: 'WARNING',
          category: 'security',
          title: 'Hardcoded key',
          file: FILE,
          start_line: 11,
          end_line: 11,
          rationale: 'A live key is committed.',
          confidence: 0.9,
        },
      ],
    };
    return {
      data: (req.schema as { parse: (x: unknown) => T }).parse(data),
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(data),
      attempts: 1,
    };
  }
}

d('Agent promotion (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const llm = new EvalLlm('openai');
  const intentStub: IntentPort = {
    get: async () => null,
    ensure: async () => null,
    derive: async () => {
      throw new Error('an eval run never derives an intent');
    },
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient(),
        embedder: new MockEmbedder(),
        intent: intentStub,
        llm: { openai: llm },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const db = () => pg.handle.db;
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
  const get = (url: string) => app.inject({ method: 'GET', url });
  const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object });

  let seq = 0;
  async function newSkill(name: string, version = 1) {
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId, name, description: 'd', type: 'security', source: 'manual', body: `Rule of ${name}.`, version })
      .returning();
    return s!;
  }
  const linkEnabled = (agentId: string, skillId: string, order: number) =>
    db().insert(t.agentSkills).values({ agentId, skillId, order, enabled: true });

  async function settle(runId: string) {
    for (let i = 0; i < 200; i++) {
      const body = (await get(`/eval-runs/${runId}`)).json();
      if (body.status !== 'running') return EvalSuiteRunDetail.parse(body);
      await sleep(50);
    }
    throw new Error('eval run did not finish in 10 s');
  }
  const holdModel = () => {
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    return () => {
      llm.gate = null;
      release();
    };
  };

  /**
   * An agent whose v1 had skills [s1, s2] and a finished suite run, then edited to v2 (new
   * model and prompt) with s2 swapped for s3 — so promoting that run changes fields AND links.
   */
  async function history() {
    const n = ++seq;
    const created = Agent.parse(
      (await post('/agents', { name: `Promote agent ${n}`, provider: 'openai', model: 'gpt-4.1', system_prompt: `v1 prompt ${n}` })).json(),
    );
    const s1 = await newSkill(`S1-${n}`);
    const s2 = await newSkill(`S2-${n}`);
    const s3 = await newSkill(`S3-${n}`);
    await linkEnabled(created.id, s1.id, 0);
    await linkEnabled(created.id, s2.id, 1);
    const c = await post(`/agents/${created.id}/eval-cases`, {
      name: 'Stripe key',
      input_diff: DIFF,
      input_meta: { pr_title: 'Harden config', pr_body: '' },
      expectation: 'must_find',
      target: TARGET,
    });
    expect(c.statusCode).toBe(201);
    const started = EvalSuiteRun.parse((await post(`/agents/${created.id}/eval-runs`, {})).json());
    const run = await settle(started.id);
    expect(run.agent_version).toBe(1);
    expect(run.skills.map((s) => s.skill_id)).toEqual([s1.id, s2.id]);

    const edited = Agent.parse(
      (await put(`/agents/${created.id}`, { model: 'gpt-4.1-mini', system_prompt: `v2 prompt ${n}`, strategy: 'map-reduce' })).json(),
    );
    expect(edited.version).toBe(2);
    await db().delete(t.agentSkills).where(and(eq(t.agentSkills.agentId, created.id), eq(t.agentSkills.skillId, s2.id)));
    await linkEnabled(created.id, s3.id, 1);
    return { agent: edited, run, s1, s2, s3 };
  }

  const promote = (agentId: string, body: Record<string, unknown>) => post(`/agents/${agentId}/promote`, body);
  const versionRows = (agentId: string) =>
    db().select().from(t.agentVersions).where(eq(t.agentVersions.agentId, agentId)).orderBy(asc(t.agentVersions.version));
  const links = async (agentId: string) => AgentSkillLink.array().parse((await get(`/agents/${agentId}/skills`)).json());

  it('AC-3: restores the run’s configuration and skill set as version current + 1', async () => {
    const { agent, run, s1, s2, s3 } = await history();
    const v1 = AgentVersion.parse((await get(`/agents/${agent.id}/versions/1`)).json());

    const res = await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 2 });
    expect(res.statusCode).toBe(200);
    const promoted = Agent.parse(res.json());
    expect(promoted.version).toBe(3);
    expect(promoted).toMatchObject({
      provider: v1.config.provider,
      model: v1.config.model,
      system_prompt: v1.config.system_prompt,
      strategy: v1.config.strategy,
      ci_fail_on: v1.config.ci_fail_on,
      repo_intel: v1.config.repo_intel,
      name: agent.name,
      enabled: agent.enabled,
    });
    expect(await get(`/agents/${agent.id}`).then((r) => Agent.parse(r.json()))).toEqual(promoted);

    // the run's skills, enabled and in the run's order; the skill linked since is kept, disabled, after
    const l = await links(agent.id);
    expect(l.filter((x) => x.enabled).map((x) => x.skill_id)).toEqual([s1.id, s2.id]);
    expect(l.map((x) => [x.skill_id, x.enabled])).toEqual([
      [s1.id, true],
      [s2.id, true],
      [s3.id, false],
    ]);
  });

  it('AC-4 / NFR-3: earlier versions and the eval run are untouched; the new row names its source', async () => {
    const { agent, run } = await history();
    const beforeVersions = await versionRows(agent.id);
    const beforeRun = (await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, run.id)))[0];

    expect((await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 2 })).statusCode).toBe(200);

    const after = await versionRows(agent.id);
    expect(after).toHaveLength(beforeVersions.length + 1);
    expect(after.slice(0, beforeVersions.length)).toEqual(beforeVersions);
    expect(after.at(-1)).toMatchObject({
      version: 3,
      origin: { kind: 'promotion', from_version: 1, eval_run_id: run.id, missing_skills: [] },
    });
    expect((await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, run.id)))[0]).toEqual(beforeRun);

    // the history endpoint exposes it, and an ordinary edit has none
    const versions = AgentVersion.array().parse((await get(`/agents/${agent.id}/versions`)).json());
    expect(versions.find((v) => v.version === 3)!.origin).toMatchObject({ kind: 'promotion', from_version: 1 });
    expect(versions.find((v) => v.version === 2)!.origin ?? null).toBeNull();
  });

  it('EC-2: a skill deleted since is not re-linked and is named in the origin', async () => {
    const { agent, run, s1, s2 } = await history();
    await db().delete(t.skills).where(eq(t.skills.id, s2.id));

    const res = await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 2 });
    expect(res.statusCode).toBe(200);
    expect((await links(agent.id)).filter((x) => x.enabled).map((x) => x.skill_id)).toEqual([s1.id]);
    const row = (await versionRows(agent.id)).at(-1)!;
    expect(row.origin).toMatchObject({ missing_skills: [{ skill_id: s2.id, name: s2.name }] });
  });

  it('EC-4: a stale expected_version is a 409 and nothing changes', async () => {
    const { agent, run } = await history();
    const beforeAgent = (await db().select().from(t.agents).where(eq(t.agents.id, agent.id)))[0];
    const beforeLinks = await links(agent.id);
    const beforeVersions = await versionRows(agent.id);

    const res = await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('agent_version_conflict');
    expect(res.json().error.details).toEqual({ current_version: 2 });

    expect((await db().select().from(t.agents).where(eq(t.agents.id, agent.id)))[0]).toEqual(beforeAgent);
    expect(await links(agent.id)).toEqual(beforeLinks);
    expect(await versionRows(agent.id)).toEqual(beforeVersions);
  });

  it('EC-6: two concurrent identical promotions record exactly one new version', async () => {
    const { agent, run } = await history();
    const body = { from_version: 1, eval_run_id: run.id, expected_version: 2 };
    const [a, b] = await Promise.all([promote(agent.id, body), promote(agent.id, body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((a.statusCode === 409 ? a : b).json().error.code).toBe('agent_version_conflict');
    expect((await versionRows(agent.id)).map((v) => v.version)).toEqual([1, 2, 3]);
    expect(Agent.parse((await get(`/agents/${agent.id}`)).json()).version).toBe(3);
  });

  it('EC-7: a run in flight stays recorded against the version it started with', async () => {
    const { agent, run } = await history();
    const release = holdModel();
    let inflight: string;
    try {
      const started = EvalSuiteRun.parse((await post(`/agents/${agent.id}/eval-runs`, {})).json());
      inflight = started.id;
      expect(started.agent_version).toBe(2);
      const res = await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 2 });
      expect(res.statusCode).toBe(200);
    } finally {
      release();
    }
    const done = await settle(inflight);
    expect(done.agent_version).toBe(2);
    expect(Agent.parse((await get(`/agents/${agent.id}`)).json()).version).toBe(3);
  });

  it('a run of another agent, of another workspace, or a skill run hosted on this agent is a 404', async () => {
    const { agent, s1 } = await history();
    const other = await history();

    // another agent's run
    const otherAgent = await promote(agent.id, { from_version: 1, eval_run_id: other.run.id, expected_version: 2 });
    expect(otherAgent.statusCode).toBe(404);

    // a run of another workspace (same version number, so only the workspace scope can refuse it)
    const [ws2] = await db().insert(t.workspaces).values({ name: 'Other workspace' }).returning();
    const [foreign] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId: ws2!.id,
        ownerKind: 'agent',
        ownerId: agent.id,
        agentId: agent.id,
        agentVersion: 1,
        provider: 'openai',
        model: 'gpt-4.1',
        status: 'completed',
      })
      .returning();
    expect((await promote(agent.id, { from_version: 1, eval_run_id: foreign!.id, expected_version: 2 })).statusCode).toBe(404);

    // a skill suite hosted on this agent: `agent_id` is this agent, but the owner is the skill
    const [skillRun] = await db()
      .insert(t.evalRuns)
      .values({
        workspaceId,
        kind: 'suite',
        ownerKind: 'skill',
        ownerId: s1.id,
        agentId: agent.id,
        agentVersion: 1,
        provider: 'openai',
        model: 'gpt-4.1',
        status: 'completed',
        skills: [{ skill_id: s1.id, name: s1.name, version: 1 }],
      })
      .returning();
    const hosted = await promote(agent.id, { from_version: 1, eval_run_id: skillRun!.id, expected_version: 2 });
    expect(hosted.statusCode).toBe(404);

    expect(await versionRows(agent.id).then((v) => v.map((r) => r.version))).toEqual([1, 2]);
    expect(Agent.parse((await get(`/agents/${agent.id}`)).json()).version).toBe(2);
  });

  it('an unknown agent is a 404', async () => {
    const { run } = await history();
    const res = await promote('00000000-0000-4000-8000-000000000000', { from_version: 1, eval_run_id: run.id, expected_version: 2 });
    expect(res.statusCode).toBe(404);
  });

  it('a from_version that is not the run’s version is a 422 promotion_invalid', async () => {
    const { agent, run } = await history();
    const res = await promote(agent.id, { from_version: 2, eval_run_id: run.id, expected_version: 2 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('promotion_invalid');
    expect(res.json().error.details).toEqual({ field: 'from_version' });
    expect(Agent.parse((await get(`/agents/${agent.id}`)).json()).version).toBe(2);
  });

  it('a snapshot that cannot be read is a 422 agent_version_unreadable and nothing changes', async () => {
    const { agent, run } = await history();
    await db()
      .update(t.agentVersions)
      .set({ configJson: { nonsense: true } })
      .where(and(eq(t.agentVersions.agentId, agent.id), eq(t.agentVersions.version, 1)));
    const res = await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 2 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('agent_version_unreadable');
    expect(Agent.parse((await get(`/agents/${agent.id}`)).json()).version).toBe(2);
  });

  it('NFR-1 / NFR-7: a promotion makes no model call and logs agent, versions and source run', async () => {
    const { agent, run, s2 } = await history();
    await db().delete(t.skills).where(eq(t.skills.id, s2.id));
    const spy = vi.spyOn(app.container.log, 'info');
    const before = llm.calls.length;
    try {
      expect((await promote(agent.id, { from_version: 1, eval_run_id: run.id, expected_version: 2 })).statusCode).toBe(200);
      expect(llm.calls.length).toBe(before);
      const line = spy.mock.calls.find((c) => c[1] === 'agent promoted');
      expect(line?.[0]).toMatchObject({
        agentId: agent.id,
        fromVersion: 1,
        newVersion: 3,
        evalRunId: run.id,
        missingSkills: [{ skill_id: s2.id, name: s2.name }],
      });
    } finally {
      spy.mockRestore();
    }
  });
});
