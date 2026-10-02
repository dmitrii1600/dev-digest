import { describe, expect, it } from 'vitest';
import type { LLMProvider, Onboarding, OnboardingDraft, StructuredRequest } from '@devdigest/shared';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import type { RepoBasics } from '../src/modules/onboarding/repository.js';
import { AppError, ConfigError } from '../src/platform/errors.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

/** Hermetic: in-memory fakes for every port, a Mock LLM, no Postgres, no Container. */

const WS = 'ws-1';
const REPO: RepoBasics = {
  id: 'repo-1',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  clonePath: '/clone',
};

const RANKS: Record<string, number> = {
  'src/a.ts': 0.9,
  'src/b.ts': 0.5,
  'src/c.ts': 0.5,
  'src/d.ts': 0.1,
};

const STATE: IndexState = {
  repoId: REPO.id,
  status: 'full',
  filesIndexed: 42,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'sha1',
  indexerVersion: 1,
  updatedAt: new Date(0),
};

const DRAFT: OnboardingDraft = {
  architecture: 'The system.',
  diagram: null,
  file_reasons: [
    { path: 'src/a.ts', reason: 'entry' },
    { path: 'src/invented.ts', reason: 'ghost' },
  ],
  commands: [
    { line: 'npm run dev', source_path: 'package.json' },
    { line: 'npm run ghost', source_path: 'src/invented.ts' },
  ],
  first_tasks: [{ text: 'Read a', paths: ['src/a.ts'], complexity: 'low' }],
};

interface Opts {
  repo?: RepoBasics | null;
  state?: IndexState;
  reading?: string[];
  chains?: string[][];
  enabled?: boolean;
  llm?: () => Promise<LLMProvider>;
  llmProvider?: LLMProvider;
  timeoutMs?: number;
  count?: (s: string) => number;
  now?: () => number;
  stored?: Onboarding | null;
}

function build(opts: Opts = {}) {
  const saved: Onboarding[] = [];
  const logs: { level: string; obj: Record<string, unknown>; msg?: string }[] = [];
  const mock = new MockLLMProvider('openai', { structuredBySchema: { OnboardingDraft: DRAFT } });
  const provider: LLMProvider = opts.llmProvider ?? mock;
  const reading = opts.reading ?? ['src/a.ts', 'src/b.ts', 'src/c.ts'];
  const chains = opts.chains ?? [['src/a.ts', 'src/d.ts']];
  let stored = opts.stored ?? null;
  const repo = opts.repo === undefined ? REPO : opts.repo;

  const index: Pick<
    RepoIntel,
    'getIndexState' | 'getTopFilesByRank' | 'getCriticalPaths' | 'getFileRank' | 'getRepoMap'
  > = {
    getIndexState: async () => opts.state ?? STATE,
    getTopFilesByRank: async (_id, n) => reading.slice(0, n),
    getCriticalPaths: async () => chains,
    getFileRank: async (_id, paths) =>
      paths.filter((p) => p in RANKS).map((p) => ({ path: p, percentile: 0.5, rank: RANKS[p]! })),
    getRepoMap: async () => ({ text: 'repo map', tokens: 1, cached: false }),
  };

  const svc = new OnboardingService({
    repo: {
      getRepo: async () => repo,
      getTour: async () => stored,
      saveTour: async (_id, tour) => {
        saved.push(tour);
        stored = tour;
      },
    },
    index,
    files: {
      readRunSources: async () => [{ path: 'package.json', text: '{"scripts":{"dev":"x"}}' }],
      readExcerpts: async (_p, paths) => paths.map((path) => ({ path, text: `// ${path}` })),
    },
    resolveModel: async () => ({ provider: 'openrouter', model: 'm-1' }),
    llm: opts.llm ?? (async () => provider),
    countTokens: opts.count ?? ((s) => Math.ceil(s.length / 4)),
    log: {
      info: (obj, msg) => logs.push({ level: 'info', obj: obj as Record<string, unknown>, msg }),
      warn: (obj, msg) => logs.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
    },
    repoIntelEnabled: opts.enabled ?? true,
    timeoutMs: opts.timeoutMs ?? 1000,
    staleMs: 10 * 60_000,
    now: opts.now,
  });
  return { svc, mock, saved, logs };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected a rejection');
}

describe('OnboardingService.generate', () => {
  it('AC-5 / NFR-1: exactly one completeStructured call, maxRetries 0; AC-7: the files are the index order', async () => {
    const { svc, mock, saved } = build();
    const page = await svc.generate(WS, REPO.id);

    expect(mock.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    const req = mock.calls[0]!.req as StructuredRequest<unknown>;
    expect(req.maxRetries).toBe(0);
    expect(req.schemaName).toBe('OnboardingDraft');

    expect(saved).toHaveLength(1);
    const tour = page!.tour!;
    expect(tour.reading_path.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(tour.reading_path[0]!.reason).toBe('entry');
    expect(tour.reading_path[1]!.reason).toBeNull();
    // critical files: rank desc then path asc over the distinct chain files
    expect(tour.critical_paths.map((f) => f.path)).toEqual(['src/a.ts', 'src/d.ts']);
    // AC-16 (amended): the invented path never survives; package.json (a run source) does
    expect(tour.run_locally).toEqual([{ line: 'npm run dev', source_path: 'package.json' }]);
    expect(tour.provider).toBe('openrouter');
    expect(tour.model).toBe('m-1');
    expect(tour.index_sha).toBe('sha1');
    expect(tour.files_indexed).toBe(42);
    expect(page!.generating).toBe(false);
  });

  it('returns null for an unknown repo', async () => {
    const { svc } = build({ repo: null });
    expect(await svc.generate(WS, 'nope')).toBeNull();
    expect(await svc.page(WS, 'nope')).toBeNull();
  });

  it('EC-2: no clone → 422 repo_not_cloned', async () => {
    const { svc, mock } = build({ repo: { ...REPO, clonePath: null } });
    const err = await failure(svc.generate(WS, REPO.id));
    expect([err.code, err.statusCode]).toEqual(['repo_not_cloned', 422]);
    expect(mock.calls).toHaveLength(0);
  });

  it('EC-3: flag_off and no_ranked_files → 422 repo_not_indexed, zero LLM calls', async () => {
    const off = build({ enabled: false, reading: [] });
    const e1 = await failure(off.svc.generate(WS, REPO.id));
    expect([e1.code, e1.statusCode, e1.details]).toEqual(['repo_not_indexed', 422, { reason: 'flag_off' }]);
    expect(off.mock.calls).toHaveLength(0);

    const empty = build({ reading: [] });
    const e2 = await failure(empty.svc.generate(WS, REPO.id));
    expect(e2.details).toEqual({ reason: 'no_ranked_files' });
    expect(empty.mock.calls).toHaveLength(0);
  });

  it('EC-5: ConfigError from llm() → 422 provider_key_missing; nothing saved, no call', async () => {
    const { svc, mock, saved } = build({
      llm: async () => {
        throw new ConfigError('no key');
      },
    });
    const err = await failure(svc.generate(WS, REPO.id));
    expect([err.code, err.statusCode, err.details]).toEqual([
      'provider_key_missing',
      422,
      { provider: 'openrouter' },
    ]);
    expect(saved).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('EC-6 / AC-15: a second generate while the first awaits → 409, one LLM call; GET reports generating', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: unknown[] = [];
    const slow: LLMProvider = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      embed: async () => [],
      completeStructured: async <T>(req: StructuredRequest<T>) => {
        calls.push(req);
        await gate;
        return {
          data: req.schema.parse(DRAFT),
          model: req.model,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: null,
          raw: '',
          attempts: 1,
        };
      },
    };
    const { svc, saved } = build({ llmProvider: slow });

    const first = svc.generate(WS, REPO.id);
    await new Promise((r) => setTimeout(r, 10));
    expect((await svc.page(WS, REPO.id))!.generating).toBe(true);
    const err = await failure(svc.generate(WS, REPO.id));
    expect([err.code, err.statusCode]).toEqual(['generation_running', 409]);
    expect(calls).toHaveLength(1);

    release();
    const page = await first;
    expect(page!.generating).toBe(false);
    expect(page!.tour).not.toBeNull();
    expect(saved).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('NFR-8: a running mark older than 10 minutes no longer blocks', async () => {
    let t = 1_000;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: LLMProvider = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      embed: async () => [],
      completeStructured: async <T>(req: StructuredRequest<T>) => {
        await gate;
        return {
          data: req.schema.parse(DRAFT),
          model: req.model,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: null,
          raw: '',
          attempts: 1,
        };
      },
    };
    const { svc } = build({ llmProvider: slow, now: () => t });
    const first = svc.generate(WS, REPO.id);
    await new Promise((r) => setTimeout(r, 10));

    t += 10 * 60_000 - 1;
    expect((await failure(svc.generate(WS, REPO.id))).code).toBe('generation_running');
    t += 2;
    expect((await svc.page(WS, REPO.id))!.generating).toBe(false);
    const second = svc.generate(WS, REPO.id); // not blocked
    release();
    await Promise.all([first, second]);
  });

  it('EC-4: timeout, invalid output and a generic throw → 502 with the right reason; nothing saved; lock released', async () => {
    const make = (fn: () => Promise<never>): LLMProvider => ({
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      embed: async () => [],
      completeStructured: fn,
    });

    const cases: [string, LLMProvider][] = [
      ['timeout', make(() => new Promise<never>(() => {}))],
      [
        'invalid_output',
        make(async () => {
          const e = new Error('bad');
          e.name = 'ZodError';
          throw e;
        }),
      ],
      [
        'llm_error',
        make(async () => {
          throw new Error('boom');
        }),
      ],
    ];
    for (const [reason, llmProvider] of cases) {
      const { svc, saved } = build({ llmProvider, timeoutMs: 20 });
      const err = await failure(svc.generate(WS, REPO.id));
      expect([err.code, err.statusCode, err.details]).toEqual(['generation_failed', 502, { reason }]);
      expect(saved).toHaveLength(0);
      expect((await svc.page(WS, REPO.id))!.generating).toBe(false);
    }
  });

  it('the previous tour survives a failed generation', async () => {
    const previous = { repo_id: REPO.id, index_sha: 'old' } as Onboarding;
    const boom: LLMProvider = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      embed: async () => [],
      completeStructured: async () => {
        throw new Error('boom');
      },
    };
    const { svc, saved } = build({ llmProvider: boom, stored: previous });
    await failure(svc.generate(WS, REPO.id));
    expect(saved).toHaveLength(0);
    expect((await svc.page(WS, REPO.id))!.tour).toBe(previous);
  });

  it('NFR-9: one log line with every field; unknown cost stays null', async () => {
    const withNullCost: LLMProvider = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      embed: async () => [],
      completeStructured: async <T>(req: StructuredRequest<T>) => ({
        data: req.schema.parse(DRAFT),
        model: req.model,
        tokensIn: 7,
        tokensOut: 3,
        costUsd: null,
        raw: '',
        attempts: 1,
      }),
    };
    const { svc, logs } = build({ llmProvider: withNullCost });
    await svc.generate(WS, REPO.id);
    expect(logs).toHaveLength(1);
    const line = logs[0]!;
    expect(line.msg).toBe('onboarding generation');
    expect(Object.keys(line.obj).sort()).toEqual(
      ['costUsd', 'durationMs', 'model', 'outcome', 'provider', 'removed', 'repoId', 'tokensIn', 'tokensOut'].sort(),
    );
    expect(line.obj).toMatchObject({
      repoId: REPO.id,
      provider: 'openrouter',
      model: 'm-1',
      tokensIn: 7,
      tokensOut: 3,
      costUsd: null,
      outcome: 'ok',
    });
    expect(line.obj.removed).toMatchObject({ reading_path: 1, run_locally: 1 });
  });

  it('NFR-3: when the prompt overflows, the lowest-ranked excerpt is dropped first', async () => {
    // Over the 60k cap only while the lowest-ranked excerpt (src/d.ts, rank 0.1) is present.
    const { svc, mock } = build({ count: (s) => (s.includes('excerpt:src/d.ts') ? 60_001 : 100) });
    await svc.generate(WS, REPO.id);
    const user = (mock.calls[0]!.req as StructuredRequest<unknown>).messages[1]!.content;
    expect(user).not.toContain('excerpt:src/d.ts');
    expect(user).toContain('excerpt:src/a.ts');
    expect(user).toContain('file:package.json');
  });
});

describe('OnboardingService.page', () => {
  it('EC-9: stale when the index sha differs; never stale without a tour', async () => {
    const tour = { repo_id: REPO.id, index_sha: 'old' } as Onboarding;
    const stale = build({ stored: tour });
    expect((await stale.svc.page(WS, REPO.id))!.stale).toBe(true);
    const none = build();
    const page = await none.svc.page(WS, REPO.id);
    expect(page!.stale).toBe(false);
    expect(page!.tour).toBeNull();
    expect(page!.repo).toEqual({ name: 'api', full_name: 'acme/api', default_branch: 'main' });
  });

  it('NFR-4: works with the flag off and makes no LLM call', async () => {
    const tour = { repo_id: REPO.id, index_sha: 'sha1' } as Onboarding;
    const { svc, mock } = build({ enabled: false, stored: tour });
    expect((await svc.page(WS, REPO.id))!.tour).toBe(tour);
    expect(mock.calls).toHaveLength(0);
  });
});
