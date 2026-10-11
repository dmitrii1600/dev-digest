import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { StructuredOutputError } from '../src/platform/errors.js';
import {
  EvalCase,
  EvalCaseCreateResult,
  EvalCaseRunState,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

/**
 * Eval case authoring — the edges the main file (`evals-authoring.it.test.ts`) leaves open,
 * against real Postgres with the model mocked. Integration lane because each one lives in
 * SQL or wiring, not in the service:
 *   - workspace isolation of every new route (spec "Untrusted inputs": 404 for foreign ids);
 *   - editing a case MADE FROM A FINDING through PUT keeps its provenance (EC-12, AC-8);
 *   - deleting a case that has single-run history keeps the run rows (FK set null);
 *   - a single run whose review call fails is recorded as errored (EC-9) and frees the
 *     per-case running slot, so the case can be run again.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-authoring-edges] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FILE = 'src/config.ts';
const HEAD = `--- a/${FILE}\n+++ b/${FILE}\n@@ -10,3 +10,4 @@\n   port: 3000,\n`;
/** A single-file diff whose added line is new-side line 11. */
const DIFF = `${HEAD}+  stripeKey: "sk_live_xxx",\n   redisUrl: x,`;
const TARGET = { file: FILE, start_line: 11, end_line: 11 };
/** One hunk at new-side lines 10-13 (the PR file patch a finding is frozen from). */
const SMALL_PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

/** Flags `src/config.ts:11`; a PR title containing "Poison" makes the model call fail. */
class EdgeLlm extends MockLLMProvider {
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    const text = req.messages.map((m) => m.content).join('\n');
    if (text.includes('Poison')) throw new StructuredOutputError('model output did not match the schema');
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

d('Eval case authoring — edges (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prSeq = 9000;
  const llm = new EdgeLlm('openai');
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
    const [repo] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
    repoId = repo!.id;
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

  async function newAgent(name: string, wsId = workspaceId) {
    const [a] = await db()
      .insert(t.agents)
      .values({
        workspaceId: wsId,
        name,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: `You review code (${name}).`,
        strategy: 'single-pass',
      })
      .returning();
    return a!;
  }

  async function newSkill(name: string, wsId = workspaceId) {
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId: wsId, name, description: 'd', type: 'security', source: 'manual', body: `Rule of ${name}.`, version: 1 })
      .returning();
    return s!;
  }

  let seq = 0;
  const caseBody = (over: Record<string, unknown> = {}) => ({
    name: `Edge case ${++seq}`,
    input_diff: DIFF,
    input_meta: { pr_title: 'Harden config', pr_body: 'Moves keys to env.' },
    expectation: 'must_find',
    target: TARGET,
    ...over,
  });

  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
  const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object });
  const get = (url: string) => app.inject({ method: 'GET', url });

  async function agentCase(agentId: string, over: Record<string, unknown> = {}) {
    const res = await post(`/agents/${agentId}/eval-cases`, caseBody(over));
    expect(res.statusCode).toBe(201);
    return EvalCase.parse(res.json());
  }

  async function settle(runId: string) {
    for (let i = 0; i < 200; i++) {
      const body = (await get(`/eval-runs/${runId}`)).json();
      if (body.status !== 'running') return EvalSuiteRunDetail.parse(body);
      await sleep(50);
    }
    throw new Error('eval run did not finish in 10 s');
  }

  async function findingMadeCase(agentId: string, title: string) {
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: prSeq++,
        title: 'Harden config',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        body: 'Moves keys to env.',
      })
      .returning();
    await db().insert(t.prFiles).values({ prId: pr!.id, path: FILE, additions: 1, deletions: 0, patch: SMALL_PATCH });
    const [review] = await db()
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId, kind: 'review', verdict: 'comment', summary: 's', score: 70, model: 'm' })
      .returning();
    const [finding] = await db()
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: FILE,
        startLine: 11,
        endLine: 11,
        severity: 'WARNING',
        category: 'security',
        title,
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();
    const res = await post(`/findings/${finding!.id}/eval-case`, {});
    expect(res.statusCode).toBe(201);
    return { finding: finding!, made: EvalCaseCreateResult.parse(res.json()).case };
  }

  // ---- workspace isolation ------------------------------------------------------------------

  it('every new route answers 404 for an agent, skill, case or host of another workspace — and changes nothing', async () => {
    const [ws2] = await db().insert(t.workspaces).values({ name: 'Edge foreign workspace' }).returning();
    const foreignAgent = await newAgent('Foreign agent', ws2!.id);
    const foreignSkill = await newSkill('Foreign skill', ws2!.id);
    const [foreignCase] = await db()
      .insert(t.evalCases)
      .values({
        workspaceId: ws2!.id,
        ownerKind: 'agent',
        ownerId: foreignAgent.id,
        name: 'Foreign case',
        inputDiff: DIFF,
        inputMeta: { pr_title: 'Foreign', pr_body: '' },
        expectedOutput: { title: null, severity: null, category: null },
        source: 'manual',
        expectation: 'must_find',
        targetFile: FILE,
        targetStartLine: 11,
        targetEndLine: 11,
        fingerprint: 'foreign-fp',
      })
      .returning();

    const ownSkill = await newSkill('Own skill');
    const ownSkillCase = EvalCase.parse(
      (await post(`/skills/${ownSkill.id}/eval-cases`, caseBody())).json(),
    );
    const callsBefore = llm.calls.length;

    // owners and cases of another workspace do not exist for this caller
    expect((await post(`/agents/${foreignAgent.id}/eval-cases`, caseBody())).statusCode).toBe(404);
    expect((await post(`/skills/${foreignSkill.id}/eval-cases`, caseBody())).statusCode).toBe(404);
    expect((await get(`/skills/${foreignSkill.id}/eval-cases`)).statusCode).toBe(404);
    expect((await get(`/skills/${foreignSkill.id}/eval-runs`)).statusCode).toBe(404);
    expect((await get(`/skills/${foreignSkill.id}/eval-dashboard`)).statusCode).toBe(404);
    expect((await put(`/eval-cases/${foreignCase!.id}`, caseBody({ name: 'Hijacked' }))).statusCode).toBe(404);
    expect((await post(`/eval-cases/${foreignCase!.id}/runs`, {})).statusCode).toBe(404);
    expect((await get(`/eval-cases/${foreignCase!.id}/runs/latest`)).statusCode).toBe(404);

    // a host of another workspace is "not found", not "not linked" — for the skill run and the case run
    expect((await post(`/skills/${ownSkill.id}/eval-runs`, { host_agent_id: foreignAgent.id })).statusCode).toBe(404);
    expect((await post(`/eval-cases/${ownSkillCase.id}/runs`, { host_agent_id: foreignAgent.id })).statusCode).toBe(404);

    // nothing was written, nothing was reviewed
    const [untouched] = await db().select().from(t.evalCases).where(eq(t.evalCases.id, foreignCase!.id));
    expect(untouched).toMatchObject({ name: 'Foreign case', fingerprint: 'foreign-fp' });
    expect(await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, foreignAgent.id))).toHaveLength(1);
    expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.workspaceId, ws2!.id))).toEqual([]);
    expect(await db().select().from(t.evalRuns).where(eq(t.evalRuns.ownerId, ownSkill.id))).toEqual([]);
    expect(llm.calls.length).toBe(callsBefore);
  });

  // ---- editing a case made from a finding -----------------------------------------------------

  it('EC-12 / AC-8: a PUT on a case made from a finding keeps its source, its finding link and its stored output', async () => {
    const agent = await newAgent('Provenance agent');
    const { finding, made } = await findingMadeCase(agent.id, 'Hardcoded key');
    expect(made).toMatchObject({ source: 'finding', source_finding_id: finding.id, expectation: 'must_find' });

    const res = await put(`/eval-cases/${made.id}`, {
      name: 'Hardcoded key (reviewed)',
      input_diff: made.input_diff,
      input_meta: made.input_meta,
      expectation: 'must_not_flag',
      target: made.target,
    });
    expect(res.statusCode).toBe(200);
    const edited = EvalCase.parse(res.json());
    expect(edited).toMatchObject({
      id: made.id,
      name: 'Hardcoded key (reviewed)',
      expectation: 'must_not_flag',
      source: 'finding',
      source_finding_id: finding.id,
    });
    expect(edited.fingerprint).not.toBe(made.fingerprint);

    const [row] = await db().select().from(t.evalCases).where(eq(t.evalCases.id, made.id));
    expect(row!.source).toBe('finding');
    expect(row!.sourceFindingId).toBe(finding.id);
    expect(row!.expectedOutput).toEqual(made.expected_output);
  });

  it('EC-5: a PUT onto another case’s name is a 422 naming `name`, and the case keeps its own', async () => {
    const agent = await newAgent('Rename clash agent');
    const a = await agentCase(agent.id, { name: 'Alpha' });
    await agentCase(agent.id, { name: 'Beta' });

    const clash = await put(`/eval-cases/${a.id}`, caseBody({ name: ' beta ' }));
    expect(clash.statusCode).toBe(422);
    expect(clash.json().error.details).toEqual({ reason: 'name_taken', field: 'name' });
    const [row] = await db().select().from(t.evalCases).where(eq(t.evalCases.id, a.id));
    expect(row!.name).toBe('Alpha');

    // keeping its own name (any case) is not a clash
    expect((await put(`/eval-cases/${a.id}`, caseBody({ name: 'ALPHA' }))).statusCode).toBe(200);
  });

  // ---- single-run history survives the case --------------------------------------------------

  it('deleting a case keeps its single-run rows: the run stays, with the case id nulled and its name kept', async () => {
    const agent = await newAgent('Delete history agent');
    const c = await agentCase(agent.id, { name: 'Soon gone' });
    const run = await settle(EvalSuiteRun.parse((await post(`/eval-cases/${c.id}/runs`, {})).json()).id);
    expect(run.kind).toBe('single');
    expect(run.results[0]).toMatchObject({ case_id: c.id, case_name: 'Soon gone', status: 'passed' });

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${c.id}` });
    expect(del.statusCode).toBe(200);

    const [header] = await db().select().from(t.evalRuns).where(eq(t.evalRuns.id, run.id));
    expect(header).toMatchObject({ kind: 'single', status: 'completed', singleCaseId: null });
    const after = EvalSuiteRunDetail.parse((await get(`/eval-runs/${run.id}`)).json());
    expect(after.results[0]).toMatchObject({ case_id: null, case_name: 'Soon gone', status: 'passed' });
    expect((await get(`/eval-cases/${c.id}/runs/latest`)).statusCode).toBe(404);
  });

  // ---- a failing review call --------------------------------------------------------------------

  it('EC-9: a model call that fails is recorded as errored with its reason, exactly one call, and the case can run again', async () => {
    const agent = await newAgent('Failing agent');
    const c = await agentCase(agent.id, {
      name: 'Poisoned',
      input_meta: { pr_title: 'Poison', pr_body: '' },
    });
    const before = llm.calls.length;

    const res = await post(`/eval-cases/${c.id}/runs`, {});
    expect(res.statusCode).toBe(202);
    const done = await settle(EvalSuiteRun.parse(res.json()).id);
    expect(llm.calls.length - before).toBe(1); // no retry (NFR-2)
    expect(done.kind).toBe('single');
    expect(done.status).toBe('failed');
    expect(done.results[0]!.status).toBe('errored');
    expect(done.results[0]!.error).toMatch(/schema/);

    // the editor read shows the reason, and nothing is left running
    const state = EvalCaseRunState.parse((await get(`/eval-cases/${c.id}/runs/latest`)).json());
    expect(state.running).toBeNull();
    expect(state.latest?.run.id).toBe(done.id);
    expect(state.latest?.result).toMatchObject({ status: 'errored' });
    expect(state.latest?.result.error).toMatch(/schema/);

    // the per-case running slot was freed: the same case starts again
    const again = await post(`/eval-cases/${c.id}/runs`, {});
    expect(again.statusCode).toBe(202);
    await settle(EvalSuiteRun.parse(again.json()).id);
  });
});
