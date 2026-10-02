import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BlastRadius,
  BriefDraft,
  LLMProvider,
  PrBriefRecord,
  PrIntentRecord,
  SmartDiff,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { BriefService, type BriefDeps } from '../src/modules/brief/service.js';
import type { BriefPr } from '../src/modules/brief/repository.js';
import { AppError, ConfigError, StructuredOutputError } from '../src/platform/errors.js';
import { TimeoutError } from '../src/platform/resilience.js';

/** Hermetic: in-memory fakes for every port, a fake LLM, no Postgres, no Container. */

const WS = 'ws-1';
const PR: BriefPr = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 482,
  title: 'Add rate limiting',
  body: 'Adds a limiter.',
  headSha: 'sha-head',
  owner: 'acme',
  name: 'api',
  clonePath: '/clone',
};

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [
        { path: 'src/a.ts', additions: 10, deletions: 2, finding_lines: [] },
        { path: 'src/b.ts', additions: 3, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 15, proposed_splits: [] },
};

const BLAST: BlastRadius = {
  changed_symbols: [{ name: 'f', file: 'src/a.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'f',
      callers: [{ name: 'main', file: 'src/c.ts', line: 31 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: 'one caller',
  degraded: false,
  reason: null,
};

const INTENT = {
  intent: 'Rate limit the API',
  in_scope: ['middleware'],
  out_of_scope: [],
  stale: false,
} as unknown as PrIntentRecord;

const DRAFT: BriefDraft = {
  summary: 'Adds a limiter.',
  risks: [
    { kind: 'security', title: 'Spoofable key', explanation: 'e', severity: 'high', file_refs: ['src/a.ts:3-9', 'ghost.ts'] },
    { kind: 'x', title: 'Ghost only', explanation: 'e', severity: 'low', file_refs: ['ghost.ts'] },
    { kind: 'compat', title: 'Caller only in the blast map', explanation: 'e', severity: 'medium', file_refs: ['src/c.ts:31'] },
  ],
  review_focus: [
    { file: 'src/a.ts', line: 3, reason: 'refill math' },
    { file: 'ghost.ts', line: 1, reason: 'invented' },
  ],
};

type Req = StructuredRequest<unknown>;

function llmReturning(
  impl: (req: Req, n: number) => Promise<StructuredResult<unknown>>,
): LLMProvider & { calls: Req[] } {
  const calls: Req[] = [];
  return {
    id: 'openai',
    calls,
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
    completeStructured: (async (req: Req) => {
      calls.push(req);
      return impl(req, calls.length);
    }) as LLMProvider['completeStructured'],
  };
}

const okResult = (over: Partial<StructuredResult<unknown>> = {}): StructuredResult<unknown> => ({
  data: DRAFT,
  model: 'gpt-4.1',
  tokensIn: 1200,
  tokensOut: 300,
  costUsd: 0.01,
  raw: '{}',
  attempts: 1,
  ...over,
});

interface Opts {
  pr?: BriefPr | null;
  smartDiff?: SmartDiff;
  blast?: () => Promise<BlastRadius | null>;
  intent?: () => Promise<PrIntentRecord | null>;
  getIssue?: BriefDeps['github']['getIssue'];
  docs?: { path: string; content: string }[];
  llm?: LLMProvider & { calls: Req[] };
  llmError?: Error;
  model?: unknown;
  count?: (s: string) => number;
  now?: () => number;
  stored?: PrBriefRecord | null;
}

function build(opts: Opts = {}) {
  const saved: PrBriefRecord[] = [];
  const logs: { level: string; obj: Record<string, unknown>; msg?: string }[] = [];
  const llm = opts.llm ?? llmReturning(async () => okResult());
  const counters = { intent: 0, blast: 0, github: 0, docs: 0, smartDiff: 0, llmResolve: 0 };
  let stored = opts.stored ?? null;
  const pr = opts.pr === undefined ? PR : opts.pr;

  const deps: BriefDeps = {
    repo: {
      getPr: async () => pr,
      getBrief: async () => stored,
      saveBrief: async (_id, record) => {
        saved.push(record);
        stored = record;
      },
    },
    // Only `get` exists: a brief never derives an intent (EC-1).
    intent: {
      get: async () => {
        counters.intent += 1;
        return opts.intent ? opts.intent() : INTENT;
      },
    },
    blast: {
      forPull: async () => {
        counters.blast += 1;
        return opts.blast ? opts.blast() : BLAST;
      },
    },
    smartDiff: {
      get: async () => {
        counters.smartDiff += 1;
        return opts.smartDiff ?? SMART_DIFF;
      },
    },
    projectContext: {
      resolveForRepo: async () => {
        counters.docs += 1;
        const docs = opts.docs ?? [{ path: 'docs/one.md', content: 'DOC-BODY' }];
        return { docs, skipped: [], truncated: [], tokens: 1 };
      },
    },
    github: {
      getIssue:
        opts.getIssue ??
        (async (_repo, n) => {
          counters.github += 1;
          return { number: n, title: 'Rate-limit public endpoints', body: 'Spec text', state: 'open' };
        }),
    },
    resolveModel: async () =>
      ({ provider: 'openai', model: opts.model ?? 'gpt-4.1' }) as { provider: 'openai'; model: string },
    llm: async (provider) => {
      counters.llmResolve += 1;
      if (opts.llmError) throw opts.llmError;
      expect(provider).toBe('openai');
      return llm;
    },
    countTokens: opts.count ?? ((s) => Math.ceil(s.length / 4)),
    log: {
      info: (obj, msg) => logs.push({ level: 'info', obj: obj as Record<string, unknown>, msg }),
      warn: (obj, msg) => logs.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
    },
    timeoutMs: 120_000,
    adapterTimeoutMs: 125_000,
    staleMs: 10 * 60_000,
    now: opts.now,
  };
  return { svc: new BriefService(deps), llm, saved, logs, counters };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the call to fail');
}

const NFR9_KEYS = [
  'costUsd',
  'durationMs',
  'headSha',
  'inputTokens',
  'model',
  'modelCalls',
  'outcome',
  'prId',
  'provider',
  'removed',
  'tokensIn',
  'tokensOut',
  'trimmed',
];

afterEach(() => {
  vi.useRealTimers();
});

describe('BriefService.generate — the one call', () => {
  it('makes exactly one completeStructured call with the pinned options and reads (never derives) the intent', async () => {
    const { svc, llm, counters } = build();
    const page = await svc.generate(WS, PR.id);

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({
      maxRetries: 0,
      temperature: 0,
      timeoutMs: 125000,
      schemaName: 'PrBriefDraft',
      model: 'gpt-4.1',
    });
    expect(counters.intent).toBe(1);
    expect(page!.brief).not.toBeNull();
  });

  it('stores a grounded, capped record with the resolved provider/model; unknown cost stays null', async () => {
    const llm = llmReturning(async () => okResult({ costUsd: null }));
    const { svc, saved, logs } = build({ llm });
    await svc.generate(WS, PR.id);

    expect(saved).toHaveLength(1);
    const rec = saved[0]!;
    expect(rec.provider).toBe('openai');
    expect(rec.model).toBe('gpt-4.1');
    expect(rec.head_sha).toBe('sha-head');
    expect(rec.cost_usd).toBeNull();
    expect(rec.tokens_in).toBe(1200);
    expect(rec.input_tokens).toBeGreaterThan(0);
    // a blast-map caller is a valid target; the ghost ref and the ghost-only risk are gone
    expect(rec.risks.map((r) => r.file_refs)).toEqual([['src/a.ts:3-9'], ['src/c.ts:31']]);
    expect(rec.review_focus).toEqual([{ file: 'src/a.ts', line: 3, reason: 'refill math' }]);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe('info');
    expect(logs[0]!.msg).toBe('pr brief generation');
    expect(logs[0]!.obj).toMatchObject({
      costUsd: null,
      modelCalls: 1,
      outcome: 'ok',
      removed: { risks: 1, refs: 2, focus: 1 },
    });
    expect(Object.keys(logs[0]!.obj).sort()).toEqual(NFR9_KEYS);
  });

  it('sends the linked issue to the model and uses the PR repo for the lookup', async () => {
    const seen: unknown[] = [];
    const { svc, llm, saved } = build({
      pr: { ...PR, body: 'Implements the limiter. Fixes #42' },
      getIssue: async (repo, n) => {
        seen.push([repo, n]);
        return { number: n, title: 'Rate-limit public endpoints', body: null, state: 'open' };
      },
    });
    await svc.generate(WS, PR.id);
    expect(seen).toEqual([[{ owner: 'acme', name: 'api' }, 42]]);
    const user = llm.calls[0]!.messages[1]!.content;
    expect(user).toContain('<untrusted source="linked_issue">');
    expect(user).toContain('Rate-limit public endpoints');
    expect(saved[0]!.missing_facts.some((f) => f.fact === 'linked_issue')).toBe(false);
  });
});

describe('BriefService.generate — lock (EC-5, NFR-8)', () => {
  function deferredLlm() {
    const resolvers: Array<() => void> = [];
    const llm = llmReturning(
      () =>
        new Promise<StructuredResult<unknown>>((resolve) => {
          resolvers.push(() => resolve(okResult()));
        }),
    );
    return { llm, resolvers };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a second generate while the first is pending is a 409 and makes no second call', async () => {
    const { llm, resolvers } = deferredLlm();
    const { svc } = build({ llm });
    const first = svc.generate(WS, PR.id);
    await tick();
    expect(llm.calls).toHaveLength(1);

    const err = await failure(svc.generate(WS, PR.id));
    expect(err.code).toBe('brief_running');
    expect(err.statusCode).toBe(409);
    expect(llm.calls).toHaveLength(1);
    expect((await svc.page(WS, PR.id))!.generating).toBe(true);

    resolvers[0]!();
    await first;
    expect((await svc.page(WS, PR.id))!.generating).toBe(false);
  });

  it('a mark older than 10 minutes no longer blocks, and an earlier call finishing does not clear a newer mark', async () => {
    let t = 1_000_000;
    const { llm, resolvers } = deferredLlm();
    const { svc } = build({ llm, now: () => t });

    const first = svc.generate(WS, PR.id);
    await tick();
    t += 10 * 60_000 + 1;
    const second = svc.generate(WS, PR.id);
    await tick();
    expect(llm.calls).toHaveLength(2);

    resolvers[0]!();
    await first;
    // the first one's finally must not have cleared the second's mark
    expect((await svc.page(WS, PR.id))!.generating).toBe(true);
    expect((await failure(svc.generate(WS, PR.id))).code).toBe('brief_running');

    resolvers[1]!();
    await second;
    expect((await svc.page(WS, PR.id))!.generating).toBe(false);
  });
});

describe('BriefService.generate — refusals make no model call', () => {
  it('422 no_changed_files', async () => {
    const { svc, llm, logs } = build({
      smartDiff: { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } },
    });
    const err = await failure(svc.generate(WS, PR.id));
    expect(err.code).toBe('no_changed_files');
    expect(err.statusCode).toBe(422);
    expect(llm.calls).toHaveLength(0);
    expect(logs[0]!.obj).toMatchObject({ modelCalls: 0, outcome: 'no_changed_files' });
  });

  it('422 provider_key_missing names the provider and reads nothing else', async () => {
    const { svc, llm, counters, logs } = build({ llmError: new ConfigError('OPENAI_API_KEY is not configured') });
    const err = await failure(svc.generate(WS, PR.id));
    expect(err.code).toBe('provider_key_missing');
    expect(err.statusCode).toBe(422);
    expect(err.details).toEqual({ provider: 'openai' });
    expect(llm.calls).toHaveLength(0);
    expect(counters.github + counters.blast + counters.intent + counters.docs).toBe(0);
    expect(logs[0]!.obj).toMatchObject({ modelCalls: 0, provider: 'openai' });
  });

  it('422 brief_input_too_large when the untrimmable part alone is over budget', async () => {
    const { svc, llm, logs } = build({ pr: { ...PR, title: 'x'.repeat(100_000) }, count: (s) => s.length });
    const err = await failure(svc.generate(WS, PR.id));
    expect(err.code).toBe('brief_input_too_large');
    expect(err.statusCode).toBe(422);
    expect(llm.calls).toHaveLength(0);
    expect(logs[0]!.obj).toMatchObject({ modelCalls: 0, outcome: 'brief_input_too_large' });
  });

  it('404 (null) for an unknown PR, with no log line', async () => {
    const { svc, logs, llm } = build({ pr: null });
    expect(await svc.generate(WS, 'nope')).toBeNull();
    expect(await svc.page(WS, 'nope')).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });
});

describe('BriefService.generate — failures store nothing (EC-3, NFR-3)', () => {
  const SECRETS = ['SECRET-RAW', 'SECRET-MSG'];

  async function expectFailure(llm: LLMProvider & { calls: Req[] }, reason: string, run?: () => Promise<void>) {
    const { svc, saved, logs } = build({ llm });
    const p = failure(svc.generate(WS, PR.id));
    if (run) await run();
    const err = await p;
    expect(err.code).toBe('brief_failed');
    expect(err.statusCode).toBe(502);
    expect(err.details).toEqual({ reason });
    expect(saved).toHaveLength(0);
    expect(llm.calls).toHaveLength(1);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe('warn');
    expect(logs[0]!.obj).toMatchObject({ outcome: reason, modelCalls: 1 });
    expect(Object.keys(logs[0]!.obj).sort()).toEqual(NFR9_KEYS);
    const dump = JSON.stringify(logs);
    for (const s of SECRETS) expect(dump).not.toContain(s);
    // the thrown AppError does not leak them either
    for (const s of SECRETS) expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(s);
  }

  it('timeout: the service timer fires at 120 s when the provider never answers', async () => {
    vi.useFakeTimers();
    const llm = llmReturning(() => new Promise(() => undefined));
    const { svc, saved, logs } = build({ llm });
    let settled = false;
    const p = failure(svc.generate(WS, PR.id)).then((e) => {
      settled = true;
      return e;
    });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const err = await p;
    expect(err.details).toEqual({ reason: 'timeout' });
    expect(saved).toHaveLength(0);
    expect(logs[0]!.obj).toMatchObject({ outcome: 'timeout', modelCalls: 1 });
  });

  it('invalid_output: a StructuredOutputError carrying the raw model output', async () => {
    await expectFailure(
      llmReturning(async () => {
        throw new StructuredOutputError('bad shape', { raw: 'SECRET-RAW' });
      }),
      'invalid_output',
    );
  });

  it('invalid_output: a ZodError by name', async () => {
    await expectFailure(
      llmReturning(async () => {
        const e = new Error('SECRET-MSG');
        e.name = 'ZodError';
        throw e;
      }),
      'invalid_output',
    );
  });

  it('llm_error: a plain Error', async () => {
    await expectFailure(
      llmReturning(async () => {
        throw new Error('SECRET-MSG');
      }),
      'llm_error',
    );
  });

  it('llm_error: a TimeoutError from the provider is not the service timeout', async () => {
    await expectFailure(
      llmReturning(async () => {
        throw new TimeoutError(125_000);
      }),
      'llm_error',
    );
  });

  it('a record that fails PrBriefRecord is not stored (502 invalid_output)', async () => {
    const { svc, saved, logs, llm } = build({ model: 42 });
    const err = await failure(svc.generate(WS, PR.id));
    expect(err.code).toBe('brief_failed');
    expect(err.details).toEqual({ reason: 'invalid_output' });
    expect(llm.calls).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(logs[0]!.obj).toMatchObject({ outcome: 'invalid_output' });
  });

  it('keeps the previous brief when a re-run fails', async () => {
    const stored = {
      summary: 'old',
      risks: [],
      review_focus: [],
      missing_facts: [],
      head_sha: 'sha-head',
      provider: 'openai',
      model: 'gpt-4.1',
      input_tokens: 1,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      generated_at: '2026-01-01T00:00:00.000Z',
    } satisfies PrBriefRecord;
    const llm = llmReturning(async () => {
      throw new Error('boom');
    });
    const { svc } = build({ llm, stored });
    await failure(svc.generate(WS, PR.id));
    expect((await svc.page(WS, PR.id))!.brief).toEqual(stored);
  });
});

describe('BriefService.generate — missing facts (AC-7, EC-1, EC-2)', () => {
  it('a throwing blast port is recorded as unavailable, and the file check uses changed files only', async () => {
    const { svc, saved } = build({
      blast: async () => {
        throw new Error('index down');
      },
    });
    await svc.generate(WS, PR.id);
    const rec = saved[0]!;
    expect(rec.missing_facts).toContainEqual({ fact: 'blast', status: 'unavailable', detail: null });
    // src/c.ts is only a blast caller: without a blast map it is not a valid target
    expect(rec.risks.map((r) => r.file_refs)).toEqual([['src/a.ts:3-9']]);
  });

  it('a degraded blast is listed with its reason', async () => {
    const { svc, saved } = build({ blast: async () => ({ ...BLAST, degraded: true, reason: 'index_stale' }) });
    await svc.generate(WS, PR.id);
    expect(saved[0]!.missing_facts).toContainEqual({ fact: 'blast', status: 'degraded', detail: 'index_stale' });
  });

  it('a GitHub ConfigError is linked_issue/missing_token with the issue number', async () => {
    const { svc, saved } = build({
      pr: { ...PR, body: 'Fixes #42' },
      getIssue: async () => {
        throw new ConfigError('GITHUB_TOKEN is not configured');
      },
    });
    await svc.generate(WS, PR.id);
    expect(saved[0]!.missing_facts).toContainEqual({ fact: 'linked_issue', status: 'missing_token', detail: '42' });
  });

  it('no intent: generated without it, listed as absent', async () => {
    const { svc, saved, llm } = build({ intent: async () => null });
    await svc.generate(WS, PR.id);
    expect(saved[0]!.missing_facts).toContainEqual({ fact: 'intent', status: 'absent', detail: null });
    expect(llm.calls[0]!.messages[1]!.content).not.toContain('source="intent"');
  });

  it('trim facts are stored after the base facts', async () => {
    const { svc, saved } = build({
      docs: [{ path: 'docs/huge.md', content: 'x'.repeat(40_000) }],
      count: (s) => Math.ceil(s.length / 4),
    });
    await svc.generate(WS, PR.id);
    expect(saved[0]!.missing_facts).toContainEqual({ fact: 'project_context', status: 'dropped', detail: 'docs/huge.md' });
  });
});

describe('BriefService.page', () => {
  it('makes no LLM, blast, intent, GitHub, smart-diff or document call, and marks a different head as stale', async () => {
    const stored = {
      summary: 's',
      risks: [],
      review_focus: [],
      missing_facts: [],
      head_sha: 'older-sha',
      provider: 'openai',
      model: 'gpt-4.1',
      input_tokens: 1,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      generated_at: '2026-01-01T00:00:00.000Z',
    } satisfies PrBriefRecord;
    const { svc, llm, counters } = build({ stored });
    const page = await svc.page(WS, PR.id);
    expect(page).toEqual({ brief: stored, stale: true, head_sha: 'sha-head', generating: false });
    expect(llm.calls).toHaveLength(0);
    expect(Object.values(counters).every((n) => n === 0)).toBe(true);
  });

  it('no stored brief: brief null and never stale', async () => {
    const { svc } = build();
    expect(await svc.page(WS, PR.id)).toEqual({ brief: null, stale: false, head_sha: 'sha-head', generating: false });
  });
});
