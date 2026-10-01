import {
  OnboardingDraft,
  type FeatureModelChoice,
  type LLMProvider,
  type Onboarding,
  type OnboardingPage,
} from '@devdigest/shared';
import { AppError, ConfigError } from '../../platform/errors.js';
import type { RepoIntel } from '../repo-intel/types.js';
import {
  MAX_CRITICAL_PATHS,
  MAX_INPUT_TOKENS,
  MAX_READING_PATH,
  MAX_STORED_BYTES,
  ONBOARDING_SCHEMA_NAME,
} from './constants.js';
import {
  buildMessages,
  fitToBudget,
  groundDraft,
  groundedPathSet,
  isStale,
  notIndexedReason,
  selectCriticalFiles,
  type PromptInput,
  type RemovedCounts,
  type SourceText,
} from './helpers.js';
import type { OnboardingRepository, RepoBasics } from './repository.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — onion rule 1. */
export interface OnboardingLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

type GenerationOutcome = 'ok' | 'timeout' | 'invalid_output' | 'llm_error';

/** Thrown by the service's own timer — mapped to `generation_failed` / `timeout`. */
class GenerationTimeout extends Error {}

/** A provider that reports "the structured output did not match the schema". */
function isSchemaFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'ZodError' || /schema validation|failed schema/i.test(err.message);
}

/**
 * Ring 2 — the onboarding use case. Takes its collaborators as constructor
 * arguments (onion rule 9); `routes.ts` wires them, so this is unit-tested
 * hermetically with plain fakes (no Postgres, no Container).
 *
 * Code picks the files (index rank, then path); the model writes only prose,
 * reasons, commands and tasks; code then drops every path the prompt did not
 * carry (AC-16 as amended) before the one stored row is replaced.
 */
export class OnboardingService {
  constructor(
    private readonly deps: {
      repo: Pick<OnboardingRepository, 'getRepo' | 'getTour' | 'saveTour'>;
      index: Pick<
        RepoIntel,
        'getIndexState' | 'getTopFilesByRank' | 'getCriticalPaths' | 'getFileRank' | 'getRepoMap'
      >;
      files: {
        readRunSources: (clonePath: string) => Promise<SourceText[]>;
        readExcerpts: (clonePath: string, paths: string[]) => Promise<SourceText[]>;
      };
      resolveModel: (workspaceId: string) => Promise<FeatureModelChoice>;
      llm: (provider: FeatureModelChoice['provider']) => Promise<LLMProvider>;
      countTokens: (text: string) => number;
      log: OnboardingLogger;
      repoIntelEnabled: boolean;
      /** The service's own timer on the one LLM call (D4). */
      timeoutMs: number;
      /** A running mark older than this no longer blocks a new generation (NFR-8). */
      staleMs: number;
      now?: () => number;
    },
  ) {}

  /** repoId → epoch ms the running generation started (D3, in-process, single instance). */
  private readonly running = new Map<string, number>();

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private isRunning(repoId: string): boolean {
    const startedAt = this.running.get(repoId);
    return startedAt !== undefined && this.now() - startedAt < this.deps.staleMs;
  }

  /** `null` → the route throws `NotFoundError`. Makes no LLM call (NFR-1) and works with the flag off (NFR-4). */
  async page(workspaceId: string, repoId: string): Promise<OnboardingPage | null> {
    const repo = await this.deps.repo.getRepo(workspaceId, repoId);
    if (!repo) return null;
    const [tour, state] = await Promise.all([
      this.deps.repo.getTour(repoId),
      this.deps.index.getIndexState(repoId),
    ]);
    return {
      repo: { name: repo.name, full_name: repo.fullName, default_branch: repo.defaultBranch },
      tour,
      generating: this.isRunning(repoId),
      stale: tour ? isStale(tour, state.lastIndexedSha) : false,
    };
  }

  /** `null` → the route throws `NotFoundError`. Everything else that can go wrong is an `AppError`. */
  async generate(workspaceId: string, repoId: string): Promise<OnboardingPage | null> {
    const repo = await this.deps.repo.getRepo(workspaceId, repoId);
    if (!repo) return null;

    if (this.isRunning(repoId)) {
      throw new AppError('generation_running', 'A tour is already being generated for this repo', 409);
    }
    const startedAt = this.now();
    this.running.set(repoId, startedAt);
    try {
      await this.run(workspaceId, repo);
    } finally {
      // Only our own mark — a newer generation may have replaced a stale one.
      if (this.running.get(repoId) === startedAt) this.running.delete(repoId);
    }
    return this.page(workspaceId, repoId);
  }

  private async run(workspaceId: string, repo: RepoBasics): Promise<void> {
    const { index, files } = this.deps;
    const repoId = repo.id;

    if (!repo.clonePath) {
      throw new AppError('repo_not_cloned', 'The repo has no local clone yet', 422);
    }

    // The files are the index's: rank desc, then path asc (AC-6, AC-7, AC-8).
    const readingPath = await index.getTopFilesByRank(repoId, MAX_READING_PATH);
    const state = await index.getIndexState(repoId);
    const reason = notIndexedReason({
      enabled: this.deps.repoIntelEnabled,
      state,
      rankedCount: readingPath.length,
    });
    if (reason) {
      throw new AppError(
        'repo_not_indexed',
        'The repo is not indexed — the tour is built from the ranked index',
        422,
        { reason },
      );
    }

    const chains = await index.getCriticalPaths(repoId);
    const candidates = [...new Set([...readingPath, ...chains.flat()])];
    const ranks = candidates.length > 0 ? await index.getFileRank(repoId, candidates) : [];
    const rankOf = new Map(ranks.map((r) => [r.path, r.rank]));
    const criticalPaths = selectCriticalFiles(chains, rankOf, MAX_CRITICAL_PATHS);

    // The key is probed before any read or call (EC-5).
    const { provider, model } = await this.deps.resolveModel(workspaceId);
    let llm: LLMProvider;
    try {
      llm = await this.deps.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          'provider_key_missing',
          `No API key is configured for ${provider}`,
          422,
          { provider },
        );
      }
      throw err;
    }

    const runSources = await files.readRunSources(repo.clonePath);
    const excerptPaths = [...new Set([...readingPath, ...criticalPaths])].sort(
      (a, b) => (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0) || a.localeCompare(b),
    );
    const excerpts = await files.readExcerpts(repo.clonePath, excerptPaths);
    const repoMap = (await index.getRepoMap(repoId)).text;

    const { input } = fitToBudget(
      { repoFullName: repo.fullName, readingPath, criticalPaths, runSources, excerpts, repoMap },
      this.deps.countTokens,
      MAX_INPUT_TOKENS,
    );

    const startedAt = this.now();
    const outcome = await this.callModel(llm, model, input);
    const durationMs = this.now() - startedAt;
    const logBase = { repoId, provider, model, durationMs };

    if (outcome.kind === 'failed') {
      this.deps.log.warn(
        { ...logBase, tokensIn: null, tokensOut: null, costUsd: null, removed: null, outcome: outcome.reason },
        'onboarding generation',
      );
      throw new AppError('generation_failed', 'The tour could not be generated', 502, {
        reason: outcome.reason,
      });
    }

    const { result } = outcome;
    const grounded = groundDraft(result.data, {
      readingPath,
      criticalPaths,
      grounded: groundedPathSet(input),
    });
    const { removed, ...sections } = grounded;
    const tour: Onboarding = {
      repo_id: repoId,
      generated_at: new Date(this.now()).toISOString(),
      index_sha: state.lastIndexedSha,
      files_indexed: state.filesIndexed,
      provider,
      model,
      ...sections,
    };

    const logOk = (finalOutcome: GenerationOutcome, counts: RemovedCounts | null) =>
      this.deps.log[finalOutcome === 'ok' ? 'info' : 'warn'](
        {
          ...logBase,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          // Unknown cost stays null, never 0.
          costUsd: result.costUsd ?? null,
          removed: counts,
          outcome: finalOutcome,
        },
        'onboarding generation',
      );

    if (Buffer.byteLength(JSON.stringify(tour), 'utf8') > MAX_STORED_BYTES) {
      logOk('invalid_output', removed);
      throw new AppError('generation_failed', 'The generated tour is too large to store', 502, {
        reason: 'invalid_output',
      });
    }

    await this.deps.repo.saveTour(repoId, tour);
    logOk('ok', removed);
  }

  /** The one LLM call (AC-5, NFR-1): no reprompt, raced against the service's own timer (D4). */
  private async callModel(llm: LLMProvider, model: string, input: PromptInput) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GenerationTimeout()), this.deps.timeoutMs);
    });
    try {
      const result = await Promise.race([
        llm.completeStructured({
          model,
          schema: OnboardingDraft,
          schemaName: ONBOARDING_SCHEMA_NAME,
          messages: buildMessages(input),
          temperature: 0,
          maxRetries: 0,
          timeoutMs: this.deps.timeoutMs,
        }),
        timeout,
      ]);
      return { kind: 'ok' as const, result };
    } catch (err) {
      const reason: Exclude<GenerationOutcome, 'ok'> =
        err instanceof GenerationTimeout ? 'timeout' : isSchemaFailure(err) ? 'invalid_output' : 'llm_error';
      return { kind: 'failed' as const, reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
