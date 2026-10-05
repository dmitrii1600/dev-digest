import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
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
import { StructuredOutputError } from '../src/platform/errors.js';
import { BlastRepository } from '../src/modules/blast/repository.js';
import {
  PrBriefRecord,
  PrBriefResponse,
  type BlastRadius,
  type BriefDraft,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import type { IntentPort } from '../src/modules/intent/types.js';

/**
 * PR Brief — routes end to end against real Postgres, with the model mocked
 * (`structuredBySchema.PrBriefDraft`). The seeded PR #482 already holds a brief,
 * so every "no brief yet" case uses a PR this file inserts itself.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DRAFT: BriefDraft = {
  summary: 'Adds a limiter.',
  risks: [
    { kind: 'security', title: 'Spoofable key', explanation: 'e', severity: 'high', file_refs: ['src/a.ts:3-9'] },
  ],
  review_focus: [{ file: 'src/a.ts', line: 3, reason: 'refill math' }],
};

const intentStub: IntentPort = {
  get: async () => null,
  ensure: async () => null,
  derive: async () => {
    throw new Error('not used: a brief never derives an intent');
  },
};

// A degraded-free blast stub: the real service would queue a background reindex job.
const EMPTY_BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: '', degraded: false, reason: null };
const blastStub = { forPull: async () => EMPTY_BLAST };

/** A mock model whose next call can be delayed or made to fail. */
class ControlledLlm extends MockLLMProvider {
  delayMs = 0;
  failWith: Error | null = null;
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) {
      this.calls.push({ method: 'completeStructured', req });
      throw this.failWith;
    }
    return super.completeStructured(req);
  }
}

const structuredCalls = (m: MockLLMProvider) => m.calls.filter((c) => c.method === 'completeStructured');

d('PR Brief module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prSeq = 9000;
  const dirs: string[] = [];

  const openai = new ControlledLlm('openai', { structuredBySchema: { PrBriefDraft: DRAFT } });
  const anthropic = new ControlledLlm('anthropic', { structuredBySchema: { PrBriefDraft: DRAFT } });
  const gh = new MockGitHubClient();
  const issueCalls: number[] = [];
  gh.getIssue = async (_repo, n) => {
    issueCalls.push(n);
    return { number: n, title: 'Rate-limit public endpoints', body: 'Spec text', state: 'open' };
  };

  let app: Awaited<ReturnType<typeof buildApp>>;
  /** Same database, no `overrides.llm` and no provider key (EC-4, NFR-5). */
  let keylessApp: Awaited<ReturnType<typeof buildApp>>;

  const baseOverrides = () => ({
    git: new MockGitClient({ diff: '' }),
    github: gh,
    embedder: new MockEmbedder(),
    intent: intentStub,
    blast: blastStub,
  });

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
      overrides: { ...baseOverrides(), llm: { openai, anthropic } },
    });
    keylessApp = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { ...baseOverrides(), secrets: new MockSecretsProvider({}) },
    });
  });
  afterAll(async () => {
    await app?.close();
    await keylessApp?.close();
    await pg?.stop();
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  async function newPr(
    opts: { repoId?: string; files?: string[]; body?: string | null; workspaceId?: string } = {},
  ): Promise<{ id: string; number: number }> {
    const files = opts.files ?? ['src/a.ts', 'src/b.ts'];
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: opts.workspaceId ?? workspaceId,
        repoId: opts.repoId ?? repoId,
        number: prSeq++,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: files.length,
        status: 'open',
        body: opts.body === undefined ? 'Adds a limiter.' : opts.body,
      })
      .returning();
    if (files.length > 0) {
      await pg.handle.db.insert(t.prFiles).values(files.map((path) => ({ prId: pr!.id, path, additions: 3, deletions: 1 })));
    }
    return { id: pr!.id, number: pr!.number };
  }

  const get = (a: typeof app, id: string) => a.inject({ method: 'GET', url: `/pulls/${id}/brief` });
  const post = (a: typeof app, id: string) => a.inject({ method: 'POST', url: `/pulls/${id}/brief` });
  const briefRows = (prId: string) => pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));

  // ---- step 6: the seeded brief ----------------------------------------------------------

  describe('seed', () => {
    it('serves the seeded brief for PR #482, keeps its history, and is idempotent', async () => {
      const [pr482] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
      const id = pr482!.id;

      const res = await get(app, id);
      expect(res.statusCode).toBe(200);
      const body = PrBriefResponse.parse(res.json());
      expect(body.stale).toBe(false);
      expect(body.generating).toBe(false);
      expect(body.brief!.review_focus.map((f) => f.file)).toEqual([
        'src/middleware/ratelimit.ts',
        'src/api/public/webhooks.ts',
        'src/server.ts',
      ]);

      const [row] = await briefRows(id);
      expect(PrBriefRecord.safeParse((row!.json as { brief: unknown }).brief).success).toBe(true);

      const history = await app.inject({ method: 'GET', url: `/pulls/${id}/history` });
      expect(history.statusCode).toBe(200);
      expect(history.json().history).toHaveLength(1);

      const generatedAt = body.brief!.generated_at;
      await seed(pg.handle.db);
      const rows = await briefRows(id);
      expect(rows).toHaveLength(1);
      expect((rows[0]!.json as { brief: { generated_at: string } }).brief.generated_at).toBe(generatedAt);
    });
  });

  // ---- step 7 -----------------------------------------------------------------------------

  describe('generation', () => {
    it('AC-2 / AC-10 / AC-11 / AC-15: generates from the Settings model, reload is free, a re-run replaces', async () => {
      const pr = await newPr();
      const before = structuredCalls(openai).length;

      const first = await post(app, pr.id);
      expect(first.statusCode).toBe(200);
      const body = PrBriefResponse.parse(first.json());
      expect(body.brief).toMatchObject({ provider: 'openai', model: 'gpt-4.1', summary: 'Adds a limiter.' });
      expect(body.brief!.risks[0]!.file_refs).toEqual(['src/a.ts:3-9']);
      expect(structuredCalls(openai)).toHaveLength(before + 1);

      const reload = await get(app, pr.id);
      expect(reload.json().brief.generated_at).toBe(body.brief!.generated_at);
      expect(structuredCalls(openai)).toHaveLength(before + 1); // AC-10: no new call

      await new Promise((r) => setTimeout(r, 5));
      const second = await post(app, pr.id);
      expect(second.statusCode).toBe(200);
      expect(second.json().brief.generated_at).not.toBe(body.brief!.generated_at);
      expect(await briefRows(pr.id)).toHaveLength(1);
    });

    it('AC-15: a different Settings model is the one recorded', async () => {
      const put = (feature: { provider: string; model: string }) =>
        app.inject({ method: 'PUT', url: '/settings', payload: { feature_models: { risk_brief: feature } } });
      expect((await put({ provider: 'anthropic', model: 'claude-x' })).statusCode).toBe(200);
      try {
        const pr = await newPr();
        const res = await post(app, pr.id);
        expect(res.statusCode).toBe(200);
        expect(res.json().brief).toMatchObject({ provider: 'anthropic', model: 'claude-x' });
        expect(structuredCalls(anthropic).length).toBeGreaterThan(0);
      } finally {
        await put({ provider: 'openai', model: 'gpt-4.1' });
      }
    });

    it('AC-2: the linked issue (first #n) is fetched and reaches the model inside its own untrusted block', async () => {
      const pr = await newPr({ body: 'Implements the limiter. Fixes #42' });
      issueCalls.length = 0;
      const before = openai.calls.length;
      const res = await post(app, pr.id);
      expect(res.statusCode).toBe(200);
      expect(issueCalls).toEqual([42]);
      const req = openai.calls[before]!.req as StructuredRequest<unknown>;
      const user = req.messages.map((m) => m.content).join('\n');
      expect(user).toContain('<untrusted source="linked_issue">');
      expect(user).toContain('Rate-limit public endpoints');
    });

    it('EC-1 / AC-7: no intent, no linked issue and no clone are listed as missing facts', async () => {
      const pr = await newPr();
      const res = await post(app, pr.id);
      expect(res.statusCode).toBe(200);
      const facts = (res.json().brief.missing_facts as { fact: string; status: string }[]).map((f) => `${f.fact}/${f.status}`);
      expect(facts).toEqual(expect.arrayContaining(['intent/absent', 'project_context/absent', 'linked_issue/absent']));
    });

    it('AC-14: a new head sha marks the stored brief stale, without a model call', async () => {
      const pr = await newPr();
      await post(app, pr.id);
      const before = openai.calls.length;
      await pg.handle.db.update(t.pullRequests).set({ headSha: 'newhead' }).where(eq(t.pullRequests.id, pr.id));
      const res = await get(app, pr.id);
      expect(res.json()).toMatchObject({ stale: true, head_sha: 'newhead', generating: false });
      expect(openai.calls).toHaveLength(before);
    });

    it('EC-11: the brief and Prior PRs history never clobber each other', async () => {
      const pr = await newPr();
      const history = { computed_for_sha: 'deadbeef', history: [] };
      await pg.handle.db.insert(t.prBrief).values({ prId: pr.id, json: { history } });

      // a history-only document is "no brief yet"
      expect((await get(app, pr.id)).json().brief).toBeNull();

      const gen = await post(app, pr.id);
      expect(gen.statusCode).toBe(200);
      let [row] = await briefRows(pr.id);
      expect((row!.json as { history: unknown }).history).toEqual(history);

      const stored = (row!.json as { brief: unknown }).brief;
      await new BlastRepository(pg.handle.db).upsertHistory(pr.id, 'cafe', []);
      [row] = await briefRows(pr.id);
      expect((row!.json as { brief: unknown }).brief).toEqual(stored);
      expect((row!.json as { history: { computed_for_sha: string } }).history.computed_for_sha).toBe('cafe');
    });

    it('EC-5: two concurrent POSTs → one 200, one 409 brief_running, one model call', async () => {
      const pr = await newPr();
      const before = structuredCalls(openai).length;
      openai.delayMs = 150;
      try {
        const [a, b] = await Promise.all([post(app, pr.id), post(app, pr.id)]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
        const loser = a.statusCode === 409 ? a : b;
        expect(loser.json().error?.code ?? loser.json().code).toBe('brief_running');
        expect(structuredCalls(openai)).toHaveLength(before + 1);
      } finally {
        openai.delayMs = 0;
      }
    });

    it('EC-10: a PR with no changed files → 422 no_changed_files, no model call', async () => {
      const pr = await newPr({ files: [] });
      const before = openai.calls.length;
      const res = await post(app, pr.id);
      expect(res.statusCode).toBe(422);
      expect(res.json().error?.code ?? res.json().code).toBe('no_changed_files');
      expect(openai.calls).toHaveLength(before);
      expect(await briefRows(pr.id)).toHaveLength(0);
    });

    it('EC-4: no provider key → 422 provider_key_missing naming the provider, nothing written', async () => {
      const pr = await newPr();
      const res = await post(keylessApp, pr.id);
      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.error?.code ?? body.code).toBe('provider_key_missing');
      expect((body.error?.details ?? body.details).provider).toBe('openai');
      expect(await briefRows(pr.id)).toHaveLength(0);
    });

    it('EC-3: a failed model call is a 502 and the previous brief is kept', async () => {
      const pr = await newPr();
      const ok = await post(app, pr.id);
      expect(ok.statusCode).toBe(200);
      const previous = ok.json().brief;

      openai.failWith = new StructuredOutputError('bad shape', { raw: 'SECRET-RAW' });
      try {
        const res = await post(app, pr.id);
        expect(res.statusCode).toBe(502);
        const body = res.json();
        expect(body.error?.code ?? body.code).toBe('brief_failed');
        expect((body.error?.details ?? body.details).reason).toBe('invalid_output');
        expect(JSON.stringify(body)).not.toContain('SECRET-RAW');
      } finally {
        openai.failWith = null;
      }
      expect((await get(app, pr.id)).json().brief).toEqual(previous);
    });

    it('NFR-5: a stored brief is still viewable with the key, the intent and the index gone', async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'brief-nfr5', fullName: 'acme/brief-nfr5' })
        .returning();
      await pg.handle.db.insert(t.repoIndexState).values({
        repoId: repo!.id,
        lastIndexedSha: 'sha1',
        indexerVersion: 1,
        status: 'full',
        filesIndexed: 1,
        filesSkipped: 0,
      });
      const pr = await newPr({ repoId: repo!.id });
      await pg.handle.db.insert(t.prIntent).values({ prId: pr.id, intent: 'Rate limit', headSha: 'deadbeef' });
      expect((await post(app, pr.id)).statusCode).toBe(200);

      await pg.handle.db.delete(t.prIntent).where(eq(t.prIntent.prId, pr.id));
      await pg.handle.db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, repo!.id));

      // the keyless app has no provider key at all
      const res = await get(keylessApp, pr.id);
      expect(res.statusCode).toBe(200);
      expect(res.json().brief).not.toBeNull();
    });

    it('NFR-11: deleting the PR deletes its brief', async () => {
      const pr = await newPr();
      await post(app, pr.id);
      expect(await briefRows(pr.id)).toHaveLength(1);
      await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
      expect(await briefRows(pr.id)).toHaveLength(0);
    });

    it('AC-2 / SA-1: documents are listed in enabled-agent order (created_at, id); a disabled agent adds none', async () => {
      const clone = await mkdtemp(join(tmpdir(), 'dd-brief-it-'));
      dirs.push(clone);
      for (const rel of ['docs/early.md', 'docs/late.md', 'docs/disabled.md']) {
        await mkdir(dirname(join(clone, rel)), { recursive: true });
        await writeFile(join(clone, rel), `# ${rel}\n`);
      }
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'brief-docs', fullName: 'acme/brief-docs', clonePath: clone })
        .returning();

      const mkAgent = async (name: string, createdAt: string, enabled: boolean, doc: string) => {
        const [a] = await pg.handle.db
          .insert(t.agents)
          .values({
            workspaceId,
            name,
            provider: 'openai',
            model: 'gpt-4.1',
            systemPrompt: 'x',
            enabled,
            createdAt: new Date(createdAt),
          })
          .returning();
        await pg.handle.db.insert(t.agentContextDocs).values({ agentId: a!.id, repoId: repo!.id, path: doc, order: 0 });
      };
      // inserted late-first, so insertion order is the reverse of the expected order
      await mkAgent('brief-late', '2031-01-02T00:00:00Z', true, 'docs/late.md');
      await mkAgent('brief-early', '2031-01-01T00:00:00Z', true, 'docs/early.md');
      await mkAgent('brief-off', '2031-01-03T00:00:00Z', false, 'docs/disabled.md');

      const pr = await newPr({ repoId: repo!.id });
      const before = openai.calls.length;
      const res = await post(app, pr.id);
      expect(res.statusCode).toBe(200);
      const req = openai.calls[before]!.req as StructuredRequest<unknown>;
      const user = req.messages.map((m) => m.content).join('\n');
      const sources = [...user.matchAll(/<untrusted source="doc:([^"]+)">/g)].map((m) => m[1]);
      expect(sources).toEqual(['docs/early.md', 'docs/late.md']);
      expect(user).not.toContain('docs/disabled.md');
    });
  });

  /**
   * Everything above stubs the intent reader and the blast port. This block
   * builds a third app with the REAL `container.intent`, `container.blast` (with
   * repo-intel switched off, so no index and no background job is involved), the
   * real Smart Diff over `pr_files` and the real tokenizer, and pins what only
   * the real wiring can break: the facts the brief lists, the prompt that
   * reaches the model, and the one log line.
   */
  describe('real ports (repo-intel off)', () => {
    const PATCH_MARKER = 'SECRET_PATCH_BODY_do_not_send';
    const REAL_DRAFT: BriefDraft = {
      summary: 'Adds a limiter.',
      risks: [
        { kind: 'security', title: 'Ghost risk', explanation: 'e', severity: 'high', file_refs: ['src/ghost.ts:1'] },
        { kind: 'perf', title: 'Real risk', explanation: 'e', severity: 'low', file_refs: ['src/a.ts:3-9'] },
      ],
      review_focus: [
        { file: 'src/ghost.ts', line: 1, reason: 'invented' },
        { file: './src/a.ts', line: 3, reason: 'refill math' },
      ],
    };
    const realLlm = new ControlledLlm('openai', { structuredBySchema: { PrBriefDraft: REAL_DRAFT } });
    let realApp: Awaited<ReturnType<typeof buildApp>>;

    beforeAll(async () => {
      realApp = await buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test', REPO_INTEL_ENABLED: 'false' } as NodeJS.ProcessEnv),
        db: pg.handle.db,
        overrides: {
          git: new MockGitClient({ diff: '' }),
          github: gh,
          embedder: new MockEmbedder(),
          llm: { openai: realLlm, anthropic },
        },
      });
    });
    afterAll(async () => {
      await realApp?.close();
    });

    const sentToModel = (callIndex: number) =>
      (realLlm.calls[callIndex]!.req as StructuredRequest<unknown>).messages.map((m) => m.content).join('\n');

    it('EC-2 / AC-6 / NFR-3: blast degraded (flag_off) is listed, an invented file is removed, and no patch text is sent', async () => {
      const pr = await newPr({ files: ['src/a.ts', 'test/a.test.ts'] });
      await pg.handle.db.update(t.prFiles).set({ patch: `@@ -1 +1 @@\n+${PATCH_MARKER}` }).where(eq(t.prFiles.prId, pr.id));
      const before = realLlm.calls.length;

      const res = await post(realApp, pr.id);
      expect(res.statusCode).toBe(200);
      const brief = PrBriefResponse.parse(res.json()).brief!;

      expect(brief.missing_facts).toContainEqual({ fact: 'blast', status: 'degraded', detail: 'flag_off' });
      // with no blast map the file check is the PR's changed files alone
      expect(brief.risks.map((r) => r.title)).toEqual(['Real risk']);
      expect(brief.review_focus).toEqual([{ file: 'src/a.ts', line: 3, reason: 'refill math' }]);

      // what the model was shown: title, description and the Smart Diff statistics — never a hunk
      expect(realLlm.calls).toHaveLength(before + 1);
      const sent = sentToModel(before);
      expect(sent).toContain('Add rate limiting');
      expect(sent).toContain('Adds a limiter.');
      expect(sent).toContain('core src/a.ts +3 −1');
      expect(sent).toContain('tests test/a.test.ts +3 −1');
      expect(sent).not.toContain(PATCH_MARKER);
    });

    it('EC-1 / AC-7 / NFR-1: the real intent reader lists an older-commit intent as stale, and a brief never derives or rewrites an intent', async () => {
      const old = await newPr();
      await pg.handle.db.insert(t.prIntent).values({ prId: old.id, intent: 'Rate limit', headSha: 'oldsha' });
      const none = await newPr();

      const before = realLlm.calls.length;
      const [a, b] = [await post(realApp, old.id), await post(realApp, none.id)];
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);

      const facts = (r: typeof a) =>
        (r.json().brief.missing_facts as { fact: string; status: string }[]).map((f) => `${f.fact}/${f.status}`);
      expect(facts(a)).toContain('intent/stale');
      expect(facts(b)).toContain('intent/absent');

      // exactly one structured call per generation, and nothing else (no intent derivation)
      expect(realLlm.calls.slice(before).map((c) => (c.req as StructuredRequest<unknown>).schemaName)).toEqual([
        'PrBriefDraft',
        'PrBriefDraft',
      ]);
      const [kept] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, old.id));
      expect(kept).toMatchObject({ intent: 'Rate limit', headSha: 'oldsha' });
      expect(await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, none.id))).toHaveLength(0);
    });

    it('NFR-9 / NFR-2: the app logger gets one line per generation with the counters, and the real tokenizer count is within the budget', async () => {
      const pr = await newPr();
      const spy = vi.spyOn(realApp.log, 'info');
      try {
        expect((await post(realApp, pr.id)).statusCode).toBe(200);
        const lines = spy.mock.calls
          .map((c) => c as unknown[])
          .filter((c) => c[1] === 'pr brief generation')
          .map((c) => c[0] as Record<string, unknown>);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
          prId: pr.id,
          headSha: 'deadbeef',
          provider: 'openai',
          model: 'gpt-4.1',
          modelCalls: 1,
          tokensIn: 100,
          tokensOut: 50,
          costUsd: 0.001,
          outcome: 'ok',
          removed: { risks: 1, focus: 1 }, // spec NFR-9 counts risks and focus items; `refs` is an extra
        });
        const inputTokens = lines[0]!.inputTokens as number;
        expect(inputTokens).toBeGreaterThan(0);
        expect(inputTokens).toBeLessThanOrEqual(8000);
        expect(JSON.stringify(lines[0])).not.toContain('Adds a limiter'); // no prompt or model text in the log
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('params (UI-10)', () => {
    it('a malformed id is 422, an unknown id is 404, another workspace\'s PR is 404', async () => {
      expect((await get(app, 'not-a-uuid')).statusCode).toBe(422);
      expect((await post(app, 'not-a-uuid')).statusCode).toBe(422);
      expect((await get(app, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);

      const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
      const [otherRepo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId: other!.id, owner: 'x', name: 'y', fullName: 'x/y' })
        .returning();
      const pr = await newPr({ repoId: otherRepo!.id, workspaceId: other!.id });
      expect((await get(app, pr.id)).statusCode).toBe(404);
      expect((await post(app, pr.id)).statusCode).toBe(404);
      expect(await pg.handle.db.select().from(t.prBrief).where(and(eq(t.prBrief.prId, pr.id)))).toHaveLength(0);
    });
  });
});
