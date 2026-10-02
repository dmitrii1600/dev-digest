import { describe, expect, it } from 'vitest';
import { Onboarding as OnboardingSchema } from '@devdigest/shared';
import type { LLMProvider, Onboarding, OnboardingDraft, StructuredRequest } from '@devdigest/shared';
import { MAX_COMMANDS, MAX_CRITICAL_PATHS, MAX_READING_PATH, MAX_TASKS } from '../src/modules/onboarding/constants.js';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import type { RepoBasics } from '../src/modules/onboarding/repository.js';
import {
  groundDraft,
  groundedPathSet,
  isSecretEnvFile,
  type PromptInput,
  type SourceText,
} from '../src/modules/onboarding/helpers.js';
import { AppError, StructuredOutputError } from '../src/platform/errors.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

/**
 * Onboarding generator — the limits and failure edges that `onboarding-service.test.ts`
 * and `onboarding-helpers.test.ts` do not reach: section caps through the real service
 * (AC-6 / AC-8 cap at the call site, not only in the helper), the 256 KB stored-tour
 * guard (NFR-3), grounding against what the *trimmed* prompt carried (AC-16 x NFR-3),
 * the real provider "schema validation" messages mapping to `invalid_output` (EC-4),
 * and the text caps on tasks and commands (NFR-3, A8).
 *
 * Hermetic: in-memory fakes for every port, no Postgres, no Container — so a plain
 * `*.test.ts`, not an `.it`.
 */

const WS = 'ws-1';
const REPO: RepoBasics = { id: 'repo-1', name: 'api', fullName: 'acme/api', defaultBranch: 'main', clonePath: '/clone' };
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

const EMPTY_DRAFT: OnboardingDraft = { architecture: 'x', diagram: null, file_reasons: [], commands: [], first_tasks: [] };

interface Opts {
  reading?: string[];
  chains?: string[][];
  ranks?: Record<string, number>;
  runSources?: SourceText[];
  draft?: OnboardingDraft;
  llm?: () => Promise<LLMProvider>;
  llmProvider?: LLMProvider;
  count?: (s: string) => number;
}

function build(opts: Opts = {}) {
  const saved: Onboarding[] = [];
  const logs: { obj: Record<string, unknown> }[] = [];
  const mock = new MockLLMProvider('openai', { structuredBySchema: { OnboardingDraft: opts.draft ?? EMPTY_DRAFT } });
  const provider = opts.llmProvider ?? mock;
  const reading = opts.reading ?? ['src/a.ts'];
  const chains = opts.chains ?? [];
  const ranks = opts.ranks ?? {};

  const index: Pick<RepoIntel, 'getIndexState' | 'getTopFilesByRank' | 'getCriticalPaths' | 'getFileRank' | 'getRepoMap'> = {
    getIndexState: async () => STATE,
    // honours `n` like the real facade, so a service that asks for too many shows up
    getTopFilesByRank: async (_id, n) => reading.slice(0, n),
    getCriticalPaths: async () => chains,
    getFileRank: async (_id, paths) =>
      paths.filter((p) => p in ranks).map((p) => ({ path: p, percentile: 0.5, rank: ranks[p]! })),
    getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
  };

  const svc = new OnboardingService({
    repo: {
      getRepo: async () => REPO,
      getTour: async () => saved[saved.length - 1] ?? null,
      saveTour: async (_id, tour) => {
        saved.push(tour);
      },
    },
    index,
    files: {
      readRunSources: async () => opts.runSources ?? [],
      readExcerpts: async (_p, paths) => paths.map((path) => ({ path, text: `// ${path}` })),
    },
    resolveModel: async () => ({ provider: 'openrouter', model: 'm-1' }),
    llm: opts.llm ?? (async () => provider),
    countTokens: opts.count ?? (() => 1),
    log: {
      info: (obj) => logs.push({ obj: obj as Record<string, unknown> }),
      warn: (obj) => logs.push({ obj: obj as Record<string, unknown> }),
    },
    repoIntelEnabled: true,
    timeoutMs: 1000,
    staleMs: 10 * 60_000,
  });
  return { svc, mock, saved, logs };
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

function llmThatThrows(err: Error): LLMProvider {
  return {
    id: 'openai',
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
    completeStructured: async () => {
      throw err;
    },
  };
}

describe('OnboardingService — section caps at the call site', () => {
  it('AC-6 / AC-8: asks the index for 8 reading-path files and keeps 6 critical paths in rank order; passes the Settings model', async () => {
    const reading = Array.from({ length: 10 }, (_, i) => `src/r${i}.ts`);
    const chainFiles = Array.from({ length: 8 }, (_, i) => `src/c${i}.ts`);
    // c0 has the lowest rank, c7 the highest → critical order is c7, c6, … c2 (c1, c0 cut)
    const ranks = Object.fromEntries(chainFiles.map((p, i) => [p, (i + 1) / 10]));
    const { svc, mock } = build({ reading, chains: [chainFiles.slice(0, 4), chainFiles.slice(4)], ranks });

    const tour = (await svc.generate(WS, REPO.id))!.tour!;

    expect(tour.reading_path.map((f) => f.path)).toEqual(reading.slice(0, 8));
    expect(tour.critical_paths.map((f) => f.path)).toEqual(['src/c7.ts', 'src/c6.ts', 'src/c5.ts', 'src/c4.ts', 'src/c3.ts', 'src/c2.ts']);
    expect((mock.calls[0]!.req as StructuredRequest<unknown>).model).toBe('m-1');
  });
});

describe('OnboardingService — NFR-3 stored-size guard', () => {
  it('a tour over 256 KB is not stored: 502 invalid_output, the log line says so', async () => {
    // Index paths are not capped by the model-text rules, so oversized ones are the way in.
    const reading = Array.from({ length: 8 }, (_, i) => `src/${'d'.repeat(40_000)}${i}.ts`);
    const { svc, saved, logs } = build({ reading });

    const err = (await failure(svc.generate(WS, REPO.id))) as AppError;

    expect([err.code, err.statusCode, err.details]).toEqual(['generation_failed', 502, { reason: 'invalid_output' }]);
    expect(saved).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.obj.outcome).toBe('invalid_output');
    // and the lock is released
    expect((await svc.page(WS, REPO.id))!.generating).toBe(false);
  });
});

describe('OnboardingService — AC-16 grounds against what the trimmed prompt carried', () => {
  it('a command citing a run source that was dropped for the token budget is removed; one citing a kept source survives; listed files stay citable', async () => {
    const draft: OnboardingDraft = {
      ...EMPTY_DRAFT,
      commands: [
        { line: 'make start', source_path: 'README.md' },
        { line: 'npm run dev', source_path: 'package.json' },
      ],
      first_tasks: [{ text: 'Read the entry', paths: ['src/a.ts'], complexity: 'low' }],
    };
    // Over budget only while `package.json` is in the prompt. fitToBudget drops excerpts
    // first (still over), then run sources from the END of the allowlist — package.json.
    const { svc, mock } = build({
      draft,
      runSources: [
        { path: 'README.md', text: 'readme' },
        { path: 'package.json', text: '{}' },
      ],
      count: (s) => (s.includes('file:package.json') ? 60_001 : 100),
    });

    const tour = (await svc.generate(WS, REPO.id))!.tour!;

    const user = (mock.calls[0]!.req as StructuredRequest<unknown>).messages[1]!.content;
    expect(user).not.toContain('file:package.json');
    expect(user).not.toContain('excerpt:src/a.ts');
    expect(tour.run_locally).toEqual([{ line: 'make start', source_path: 'README.md' }]);
    // src/a.ts is a listed (index-chosen) file: its path was in the prompt even though its excerpt was dropped.
    expect(tour.first_tasks).toEqual([{ text: 'Read the entry', paths: ['src/a.ts'], complexity: 'low' }]);
  });
});

describe('OnboardingService — EC-4 failure classification by the typed signal', () => {
  // The service branches on `StructuredOutputError` (thrown by the openai/anthropic adapters,
  // the Mock, and the OpenRouter wrapper) — never on message text. A plain Error that merely
  // talks about a schema is an `llm_error`.
  const cases: [string, Error][] = [
    ['openai/anthropic adapter', new StructuredOutputError('OpenAI structured output failed schema validation', { attempts: 1 })],
    ['typed error with other wording', new StructuredOutputError('anything at all')],
  ];
  it.each(cases)('%s schema failure → 502 generation_failed / invalid_output, nothing stored', async (_name, error) => {
    const { svc, saved } = build({ llmProvider: llmThatThrows(error) });
    const err = (await failure(svc.generate(WS, REPO.id))) as AppError;
    expect([err.code, err.statusCode, err.details]).toEqual(['generation_failed', 502, { reason: 'invalid_output' }]);
    expect(saved).toHaveLength(0);
  });

  it('a plain Error whose message mentions schema validation is NOT classified by its prose: llm_error', async () => {
    const { svc, saved } = build({ llmProvider: llmThatThrows(new Error('failed schema validation')) });
    const err = (await failure(svc.generate(WS, REPO.id))) as AppError;
    expect(err.details).toEqual({ reason: 'llm_error' });
    expect(saved).toHaveLength(0);
  });

  it('a real model output that does not match the tour shape (via the Mock) is invalid_output', async () => {
    const bad = { architecture: 42 } as unknown as OnboardingDraft;
    const { svc, saved } = build({ draft: bad });
    const err = (await failure(svc.generate(WS, REPO.id))) as AppError;
    expect(err.details).toEqual({ reason: 'invalid_output' });
    expect(saved).toHaveLength(0);
  });

  it('EC-5 is only for a missing key: any other error from llm() is not reported as provider_key_missing', async () => {
    const { svc } = build({
      llm: async () => {
        throw new Error('socket hang up');
      },
    });
    const err = (await failure(svc.generate(WS, REPO.id))) as Error;
    expect((err as AppError).code).not.toBe('provider_key_missing');
    expect(err.message).toBe('socket hang up');
    expect((await svc.page(WS, REPO.id))!.generating).toBe(false);
  });
});

describe('groundDraft — text caps (NFR-3, A8)', () => {
  const base: PromptInput = {
    repoFullName: 'acme/api',
    readingPath: ['src/a.ts'],
    criticalPaths: [],
    runSources: [{ path: 'README.md', text: 'r' }],
    excerpts: [{ path: 'src/a.ts', text: 'a' }],
    repoMap: '',
  };
  const ctx = { readingPath: base.readingPath, criticalPaths: base.criticalPaths, grounded: groundedPathSet(base) };
  const draft = (over: Partial<OnboardingDraft>): OnboardingDraft => ({ ...EMPTY_DRAFT, ...over });

  it('a 201-char task becomes 200 chars ending in an ellipsis; the 6th task is cut and counted', () => {
    const tasks = [
      { text: 'x'.repeat(201), paths: ['src/a.ts'] },
      ...Array.from({ length: 5 }, (_, i) => ({ text: `task ${i}`, paths: ['src/a.ts'] })),
    ];
    const out = groundDraft(draft({ first_tasks: tasks }), ctx);
    expect(out.first_tasks).toHaveLength(5);
    expect(out.first_tasks[0]!.text).toHaveLength(200);
    expect(out.first_tasks[0]!.text.endsWith('…')).toBe(true);
    expect(out.removed.first_tasks).toBe(1);
  });

  it('a 301-char command is removed, a 300-char one is kept', () => {
    const out = groundDraft(
      draft({
        commands: [
          { line: 'c'.repeat(301), source_path: 'README.md' },
          { line: 'c'.repeat(300), source_path: 'README.md' },
        ],
      }),
      ctx,
    );
    expect(out.run_locally.map((c) => c.line.length)).toEqual([300]);
    expect(out.removed.run_locally).toBe(1);
  });

  it('two reasons for one path: the first wins and the repeat is counted; newlines in a reason collapse to one line', () => {
    const out = groundDraft(
      draft({
        file_reasons: [
          { path: 'src/a.ts', reason: 'first\n  line two' },
          { path: 'src/a.ts', reason: 'second' },
        ],
      }),
      ctx,
    );
    expect(out.reading_path).toEqual([{ path: 'src/a.ts', reason: 'first line two' }]);
    expect(out.removed.reading_path).toBe(1);
  });
});

describe('isSecretEnvFile — case-insensitive (NFR-5)', () => {
  it('.ENV is secret, a template in any case is not', () => {
    expect(isSecretEnvFile('.ENV')).toBe(true);
    expect(isSecretEnvFile('.Env.Production')).toBe(true);
    expect(isSecretEnvFile('.ENV.EXAMPLE')).toBe(false);
  });
});

describe('section caps — the contract and the module constants agree (one source of truth)', () => {
  // The contract (ring 0) carries `.max(n)` and the module constants drive the service; a
  // drift would make the service emit a tour the contract (and the 200 response) rejects.
  const maxOf = (key: keyof typeof OnboardingSchema.shape): number | undefined =>
    (OnboardingSchema.shape[key] as unknown as { _def: { maxLength: { value: number } | null } })._def.maxLength?.value;

  it.each([
    ['reading_path', MAX_READING_PATH],
    ['critical_paths', MAX_CRITICAL_PATHS],
    ['run_locally', MAX_COMMANDS],
    ['first_tasks', MAX_TASKS],
  ] as const)('%s: constant equals the contract array maximum', (key, constant) => {
    expect(maxOf(key)).toBe(constant);
  });
});
