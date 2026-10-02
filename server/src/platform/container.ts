import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  UrlFetcher,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { SchemaFailureTagger } from '../adapters/llm/schema-failure.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import type { BlastPort } from '../modules/blast/types.js';
import { BlastService } from '../modules/blast/service.js';
import { BlastRepository } from '../modules/blast/repository.js';
import { REINDEX_NUDGE_INTERVAL_MS } from '../modules/blast/constants.js';
import type { SmartDiffPort } from '../modules/smart-diff/types.js';
import { SmartDiffService } from '../modules/smart-diff/service.js';
import { SmartDiffRepository } from '../modules/smart-diff/repository.js';
import { INDEXER_VERSION, MAX_CALLERS_PER_SYMBOL, RESYNC_JOB_KIND } from '../modules/repo-intel/constants.js';
import type { IntentPort } from '../modules/intent/types.js';
import { IntentService } from '../modules/intent/service.js';
import { IntentRepository } from '../modules/intent/repository.js';
import { readRepoFile } from '../modules/intent/repository-plans.js';
import type { ProjectContextPort } from '../modules/project-context/types.js';
import { ProjectContextService } from '../modules/project-context/service.js';
import { ProjectContextRepository } from '../modules/project-context/repository.js';
import { listMarkdown, readDoc } from '../modules/project-context/repository-files.js';
import * as projectContextWrites from '../modules/project-context/repository-writes.js';
import { resolveFeatureModel } from '../modules/_shared/feature-models.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { FetchUrlFetcher } from '../adapters/url-fetcher/fetch.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** Intent Layer (L03) — tests inject a stub so a review run doesn't need a real LLM call for it. */
  intent?: IntentPort;
  /** Project Context - tests may inject a stub. */
  projectContext?: ProjectContextPort;
  /** Blast radius - tests may inject a stub (the PR brief reads it through the port). */
  blast?: BlastPort;
  /** Smart Diff - tests may inject a stub (the PR brief reads it through the port). */
  smartDiff?: SmartDiffPort;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /** Skills import-from-URL — tests inject `MockUrlFetcher`, never the network. */
  urlFetcher?: UrlFetcher;
}

/** Minimal structured logger (pino-compatible) the container hands to services it builds. */
export interface ContainerLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

const NOOP_LOG: ContainerLogger = { info: () => {}, warn: () => {} };

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _reviewRepo?: ReviewRepository;
  private _skillsRepo?: SkillsRepository;
  private _repoIntel?: RepoIntel;
  private _intent?: IntentPort;
  private _projectContext?: ProjectContextPort;
  private _blast?: BlastPort;
  private _smartDiff?: SmartDiffPort;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _urlFetcher?: UrlFetcher;
  private _priceBook?: PriceBook;

  constructor(
    config: AppConfig,
    db: Db,
    private overrides: ContainerOverrides = {},
    readonly log: ContainerLogger = NOOP_LOG,
  ) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /**
   * The Intent Layer (L03) facade. `modules/reviews/run-executor.ts` reaches
   * this ONLY through `Container['intent']` — a type-only edge
   * (`tsPreCompilationDeps: false`), never by importing `modules/intent/*`
   * directly, which `no-cross-module-reach-in` forbids. Same `RepoIntel` shape.
   */
  get intent(): IntentPort {
    if (this.overrides.intent) return this.overrides.intent;
    this._intent ??= new IntentService({
      repo: new IntentRepository(this.db),
      readPlanFile: readRepoFile,
      resolveModel: (workspaceId) => resolveFeatureModel(this, workspaceId, 'review_intent'),
      llm: (provider) => this.llm(provider),
      github: () => this.github(),
      urlFetcher: this.urlFetcher,
      fetchLinks: this.config.intentFetchLinks,
    });
    return this._intent;
  }

  /**
   * Project Context facade. `run-executor.ts` reaches this ONLY through
   * `Container['projectContext']` - a type-only edge, same shape as `intent`.
   */
  get projectContext(): ProjectContextPort {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    this._projectContext ??= new ProjectContextService({
      repo: new ProjectContextRepository(this.db),
      listMarkdown,
      readDoc,
      countTokens: (s) => this.tokenizer.count(s),
      writes: projectContextWrites,
      listTracked: (clonePath, underDir) => this.git.listTracked(clonePath, underDir),
    });
    return this._projectContext;
  }

  /**
   * Blast radius. One `BlastService` per container, so the blast route and the
   * PR brief share a single reindex-nudge throttle (`lastNudgeAt`). The `index`
   * closures are lazy: a test that patches `container.repoIntel` after
   * `buildApp()` is still honoured.
   */
  get blast(): BlastPort {
    if (this.overrides.blast) return this.overrides.blast;
    this._blast ??= new BlastService({
      prs: new BlastRepository(this.db),
      index: {
        getBlastRadius: (repoId, files) => this.repoIntel.getBlastRadius(repoId, files),
        getIndexState: (repoId) => this.repoIntel.getIndexState(repoId),
      },
      log: this.log,
      repoIntelEnabled: this.config.repoIntelEnabled,
      maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL,
      indexerVersion: INDEXER_VERSION,
      // Same job the Resync button enqueues; the handler is registered by
      // repo-intel/routes.ts at boot. Fire-and-forget from the service.
      requestReindex: async (workspaceId, repoId) => {
        await this.jobs.enqueue(workspaceId, RESYNC_JOB_KIND, { repoId });
      },
      reindexNudgeIntervalMs: REINDEX_NUDGE_INTERVAL_MS,
    });
    return this._blast;
  }

  /** Smart Diff facade (path-based classifier, no model call). */
  get smartDiff(): SmartDiffPort {
    if (this.overrides.smartDiff) return this.overrides.smartDiff;
    this._smartDiff ??= new SmartDiffService(new SmartDiffRepository(this.db));
    return this._smartDiff;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /** Guarded public-URL fetcher for `POST /skills/import/url`. */
  get urlFetcher(): UrlFetcher {
    if (this.overrides.urlFetcher) return this.overrides.urlFetcher;
    this._urlFetcher ??= new FetchUrlFetcher();
    return this._urlFetcher;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /**
   * Resolve an LLM provider by id; constructs from the secret key, cached.
   *
   * `opts.singleShot` builds a variant that makes ONE transport attempt (SDK
   * `maxRetries: 0`, no `withRetry`) and, for OpenRouter, a client timeout of
   * `timeoutMs`. It is cached under `${id}:single` in the same cache, so
   * `invalidateSecretCaches()` clears it too. An injected override wins for both.
   */
  async llm(
    id: 'openai' | 'anthropic' | 'openrouter',
    opts?: { singleShot?: { timeoutMs: number } },
  ): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cacheKey = opts?.singleShot ? `${id}:single` : id;
    const cached = this.llmCache.get(cacheKey);
    if (cached) return cached;
    const provider = await this.buildLlm(id, opts?.singleShot);
    this.llmCache.set(cacheKey, provider);
    return provider;
  }

  private async buildLlm(
    id: 'openai' | 'anthropic' | 'openrouter',
    singleShot?: { timeoutMs: number },
  ): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key, singleShot ? { singleShot: true } : undefined);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new SchemaFailureTagger(
        new OpenRouterProvider(key, {
          estimateCost: (model, tokensIn, tokensOut) =>
            this.priceBook.estimate(model, tokensIn, tokensOut),
          ...(singleShot ? { maxRetries: 0, timeoutMs: singleShot.timeoutMs } : {}),
        }),
      );
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key, singleShot ? { singleShot: true } : undefined);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
