import {
  BriefDraft,
  PrBriefRecord,
  type BlastRadius,
  type FeatureModelChoice,
  type IssueMeta,
  type LLMProvider,
  type PrBriefResponse,
  type PrIntentRecord,
  type RepoRef,
  type SmartDiff,
} from '@devdigest/shared';
import { AppError, ConfigError, StructuredOutputError } from '../../platform/errors.js';
import { BRIEF_SCHEMA_NAME, MAX_INPUT_TOKENS } from './constants.js';
import {
  allowedPaths,
  baseMissingFacts,
  blastPromptInput,
  buildPrompt,
  countInput,
  firstIssueRef,
  fitToBudget,
  flattenSmartDiff,
  groundAndCap,
  isStale,
  type BaseFactsInput,
  type BriefPromptInput,
} from './helpers.js';
import type { BriefPr, BriefRepository } from './repository.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) — onion rule 1. */
export interface BriefLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/** The ports are declared structurally: this module imports nothing from blast, smart-diff, intent or project-context. */
export interface BriefDeps {
  repo: Pick<BriefRepository, 'getPr' | 'getBrief' | 'saveBrief'>;
  /** Read only — a brief never derives an intent. */
  intent: { get(workspaceId: string, prId: string): Promise<PrIntentRecord | null> };
  blast: { forPull(workspaceId: string, prId: string): Promise<BlastRadius | null> };
  smartDiff: { get(workspaceId: string, prId: string): Promise<SmartDiff> };
  projectContext: {
    resolveForRepo(input: {
      workspaceId: string;
      repoId: string;
      clonePath: string | null;
    }): Promise<{
      docs: { path: string; content: string }[];
      skipped: string[];
      truncated: string[];
      tokens: number;
    }>;
  };
  /** Lazy; may throw `ConfigError` when no token is configured. */
  github: { getIssue(repo: RepoRef, n: number): Promise<IssueMeta> };
  resolveModel: (workspaceId: string) => Promise<FeatureModelChoice>;
  /** Wired single-shot: one transport attempt. May throw `ConfigError` when the key is missing. */
  llm: (provider: FeatureModelChoice['provider']) => Promise<LLMProvider>;
  countTokens: (text: string) => number;
  log: BriefLogger;
  /** The service's own timer on the one LLM call. It owns the `timeout` outcome. */
  timeoutMs: number;
  /** What the provider is given: longer than `timeoutMs`, so the adapter never wins the race. */
  adapterTimeoutMs: number;
  /** A running mark older than this no longer blocks a new generation. */
  staleMs: number;
  now?: () => number;
}

type FailureReason = 'timeout' | 'invalid_output' | 'llm_error';
type Outcome = 'ok' | FailureReason | 'no_changed_files' | 'provider_key_missing' | 'brief_input_too_large';

/** Thrown by the service's own timer — mapped to `brief_failed` / `timeout`. */
class GenerationTimeout extends Error {}

/** The typed "structured output did not match the schema" signal (adapters throw `StructuredOutputError`). */
function isSchemaFailure(err: unknown): boolean {
  return err instanceof StructuredOutputError || (err instanceof Error && err.name === 'ZodError');
}

/** The fields of the one log line per generation (NFR-9). */
interface Telemetry {
  provider: string | null;
  model: string | null;
  modelCalls: 0 | 1;
  inputTokens: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  trimmed: string[];
  removed: { risks: number; refs: number; focus: number } | null;
}

/**
 * Ring 2 — the PR brief use case. Takes its collaborators as constructor
 * arguments (onion rule 9); `routes.ts` wires them, so this is unit-tested
 * hermetically with plain fakes (no Postgres, no Container).
 *
 * One model call over facts that already exist; code then drops every file
 * reference that is not a changed file or a blast-map file, caps the text and
 * validates the record before the one stored brief is replaced.
 *
 * Logs never carry a caught error, `raw`, the prompt or the model's output —
 * only the outcome and the NFR-9 counters.
 */
export class BriefService {
  constructor(private readonly deps: BriefDeps) {}

  /** prId → epoch ms the running generation started (in-process, single instance). */
  private readonly running = new Map<string, number>();

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private isRunning(prId: string): boolean {
    const startedAt = this.running.get(prId);
    return startedAt !== undefined && this.now() - startedAt < this.deps.staleMs;
  }

  /** `null` → the route throws `NotFoundError`. Makes no model call and touches nothing but the repository. */
  async page(workspaceId: string, prId: string): Promise<PrBriefResponse | null> {
    const pr = await this.deps.repo.getPr(workspaceId, prId);
    if (!pr) return null;
    const brief = await this.deps.repo.getBrief(prId);
    return {
      brief,
      stale: brief ? isStale(brief, pr.headSha) : false,
      head_sha: pr.headSha,
      generating: this.isRunning(prId),
    };
  }

  /** `null` → the route throws `NotFoundError`. Everything else that can go wrong is an `AppError`. */
  async generate(workspaceId: string, prId: string): Promise<PrBriefResponse | null> {
    const pr = await this.deps.repo.getPr(workspaceId, prId);
    if (!pr) return null;

    if (this.isRunning(prId)) {
      throw new AppError('brief_running', 'A brief is already being generated for this PR', 409);
    }
    const startedAt = this.now();
    this.running.set(prId, startedAt);
    try {
      await this.run(workspaceId, pr);
    } finally {
      // Only our own mark — a newer generation may have replaced a stale one.
      if (this.running.get(prId) === startedAt) this.running.delete(prId);
    }
    return this.page(workspaceId, prId);
  }

  private async run(workspaceId: string, pr: BriefPr) {
    const { deps } = this;
    const began = this.now();
    const tel: Telemetry = {
      provider: null,
      model: null,
      modelCalls: 0,
      inputTokens: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      trimmed: [],
      removed: null,
    };
    const log = (outcome: Outcome) =>
      deps.log[outcome === 'ok' ? 'info' : 'warn'](
        {
          prId: pr.id,
          headSha: pr.headSha,
          provider: tel.provider,
          model: tel.model,
          modelCalls: tel.modelCalls,
          inputTokens: tel.inputTokens,
          tokensIn: tel.tokensIn,
          tokensOut: tel.tokensOut,
          // Unknown cost stays null, never 0.
          costUsd: tel.costUsd,
          durationMs: this.now() - began,
          trimmed: tel.trimmed,
          removed: tel.removed,
          outcome,
        },
        'pr brief generation',
      );

    // The changed files (EC-10). Smart Diff is the one reader of `pr_files`.
    const files = flattenSmartDiff(await deps.smartDiff.get(workspaceId, pr.id));
    if (files.length === 0) {
      log('no_changed_files');
      throw new AppError('no_changed_files', 'This PR has no changed files recorded', 422);
    }

    // The key is probed before any GitHub or document read (EC-4).
    const { provider, model } = await deps.resolveModel(workspaceId);
    tel.provider = provider;
    tel.model = model;
    let llm: LLMProvider;
    try {
      llm = await deps.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        log('provider_key_missing');
        throw new AppError('provider_key_missing', `No API key is configured for ${provider}`, 422, { provider });
      }
      throw err;
    }

    // Facts, each failure-tolerant (EC-1, EC-2, AC-7).
    let intent: PrIntentRecord | null;
    try {
      intent = await deps.intent.get(workspaceId, pr.id);
    } catch {
      intent = null;
    }

    let blast: BlastRadius | null = null;
    let blastUnavailable = false;
    try {
      blast = await deps.blast.forPull(workspaceId, pr.id);
    } catch {
      blastUnavailable = true;
    }

    const ref = firstIssueRef(pr.body);
    let issue: { number: number; title: string; body: string } | null = null;
    let issueOutcome: BaseFactsInput['issue']['outcome'] = 'ok';
    if (ref !== null) {
      try {
        const meta = await deps.github.getIssue({ owner: pr.owner, name: pr.name }, ref);
        issue = { number: meta.number, title: meta.title, body: meta.body ?? '' };
      } catch (err) {
        issueOutcome = err instanceof ConfigError ? 'missing_token' : 'fetch_failed';
      }
    }

    const ctx = await deps.projectContext.resolveForRepo({
      workspaceId,
      repoId: pr.repoId,
      clonePath: pr.clonePath,
    });

    const base = baseMissingFacts({
      intent: intent ? { stale: intent.stale } : null,
      blast: blastUnavailable
        ? 'unavailable'
        : blast
          ? { degraded: blast.degraded === true, reason: blast.reason ?? null }
          : null,
      issue: { ref, outcome: issueOutcome },
      docs: { count: ctx.docs.length, skipped: ctx.skipped, truncated: ctx.truncated },
      body: pr.body,
    });

    const { blast: blastInput, callers } = blastPromptInput(blast);
    const promptInput: BriefPromptInput = {
      title: pr.title,
      body: pr.body,
      issue,
      intent: intent ? { intent: intent.intent, in_scope: intent.in_scope, out_of_scope: intent.out_of_scope } : null,
      blast: blastInput,
      callers,
      files,
      docs: ctx.docs,
    };

    const fitted = fitToBudget(promptInput, deps.countTokens, MAX_INPUT_TOKENS);
    if ('overBudget' in fitted) {
      log('brief_input_too_large');
      throw new AppError(
        'brief_input_too_large',
        `The PR's facts do not fit the ${MAX_INPUT_TOKENS}-token budget, even after trimming`,
        422,
      );
    }
    tel.trimmed = fitted.missing.map((m) => `${m.fact}/${m.status}`);

    const { messages } = buildPrompt(fitted.input);
    tel.inputTokens = countInput(messages, deps.countTokens);

    // The one model call (NFR-1): no re-ask, no transport retry.
    tel.modelCalls = 1;
    const outcome = await this.callModel(llm, model, messages);
    if (outcome.kind === 'failed') {
      log(outcome.reason);
      throw new AppError('brief_failed', 'The brief could not be generated', 502, { reason: outcome.reason });
    }
    const { result } = outcome;
    tel.tokensIn = result.tokensIn;
    tel.tokensOut = result.tokensOut;
    tel.costUsd = result.costUsd ?? null;

    const grounded = groundAndCap(result.data, allowedPaths(files, blast));
    tel.removed = grounded.removed;

    // Validate before storing (UI-6, UI-7): the record must parse, or nothing is written.
    const parsed = PrBriefRecord.safeParse({
      summary: grounded.summary,
      risks: grounded.risks,
      review_focus: grounded.review_focus,
      missing_facts: [...base, ...fitted.missing],
      head_sha: pr.headSha,
      provider,
      model,
      input_tokens: tel.inputTokens,
      tokens_in: result.tokensIn ?? null,
      tokens_out: result.tokensOut ?? null,
      cost_usd: result.costUsd ?? null,
      generated_at: new Date(this.now()).toISOString(),
    });
    if (!parsed.success) {
      log('invalid_output');
      throw new AppError('brief_failed', 'The brief could not be generated', 502, { reason: 'invalid_output' });
    }

    await deps.repo.saveBrief(pr.id, parsed.data);
    log('ok');
  }

  /** The one LLM call, raced against the service's own timer. The timer does not cancel the call. */
  private async callModel(llm: LLMProvider, model: string, messages: ReturnType<typeof buildPrompt>['messages']) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GenerationTimeout()), this.deps.timeoutMs);
    });
    try {
      const result = await Promise.race([
        llm.completeStructured({
          model,
          schema: BriefDraft,
          schemaName: BRIEF_SCHEMA_NAME,
          messages,
          temperature: 0,
          maxRetries: 0,
          timeoutMs: this.deps.adapterTimeoutMs,
        }),
        timeout,
      ]);
      return { kind: 'ok' as const, result };
    } catch (err) {
      const reason: FailureReason =
        err instanceof GenerationTimeout ? 'timeout' : isSchemaFailure(err) ? 'invalid_output' : 'llm_error';
      return { kind: 'failed' as const, reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
