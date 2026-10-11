import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
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
} from '../src/adapters/mocks.js';
import { StructuredOutputError } from '../src/platform/errors.js';
import {
  EvalCaseCreateResult,
  EvalCaseList,
  EvalRunComparison,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

/**
 * Evals — routes end to end against real Postgres, the model mocked. The review
 * engine, grounding and scoring are the real ones; only the provider is faked.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One hunk at new-side lines 10-13; the line a finding cites is 11. */
const SMALL_PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';
const FILE = 'src/config.ts';

/**
 * A model whose behaviour a test controls: it flags `src/config.ts:11` (a finding
 * grounded in the diff), can be held back behind a gate, and fails the schema for
 * a PR whose title contains "Poison".
 */
class EvalLlm extends MockLLMProvider {
  gate: Promise<void> | null = null;
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.gate) await this.gate;
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

d('Evals module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prSeq = 7000;
  const llm = new EvalLlm('openai');
  let intentCalls = 0;
  const intentStub: IntentPort = {
    get: async () => {
      intentCalls++;
      return null;
    },
    ensure: async () => {
      intentCalls++;
      return null;
    },
    derive: async () => {
      intentCalls++;
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
        systemPrompt: 'You review code.',
        strategy: 'single-pass',
      })
      .returning();
    return a!;
  }

  async function newPr(title = 'Harden config', patch: string | null = SMALL_PATCH, file = FILE) {
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: prSeq++,
        title,
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
    if (patch !== null) {
      await db().insert(t.prFiles).values({ prId: pr!.id, path: file, additions: 1, deletions: 0, patch });
    }
    return pr!;
  }

  async function newReview(prId: string, agentId: string | null) {
    const [r] = await db()
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, kind: 'review', verdict: 'comment', summary: 's', score: 70, model: 'm' })
      .returning();
    return r!;
  }

  async function newFinding(
    reviewId: string,
    opts: { file?: string; start?: number; end?: number; accepted?: boolean; dismissed?: boolean; title?: string } = {},
  ) {
    const [f] = await db()
      .insert(t.findings)
      .values({
        reviewId,
        file: opts.file ?? FILE,
        startLine: opts.start ?? 11,
        endLine: opts.end ?? 11,
        severity: 'WARNING',
        category: 'security',
        title: opts.title ?? 'Hardcoded key',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: opts.accepted ? new Date() : null,
        dismissedAt: opts.dismissed ? new Date() : null,
      })
      .returning();
    return f!;
  }

  const makeCase = (findingId: string) =>
    app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case`, payload: {} });

  async function settle(runId: string) {
    for (let i = 0; i < 200; i++) {
      const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
      const body = res.json();
      if (body.status !== 'running') return EvalSuiteRunDetail.parse(body);
      await sleep(50);
    }
    throw new Error('eval run did not finish in 10 s');
  }

  const startRun = (agentId: string) =>
    app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });

  // ---- cases ---------------------------------------------------------------------------

  describe('create a case from a finding', () => {
    it('AC-2 / AC-3 / EC-2: accepted → must_find, dismissed → must_not_flag, a repeat reports the same case', async () => {
      const agent = await newAgent('Cases agent');
      const pr = await newPr();
      const review = await newReview(pr.id, agent.id);
      const accepted = await newFinding(review.id, { accepted: true });
      const dismissed = await newFinding(review.id, { dismissed: true, title: 'Style nit' });

      const first = await makeCase(accepted.id);
      expect(first.statusCode).toBe(201);
      const created = EvalCaseCreateResult.parse(first.json());
      expect(created.created).toBe(true);
      expect(created.case).toMatchObject({
        expectation: 'must_find',
        source: 'finding',
        source_finding_id: accepted.id,
        owner_id: agent.id,
        target: { file: FILE, start_line: 11, end_line: 11 },
        input_meta: { pr_title: 'Harden config', pr_body: 'Moves keys to env.' },
      });
      expect(created.case.input_diff).toContain('diff --git a/src/config.ts b/src/config.ts');
      expect(created.case.input_diff).toContain('stripeKey');

      const second = await makeCase(dismissed.id);
      expect(second.statusCode).toBe(201);
      expect(EvalCaseCreateResult.parse(second.json()).case.expectation).toBe('must_not_flag');

      const again = await makeCase(accepted.id);
      expect(again.statusCode).toBe(200);
      const repeat = EvalCaseCreateResult.parse(again.json());
      expect(repeat.created).toBe(false);
      expect(repeat.case.id).toBe(created.case.id);

      const list = EvalCaseList.parse((await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json());
      expect(list.total).toBe(2);
      expect(list.passing).toBe(0);
      expect(list.cases.every((c) => c.last_result === 'never_run')).toBe(true);
    });

    it('EC-1: an undecided finding is rejected', async () => {
      const agent = await newAgent('Undecided agent');
      const pr = await newPr();
      const review = await newReview(pr.id, agent.id);
      const undecided = await newFinding(review.id);
      const res = await makeCase(undecided.id);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.reason).toBe('finding_undecided');
    });

    it('EC-3: no producing agent, or a deleted one → 404', async () => {
      const pr = await newPr();
      const noAgent = await newFinding((await newReview(pr.id, null)).id, { accepted: true });
      expect((await makeCase(noAgent.id)).statusCode).toBe(404);

      const gone = await newAgent('Soon gone');
      const goneFinding = await newFinding((await newReview(pr.id, gone.id)).id, { accepted: true });
      await db().delete(t.agents).where(eq(t.agents.id, gone.id));
      expect((await makeCase(goneFinding.id)).statusCode).toBe(404);
    });

    it('EC-12: an oversized patch is trimmed to the overlapping hunks, or refused when one hunk is too big', async () => {
      const agent = await newAgent('Big diff agent');
      const big =
        '@@ -10,3 +10,4 @@\n ctx\n+small\n ctx\n' + `@@ -500,2 +500,3 @@\n ctx\n+${'y'.repeat(70_000)}\n ctx`;
      expect(Buffer.byteLength(big)).toBeGreaterThan(65_536);
      const pr = await newPr('Big', big);
      const review = await newReview(pr.id, agent.id);

      const small = await newFinding(review.id, { accepted: true, start: 11, end: 11 });
      const ok = await makeCase(small.id);
      expect(ok.statusCode).toBe(201);
      const frozen = EvalCaseCreateResult.parse(ok.json()).case.input_diff;
      expect(Buffer.byteLength(frozen)).toBeLessThanOrEqual(65_536);
      expect(frozen).toContain('+small');
      expect(frozen).not.toContain('yyyy');

      const huge = await newFinding(review.id, { accepted: true, start: 501, end: 501, title: 'In the big hunk' });
      const refused = await makeCase(huge.id);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error.details.reason).toBe('diff_too_large');
    });

    it('EC-4 / NFR-3 / NFR-6: the case keeps its frozen inputs when the source changes or is deleted', async () => {
      const agent = await newAgent('Frozen agent');
      const pr = await newPr();
      const review = await newReview(pr.id, agent.id);
      const finding = await newFinding(review.id, { accepted: true });
      const made = EvalCaseCreateResult.parse((await makeCase(finding.id)).json()).case;

      // Flip the disposition, rewrite the PR's patch, then delete the review (and with it the finding).
      await db().update(t.findings).set({ acceptedAt: null, dismissedAt: new Date() }).where(eq(t.findings.id, finding.id));
      await db().update(t.prFiles).set({ patch: '@@ -1 +1 @@\n-a\n+b' }).where(eq(t.prFiles.prId, pr.id));
      await db().delete(t.reviews).where(eq(t.reviews.id, review.id));

      const after = EvalCaseList.parse((await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json());
      const kept = after.cases.find((c) => c.id === made.id)!;
      expect(kept.expectation).toBe('must_find');
      expect(kept.input_diff).toBe(made.input_diff);
      expect(kept.fingerprint).toBe(made.fingerprint);
      expect(kept.source_finding_id).toBeNull();

      // Deleting the PR removes no case either.
      await db().delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
      const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(t.evalCases).where(eq(t.evalCases.id, made.id));
      expect(n).toBe(1);
    });

    it('UI-1 / UI-2: a malformed id is 422, an unknown one 404, an extra body key 422', async () => {
      expect((await app.inject({ method: 'POST', url: '/findings/not-a-uuid/eval-case', payload: {} })).statusCode).toBe(422);
      expect((await makeCase('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
      const res = await app.inject({
        method: 'POST',
        url: '/findings/00000000-0000-4000-8000-000000000000/eval-case',
        payload: { extra: 1 },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ---- runs ----------------------------------------------------------------------------

  describe('suite runs', () => {
    let agent: Awaited<ReturnType<typeof newAgent>>;
    const caseIds: string[] = [];
    let run1: EvalSuiteRunDetail;
    let skillId: string;

    beforeAll(async () => {
      agent = await newAgent('Run agent');
      const [skill] = await db()
        .insert(t.skills)
        .values({
          workspaceId,
          name: 'Secrets rule',
          description: 'd',
          type: 'security',
          source: 'manual',
          body: 'Flag committed secrets.',
          version: 3,
        })
        .returning();
      skillId = skill!.id;
      await db().insert(t.agentSkills).values({ agentId: agent.id, skillId, order: 0, enabled: true });

      const pr = await newPr('Run PR');
      const review = await newReview(pr.id, agent.id);
      for (const spec of [
        { accepted: true, title: 'Case A' },
        { accepted: true, title: 'Case B' },
        { dismissed: true, title: 'Case C' },
      ]) {
        const f = await newFinding(review.id, spec);
        caseIds.push(EvalCaseCreateResult.parse((await makeCase(f.id)).json()).case.id);
      }
    });

    it('EC-5: an agent with no cases cannot run', async () => {
      const empty = await newAgent('Empty agent');
      const res = await startRun(empty.id);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('eval_set_empty');
    });

    it('AC-6 / EC-6: answers 202 running at once, and a second start while it runs is a 409', async () => {
      let release!: () => void;
      llm.gate = new Promise<void>((r) => (release = r));
      const before = {
        reviews: await db().select({ n: sql<number>`count(*)::int` }).from(t.reviews),
        findings: await db().select({ n: sql<number>`count(*)::int` }).from(t.findings),
        runs: await db().select({ n: sql<number>`count(*)::int` }).from(t.agentRuns),
      };
      const callsBefore = llm.calls.length;
      intentCalls = 0;

      const res = await startRun(agent.id);
      expect(res.statusCode).toBe(202);
      const started = EvalSuiteRun.parse(res.json());
      expect(started.status).toBe('running');

      const second = await startRun(agent.id);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('eval_run_in_progress');
      expect(second.json().error.details.run_id).toBe(started.id);

      release();
      llm.gate = null;
      run1 = await settle(started.id);

      // NFR-4: a run creates no review, finding or agent run, and never derives an intent.
      expect(await db().select({ n: sql<number>`count(*)::int` }).from(t.reviews)).toEqual(before.reviews);
      expect(await db().select({ n: sql<number>`count(*)::int` }).from(t.findings)).toEqual(before.findings);
      expect(await db().select({ n: sql<number>`count(*)::int` }).from(t.agentRuns)).toEqual(before.runs);
      expect(intentCalls).toBe(0);

      // AC-7 / NFR-1: one model call per case, and a prompt of the frozen inputs only.
      const calls = llm.calls.slice(callsBefore).filter((c) => c.method === 'completeStructured');
      expect(calls).toHaveLength(3);
      for (const c of calls) {
        const req = c.req as StructuredRequest<unknown>;
        const text = req.messages.map((m) => m.content).join('\n');
        expect(text).toContain('Run PR');
        expect(text).toContain('Moves keys to env.');
        expect(text).not.toContain('## Repo skeleton');
        expect(text).not.toContain('## Callers of changed symbols');
        expect(text).not.toContain('## Project context');
        expect(text).not.toContain('## Derived intent');
        expect(req.maxRetries).toBe(0);
        expect(req.timeoutMs).toBe(125_000);
      }
    });

    it('AC-9: the run records the agent version, skills, case fingerprints, metrics and counts', () => {
      expect(run1.status).toBe('completed');
      expect(run1.agent_version).toBe(agent.version);
      expect(run1.skills).toEqual([{ skill_id: skillId, name: 'Secrets rule', version: 3 }]);
      expect(run1.cases).toHaveLength(3);
      expect(run1.cases.every((c) => caseIds.includes(c.case_id) && c.fingerprint.length === 64)).toBe(true);
      expect(run1.cases_total).toBe(3);
      // Both must_find cases are hit at line 11; the must_not_flag case is hit too, so it fails.
      expect(run1.cases_passed).toBe(2);
      expect(run1.metrics.recall).toBe(1);
      expect(run1.metrics.precision).toBeCloseTo(2 / 3, 10);
      expect(run1.metrics.citation_accuracy).toBe(1);
      expect(run1.duration_ms).not.toBeNull();
      expect(run1.results).toHaveLength(3);
    });

    it('lists the run, and the case list shows each case’s result in the latest run', async () => {
      const runs = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
      expect(runs.map((r: { id: string }) => r.id)).toContain(run1.id);
      const list = EvalCaseList.parse((await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json());
      expect(list.latest_run_id).toBe(run1.id);
      expect(list.passing).toBe(2);
      expect(list.total).toBe(3);
    });

    it('NFR-10 / EC-7: an erroring case carries its reason and the run is partial', async () => {
      const partialAgent = await newAgent('Partial agent');
      for (const title of ['Fine PR', 'Poison PR']) {
        const pr = await newPr(title);
        const f = await newFinding((await newReview(pr.id, partialAgent.id)).id, { accepted: true });
        await makeCase(f.id);
      }
      const started = EvalSuiteRun.parse((await startRun(partialAgent.id)).json());
      const done = await settle(started.id);
      expect(done.status).toBe('partial');
      expect(done.cases_errored).toBe(1);
      const errored = done.results.find((r) => r.status === 'errored')!;
      expect(errored.error).toContain('did not match the schema');
      // Errored cases are out of every denominator: the surviving must_find case is the whole recall.
      expect(done.metrics.recall).toBe(1);
    });

    it('UI-3 / EC-9: compare orders the runs, and flags a case set that changed in between', async () => {
      // Delete one case between the runs (AC-5), then run again.
      const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseIds[2]}` });
      expect(del.statusCode).toBe(200);
      const run2 = await settle(EvalSuiteRun.parse((await startRun(agent.id)).json()).id);
      expect(run2.cases_total).toBe(2);

      // AC-5: the first run keeps the deleted case's result, with its name and no case id.
      const old = await settle(run1.id);
      const orphan = old.results.find((r) => r.case_id === null)!;
      expect(orphan.case_name).toBe('Case C');

      const cmp = EvalRunComparison.parse(
        (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${run2.id}&b=${run1.id}` })).json(),
      );
      expect(cmp.older.id).toBe(run1.id);
      expect(cmp.newer.id).toBe(run2.id);
      expect(cmp.case_sets).toMatchObject({ same: false, older_count: 3, newer_count: 2 });
      expect(cmp.skills_changed).toBe(false);

      const same = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${run1.id}&b=${run1.id}` });
      expect(same.statusCode).toBe(422);
      expect(same.json().error.code).toBe('eval_compare_invalid');
    });

    it('UI-3: comparing with a run of another agent is a 422', async () => {
      const other = await newAgent('Other agent');
      const [otherRun] = await db()
        .insert(t.evalRuns)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: other.id,
          agentId: other.id,
          agentVersion: 1,
          provider: 'openai',
          model: 'm',
          status: 'completed',
        })
        .returning();
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-runs/compare?a=${run1.id}&b=${otherRun!.id}`,
      });
      expect(res.statusCode).toBe(422);
    });

    it('UI-1: a malformed run id is 422 and a run of another workspace is 404', async () => {
      expect((await app.inject({ method: 'GET', url: '/eval-runs/not-a-uuid' })).statusCode).toBe(422);
      const [ws2] = await db().insert(t.workspaces).values({ name: 'Another workspace' }).returning();
      const foreign = await newAgent('Foreign agent', ws2!.id);
      const [foreignRun] = await db()
        .insert(t.evalRuns)
        .values({
          workspaceId: ws2!.id,
          ownerKind: 'agent',
          ownerId: foreign.id,
          agentId: foreign.id,
          agentVersion: 1,
          provider: 'openai',
          model: 'm',
          status: 'completed',
        })
        .returning();
      expect((await app.inject({ method: 'GET', url: `/eval-runs/${foreignRun!.id}` })).statusCode).toBe(404);
    });

    it('serves the agent and workspace dashboards', async () => {
      const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
      expect(res.statusCode).toBe(200);
      const dash = res.json();
      expect(dash.current.cases_total).toBe(2);
      expect(dash.trend.length).toBeGreaterThanOrEqual(2);
      expect(dash.agents).toEqual([]);

      const ws = (await app.inject({ method: 'GET', url: '/eval/dashboard' })).json();
      expect(ws.agents.map((a: { agent_id: string }) => a.agent_id)).toContain(agent.id);
    });

    it('NFR-6: deleting the agent removes its cases and eval runs', async () => {
      const del = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
      expect(del.statusCode).toBe(200);
      const cases = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, agent.id));
      const runs = await db().select().from(t.evalRuns).where(eq(t.evalRuns.agentId, agent.id));
      const results = await db().select().from(t.evalRunCases).where(eq(t.evalRunCases.runId, run1.id));
      expect(cases).toHaveLength(0);
      expect(runs).toHaveLength(0);
      expect(results).toHaveLength(0);
      // Deleting a case or an agent never touches the findings it came from.
      const survivors = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(t.findings)
        .where(and(eq(t.findings.title, 'Case A')));
      expect(survivors[0]!.n).toBe(1);
    });
  });
});
