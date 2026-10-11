import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import {
  EvalCase,
  EvalCaseList,
  EvalCaseRunState,
  EvalDashboard,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

/**
 * Eval case authoring — routes end to end against real Postgres, the model mocked: manual
 * cases, single-case runs (never in suite views), skill suites on a host agent, the two
 * partial unique indexes, the restart sweep and the skill-delete cleanup.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-authoring] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UUID = '00000000-0000-4000-8000-000000000000';

const FILE = 'src/config.ts';
const HEAD = `--- a/${FILE}\n+++ b/${FILE}\n@@ -10,3 +10,4 @@\n   port: 3000,\n`;
/** A single-file diff whose added line is new-side line 11. */
const DIFF = `${HEAD}+  stripeKey: "sk_live_xxx",\n   redisUrl: x,`;
const TARGET = { file: FILE, start_line: 11, end_line: 11 };

/** A diff of exactly `bytes` UTF-8 bytes whose added line is line 11. */
const diffOfBytes = (bytes: number): string => {
  const prefix = `${HEAD}+`;
  return prefix + 'a'.repeat(bytes - Buffer.byteLength(prefix));
};

/** Flags `src/config.ts:11` (grounded in the diff); can be held back behind a gate. */
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

d('Eval case authoring (Testcontainers pg)', () => {
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

  // ---- fixtures ------------------------------------------------------------------------

  const db = () => pg.handle.db;

  async function newAgent(name: string) {
    const [a] = await db()
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: `You review code (${name}).`,
        strategy: 'single-pass',
      })
      .returning();
    return a!;
  }

  async function newSkill(name: string, version = 2) {
    const [s] = await db()
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'd',
        type: 'security',
        source: 'manual',
        body: `Rule of ${name}.`,
        version,
      })
      .returning();
    return s!;
  }

  const link = (agentId: string, skillId: string, order = 0) =>
    db().insert(t.agentSkills).values({ agentId, skillId, order, enabled: true });

  let seq = 0;
  const caseBody = (over: Record<string, unknown> = {}) => ({
    name: `Case ${++seq}`,
    input_diff: DIFF,
    input_meta: { pr_title: 'Harden config', pr_body: 'Moves keys to env.' },
    expectation: 'must_find',
    target: TARGET,
    ...over,
  });

  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
  const get = (url: string) => app.inject({ method: 'GET', url });

  const agentCase = async (agentId: string, over: Record<string, unknown> = {}) => {
    const res = await post(`/agents/${agentId}/eval-cases`, caseBody(over));
    expect(res.statusCode).toBe(201);
    return EvalCase.parse(res.json());
  };
  const skillCase = async (skillId: string, over: Record<string, unknown> = {}) => {
    const res = await post(`/skills/${skillId}/eval-cases`, caseBody(over));
    expect(res.statusCode).toBe(201);
    return EvalCase.parse(res.json());
  };

  async function settle(runId: string) {
    for (let i = 0; i < 200; i++) {
      const res = await get(`/eval-runs/${runId}`);
      const body = res.json();
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

  const runIds = (runs: { id: string }[]) => runs.map((r) => r.id);
  const agentRuns = async (agentId: string) =>
    parseRuns((await get(`/agents/${agentId}/eval-runs`)).json());
  const parseRuns = (body: unknown) => (body as unknown[]).map((r) => EvalSuiteRun.parse(r));

  // ---- manual cases ----------------------------------------------------------------------

  describe('manual cases', () => {
    it('AC-6 / NFR-1: a manual case is stored as entered and the suite run includes it', async () => {
      const agent = await newAgent('Manual agent');
      const before = llm.calls.length;
      const created = await agentCase(agent.id, { name: 'Stripe key in config' });
      expect(created).toMatchObject({
        owner_kind: 'agent',
        owner_id: agent.id,
        source: 'manual',
        source_finding_id: null,
        expectation: 'must_find',
        target: TARGET,
        input_diff: DIFF,
        input_meta: { pr_title: 'Harden config', pr_body: 'Moves keys to env.' },
      });
      expect(created.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(llm.calls.length).toBe(before); // saving makes no model call (NFR-2)

      const list = EvalCaseList.parse((await get(`/agents/${agent.id}/eval-cases`)).json());
      expect(list.total).toBe(1);
      expect(list.cases[0]).toMatchObject({ source: 'manual', last_result: 'never_run', latest_single: null });

      const started = await post(`/agents/${agent.id}/eval-runs`, {});
      expect(started.statusCode).toBe(202);
      const done = await settle(EvalSuiteRun.parse(started.json()).id);
      expect(done.cases_total).toBe(1);
      expect(done.results.map((r) => r.case_id)).toEqual([created.id]);
      expect(done.results[0]!.status).toBe('passed');
    });

    it('EC-2: 65 536 bytes is stored, 65 537 is a 422 naming input_diff', async () => {
      const agent = await newAgent('Size agent');
      const ok = await post(`/agents/${agent.id}/eval-cases`, caseBody({ input_diff: diffOfBytes(65_536) }));
      expect(ok.statusCode).toBe(201);
      const big = await post(`/agents/${agent.id}/eval-cases`, caseBody({ input_diff: diffOfBytes(65_537) }));
      expect(big.statusCode).toBe(422);
      expect(big.json().error.code).toBe('validation_error');
      expect(JSON.stringify(big.json().error.details)).toContain('input_diff');
    });

    it('EC-1: a header-less two-file diff is rejected, and so is a diff with no hunk', async () => {
      const agent = await newAgent('Parse agent');
      const bare2 = `${DIFF}\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,1 +1,2 @@\n x\n+y`;
      const res = await post(`/agents/${agent.id}/eval-cases`, caseBody({ input_diff: bare2 }));
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('eval_case_rejected');
      expect(res.json().error.details).toEqual({ reason: 'diff_needs_git_headers', field: 'input_diff' });

      const noHunk = await post(`/agents/${agent.id}/eval-cases`, caseBody({ input_diff: '--- a/x\n+++ b/x\n' }));
      expect(noHunk.json().error.details).toEqual({ reason: 'diff_unparseable', field: 'input_diff' });
    });

    it('EC-3: a target outside the diff or off the changed lines is rejected', async () => {
      const agent = await newAgent('Target agent');
      const missing = await post(
        `/agents/${agent.id}/eval-cases`,
        caseBody({ target: { file: 'src/other.ts', start_line: 11, end_line: 11 } }),
      );
      expect(missing.json().error.details).toEqual({ reason: 'target_file_not_in_diff', field: 'target.file' });
      const off = await post(
        `/agents/${agent.id}/eval-cases`,
        caseBody({ target: { file: FILE, start_line: 20, end_line: 21 } }),
      );
      expect(off.json().error.details).toEqual({ reason: 'target_outside_changes', field: 'target' });
    });

    it('EC-5: a name clash (trimmed, any case) is a 422 per owner, not across owners', async () => {
      const agent = await newAgent('Name agent');
      const other = await newAgent('Other name agent');
      await agentCase(agent.id, { name: 'Stripe-Key' });
      const dup = await post(`/agents/${agent.id}/eval-cases`, caseBody({ name: '  stripe-key ' }));
      expect(dup.statusCode).toBe(422);
      expect(dup.json().error.details).toEqual({ reason: 'name_taken', field: 'name' });
      expect((await post(`/agents/${other.id}/eval-cases`, caseBody({ name: 'stripe-key' }))).statusCode).toBe(201);
    });

    it('unknown owners are 404', async () => {
      expect((await post(`/agents/${UUID}/eval-cases`, caseBody())).statusCode).toBe(404);
      expect((await post(`/skills/${UUID}/eval-cases`, caseBody())).statusCode).toBe(404);
      expect((await get(`/skills/${UUID}/eval-cases`)).statusCode).toBe(404);
      const put = await app.inject({ method: 'PUT', url: `/eval-cases/${UUID}`, payload: caseBody() });
      expect(put.statusCode).toBe(404);
    });

    it('AC-8: a PUT edits in place with a new fingerprint; a rename alone keeps it', async () => {
      const agent = await newAgent('Edit agent');
      const made = await agentCase(agent.id, { name: 'Before' });

      const renamed = EvalCase.parse(
        (await app.inject({ method: 'PUT', url: `/eval-cases/${made.id}`, payload: caseBody({ name: 'After' }) })).json(),
      );
      expect(renamed.id).toBe(made.id);
      expect(renamed.name).toBe('After');
      expect(renamed.fingerprint).toBe(made.fingerprint);

      const retargeted = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${made.id}`,
        payload: caseBody({ name: 'After', expectation: 'must_not_flag' }),
      });
      expect(retargeted.statusCode).toBe(200);
      const next = EvalCase.parse(retargeted.json());
      expect(next.id).toBe(made.id);
      expect(next.expectation).toBe('must_not_flag');
      expect(next.fingerprint).not.toBe(made.fingerprint);
      expect(next.source).toBe('manual');
    });
  });

  // ---- single-case runs ----------------------------------------------------------------------

  describe('single-case runs', () => {
    it('AC-9 / AC-10: runs one case, and is in no suite view', async () => {
      const agent = await newAgent('Single agent');
      const c = await agentCase(agent.id);
      const before = llm.calls.length;

      const res = await post(`/eval-cases/${c.id}/runs`, {});
      expect(res.statusCode).toBe(202);
      const started = EvalSuiteRun.parse(res.json());
      expect(started).toMatchObject({
        kind: 'single',
        status: 'running',
        owner_kind: 'agent',
        owner_id: agent.id,
        agent_id: agent.id,
        agent_version: 1,
        cases: [{ case_id: c.id, fingerprint: c.fingerprint }],
      });
      const done = await settle(started.id);
      expect(done.status).toBe('completed');
      expect(done.results).toHaveLength(1);
      expect(done.results[0]).toMatchObject({ case_id: c.id, status: 'passed' });
      expect(llm.calls.length - before).toBe(1); // exactly one review call (NFR-2)

      // never in suite metrics, history, trend, Compare, the dashboard or the banner
      expect(await agentRuns(agent.id)).toEqual([]);
      const dash = EvalDashboard.parse((await get(`/agents/${agent.id}/eval-dashboard`)).json());
      expect(dash.current).toBeNull();
      expect(dash.trend).toEqual([]);
      expect(dash.recent_runs).toEqual([]);
      expect(dash.running).toBeNull();
      expect(dash.regressions).toEqual([]);
      expect(dash.alert).toBeNull();
      const ws = EvalDashboard.parse((await get('/eval/dashboard')).json());
      expect(runIds(ws.recent_runs)).not.toContain(started.id);
      const cmp = await get(`/agents/${agent.id}/eval-runs/compare?a=${started.id}&b=${started.id}`);
      expect(cmp.statusCode).toBe(422);

      // the row marker, with the suite result still the main one
      const list = EvalCaseList.parse((await get(`/agents/${agent.id}/eval-cases`)).json());
      expect(list.cases[0]).toMatchObject({ last_result: 'never_run' });
      expect(list.cases[0]!.latest_single).toMatchObject({ run_id: started.id, status: 'passed' });
    });

    it('EC-8: a second start of the same case is 409, a suite of the same agent does not block it', async () => {
      const agent = await newAgent('Conflict agent');
      const c1 = await agentCase(agent.id);
      const c2 = await agentCase(agent.id);
      const release = holdModel();
      try {
        const first = EvalSuiteRun.parse((await post(`/eval-cases/${c1.id}/runs`, {})).json());
        const second = await post(`/eval-cases/${c1.id}/runs`, {});
        expect(second.statusCode).toBe(409);
        expect(second.json().error.code).toBe('eval_case_run_in_progress');
        expect(second.json().error.details).toEqual({ run_id: first.id });

        // while it runs: the editor read shows it as running
        const state = EvalCaseRunState.parse((await get(`/eval-cases/${c1.id}/runs/latest`)).json());
        expect(state.running?.id).toBe(first.id);
        expect(state.latest).toBeNull();

        // another case, and the whole suite, both start
        expect((await post(`/eval-cases/${c2.id}/runs`, {})).statusCode).toBe(202);
        expect((await post(`/agents/${agent.id}/eval-runs`, {})).statusCode).toBe(202);
      } finally {
        release();
      }
      // let everything finish before the next test reuses the gate
      for (let i = 0; i < 100; i++) {
        const rows = await db().select().from(t.evalRuns).where(and(eq(t.evalRuns.agentId, agent.id), eq(t.evalRuns.status, 'running')));
        if (rows.length === 0) break;
        await sleep(50);
      }
    });

    it('EC-8: the database itself refuses two running single runs of one case', async () => {
      const agent = await newAgent('Index agent');
      const c = await agentCase(agent.id);
      const row = {
        workspaceId,
        kind: 'single' as const,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        agentId: agent.id,
        agentVersion: 1,
        provider: 'openai',
        model: 'gpt-4.1',
        status: 'running' as const,
        singleCaseId: c.id,
      };
      await db().insert(t.evalRuns).values(row);
      await expect(db().insert(t.evalRuns).values(row)).rejects.toThrow();
      // a finished run of the same case does not collide
      await expect(db().insert(t.evalRuns).values({ ...row, status: 'completed' })).resolves.toBeDefined();
    });

    it('AC-12: the editor read returns the newest result of either kind', async () => {
      const agent = await newAgent('Latest agent');
      const c = await agentCase(agent.id);
      expect(EvalCaseRunState.parse((await get(`/eval-cases/${c.id}/runs/latest`)).json())).toEqual({
        latest: null,
        running: null,
      });
      expect((await get(`/eval-cases/${UUID}/runs/latest`)).statusCode).toBe(404);

      const suite = await settle(EvalSuiteRun.parse((await post(`/agents/${agent.id}/eval-runs`, {})).json()).id);
      let state = EvalCaseRunState.parse((await get(`/eval-cases/${c.id}/runs/latest`)).json());
      expect(state.latest?.run.id).toBe(suite.id);
      expect(state.latest?.run.kind).toBe('suite');
      expect(state.latest?.result).toMatchObject({ case_id: c.id, status: 'passed' });

      const single = await settle(EvalSuiteRun.parse((await post(`/eval-cases/${c.id}/runs`, {})).json()).id);
      state = EvalCaseRunState.parse((await get(`/eval-cases/${c.id}/runs/latest`)).json());
      expect(state.latest?.run.id).toBe(single.id);
      expect(state.latest?.run.kind).toBe('single');
      expect(state.latest?.run.agent_version).toBe(1);

      // AC-13: the single is newer than the suite, so the row carries the marker
      const list = EvalCaseList.parse((await get(`/agents/${agent.id}/eval-cases`)).json());
      expect(list.cases[0]).toMatchObject({ last_result: 'passed' });
      expect(list.cases[0]!.latest_single?.run_id).toBe(single.id);
    });

    it('a host agent is refused for an agent case and required for a skill case', async () => {
      const agent = await newAgent('Host rule agent');
      const skill = await newSkill('Host rule skill');
      const host = await newAgent('Host rule host');
      await link(host.id, skill.id);
      const ac = await agentCase(agent.id);
      const sc = await skillCase(skill.id);
      const before = llm.calls.length;

      const notAllowed = await post(`/eval-cases/${ac.id}/runs`, { host_agent_id: host.id });
      expect(notAllowed.statusCode).toBe(422);
      expect(notAllowed.json().error).toMatchObject({ code: 'eval_host_invalid', details: { reason: 'host_not_allowed' } });
      const required = await post(`/eval-cases/${sc.id}/runs`, {});
      expect(required.json().error).toMatchObject({ code: 'eval_host_invalid', details: { reason: 'host_required' } });
      expect(llm.calls.length).toBe(before);

      // a skill case on its host: only the skill is enabled, at its current version
      const run = await settle(EvalSuiteRun.parse((await post(`/eval-cases/${sc.id}/runs`, { host_agent_id: host.id })).json()).id);
      expect(run).toMatchObject({ kind: 'single', owner_kind: 'skill', owner_id: skill.id, agent_id: host.id });
      expect(run.skills).toEqual([{ skill_id: skill.id, name: 'Host rule skill', version: 2 }]);
    });

    it('restart: a stale running single row is swept to failed, then a new start is accepted', async () => {
      const agent = await newAgent('Sweep agent');
      const c = await agentCase(agent.id);
      const [orphan] = await db()
        .insert(t.evalRuns)
        .values({
          workspaceId,
          kind: 'single',
          ownerKind: 'agent',
          ownerId: agent.id,
          agentId: agent.id,
          agentVersion: 1,
          provider: 'openai',
          model: 'gpt-4.1',
          status: 'running',
          singleCaseId: c.id,
        })
        .returning();

      const res = await post(`/eval-cases/${c.id}/runs`, {});
      expect(res.statusCode).toBe(202);
      const [swept] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, orphan!.id));
      expect(swept!.status).toBe('failed');
      expect(swept!.error).toMatch(/interrupted/);
      await settle(EvalSuiteRun.parse(res.json()).id);
    });
  });

  // ---- skill runs ------------------------------------------------------------------------------

  describe('skill runs', () => {
    it('AC-15 / AC-16 / NG-2: a skill suite on host H beside H’s own suite, in no agent view', async () => {
      const skill = await newSkill('Secrets skill', 4);
      const other = await newSkill('Host own skill', 1);
      const host = await newAgent('Skill host');
      await link(host.id, other.id, 0);
      await link(host.id, skill.id, 1);
      await agentCase(host.id, { name: 'Host case' });
      const sc = await skillCase(skill.id, { name: 'Skill case' });

      expect(EvalCaseList.parse((await get(`/skills/${skill.id}/eval-cases`)).json()).total).toBe(1);
      expect(EvalCaseList.parse((await get(`/agents/${host.id}/eval-cases`)).json()).total).toBe(1);

      const release = holdModel();
      let hostRun: EvalSuiteRun;
      let skillRun: EvalSuiteRun;
      try {
        hostRun = EvalSuiteRun.parse((await post(`/agents/${host.id}/eval-runs`, {})).json());
        const res = await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: host.id });
        expect(res.statusCode).toBe(202); // does not 409 against the host's own running suite
        skillRun = EvalSuiteRun.parse(res.json());
        expect(skillRun).toMatchObject({
          kind: 'suite',
          owner_kind: 'skill',
          owner_id: skill.id,
          agent_id: host.id,
          cases: [{ case_id: sc.id, fingerprint: sc.fingerprint }],
        });
        // only the skill under test, at its current version
        expect(skillRun.skills).toEqual([{ skill_id: skill.id, name: 'Secrets skill', version: 4 }]);
        expect((await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: host.id })).statusCode).toBe(409);
        // while running, only the skill's own views show it
        const dash = EvalDashboard.parse((await get(`/skills/${skill.id}/eval-dashboard`)).json());
        expect(dash.running?.id).toBe(skillRun.id);
        expect(EvalDashboard.parse((await get(`/agents/${host.id}/eval-dashboard`)).json()).running?.id).toBe(hostRun.id);
      } finally {
        release();
      }
      const doneHost = await settle(hostRun.id);
      const doneSkill = await settle(skillRun.id);
      expect(doneSkill.results.map((r) => r.case_id)).toEqual([sc.id]);
      expect(doneHost.results.map((r) => r.case_id)).not.toContain(sc.id);

      // the skill's own views
      const skillRuns = parseRuns((await get(`/skills/${skill.id}/eval-runs`)).json());
      expect(runIds(skillRuns)).toEqual([skillRun.id]);
      const skillDash = EvalDashboard.parse((await get(`/skills/${skill.id}/eval-dashboard`)).json());
      expect(skillDash).toMatchObject({ owner_kind: 'skill', owner_id: skill.id, owner_name: 'Secrets skill', cases_total: 1 });
      expect(skillDash.current?.recall).toBe(1);
      expect(skillDash.delta.recall).toBeNull(); // no earlier run on this host
      expect(skillDash.trend).toHaveLength(1);
      expect(skillDash.regressions).toEqual([]);

      // never in the host's agent views, nor on /eval
      expect(runIds(await agentRuns(host.id))).toEqual([hostRun.id]);
      const hostDash = EvalDashboard.parse((await get(`/agents/${host.id}/eval-dashboard`)).json());
      expect(runIds(hostDash.recent_runs)).toEqual([hostRun.id]);
      expect(hostDash.trend.map((p) => p.run_id)).toEqual([hostRun.id]);
      expect(hostDash.cases_total).toBe(1);
      const ws = EvalDashboard.parse((await get('/eval/dashboard')).json());
      expect(runIds(ws.recent_runs)).not.toContain(skillRun.id);
      const cmp = await get(`/agents/${host.id}/eval-runs/compare?a=${hostRun.id}&b=${skillRun.id}`);
      expect(cmp.statusCode).toBe(422);

      // a second skill run on the same host: deltas against the first
      const second = await settle(
        EvalSuiteRun.parse((await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: host.id })).json()).id,
      );
      expect(second.status).toBe('completed');
      const skillDash2 = EvalDashboard.parse((await get(`/skills/${skill.id}/eval-dashboard`)).json());
      expect(skillDash2.delta.recall).toBe(0);
      expect(skillDash2.trend).toHaveLength(2);
    });

    it('EC-11: an unlinked host is 422, a deleted host 404, an empty set 422 — no review call', async () => {
      const skill = await newSkill('Guarded skill');
      const linked = await newAgent('Guarded linked');
      const unlinked = await newAgent('Guarded unlinked');
      await link(linked.id, skill.id);
      const before = llm.calls.length;

      const empty = await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: linked.id });
      expect(empty.statusCode).toBe(422);
      expect(empty.json().error.code).toBe('eval_set_empty');

      const sc = await skillCase(skill.id);
      const notLinked = await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: unlinked.id });
      expect(notLinked.statusCode).toBe(422);
      expect(notLinked.json().error).toMatchObject({
        code: 'eval_host_invalid',
        details: { reason: 'host_not_linked', host_agent_id: unlinked.id },
      });
      const caseNotLinked = await post(`/eval-cases/${sc.id}/runs`, { host_agent_id: unlinked.id });
      expect(caseNotLinked.statusCode).toBe(422);

      const gone = await newAgent('Guarded gone');
      await link(gone.id, skill.id);
      await db().delete(t.agents).where(eq(t.agents.id, gone.id));
      expect((await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: gone.id })).statusCode).toBe(404);
      expect((await post(`/skills/${UUID}/eval-runs`, { host_agent_id: linked.id })).statusCode).toBe(404);
      expect((await get(`/skills/${UUID}/eval-dashboard`)).statusCode).toBe(404);
      expect((await get(`/skills/${UUID}/eval-runs`)).statusCode).toBe(404);
      expect(llm.calls.length).toBe(before);
    });

    it('Rec. 5: deleting a skill removes its cases and its runs', async () => {
      const skill = await newSkill('Doomed skill');
      const host = await newAgent('Doomed host');
      await link(host.id, skill.id);
      const sc = await skillCase(skill.id);
      const run = await settle(
        EvalSuiteRun.parse((await post(`/skills/${skill.id}/eval-runs`, { host_agent_id: host.id })).json()).id,
      );
      const single = await settle(
        EvalSuiteRun.parse((await post(`/eval-cases/${sc.id}/runs`, { host_agent_id: host.id })).json()).id,
      );
      expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.ownerId, skill.id))).toHaveLength(2);

      const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
      expect(del.statusCode).toBe(200);
      expect(await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, skill.id))).toEqual([]);
      expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.ownerId, skill.id))).toEqual([]);
      expect(await db().select().from(t.evalRunCases).where(eq(t.evalRunCases.runId, run.id))).toEqual([]);
      expect((await get(`/eval-runs/${single.id}`)).statusCode).toBe(404);
      // the host agent and its own data are untouched
      expect(await db().select().from(t.agents).where(eq(t.agents.id, host.id))).toHaveLength(1);
    });
  });
});
