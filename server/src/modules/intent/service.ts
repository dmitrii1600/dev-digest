import { IntentClassification } from '@devdigest/shared';
import type {
  ChatMessage,
  FeatureModelChoice,
  GitHubClient,
  IntentSource,
  LLMProvider,
  PrIntentRecord,
  UrlFetcher,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import {
  INTENT_SCHEMA_NAME,
  buildIntentMessages,
  deriveConfidence,
  detectPlanRefs,
  extractInlinePlan,
  synthesizeFileDigest,
  synthesizeFileDigestFromCounts,
  toIntentDto,
  type PlanRef,
  type ResolvedPlan,
} from './helpers.js';
import { MAX_BODY_CHARS, MAX_PLAN_REFS, MAX_SPEC_CHUNKS, PLAN_FETCH_BYTES, PLAN_FETCH_TIMEOUT_MS } from './constants.js';
import type { IntentRepository, PullRow, RepoBasics } from './repository.js';
import type { IntentDeriveOptions, IntentPort } from './types.js';

/**
 * Everything `IntentService` reaches for, as ports (Onion Rule 9). Wired once
 * in the composition root (`platform/container.ts`); a hermetic test hands in
 * fakes without building a `Container`.
 */
export interface IntentDeps {
  repo: IntentRepository;
  /** Tier B clone reader — ring 3 (`repository-plans.ts` `readRepoFile`). */
  readPlanFile: (clonePath: string, relPath: string) => Promise<string | null>;
  /** The workspace's `review_intent` provider + model. */
  resolveModel: (workspaceId: string) => Promise<FeatureModelChoice>;
  llm: (provider: FeatureModelChoice['provider']) => Promise<LLMProvider>;
  github: () => Promise<GitHubClient>;
  urlFetcher: UrlFetcher;
  /** `INTENT_FETCH_LINKS` — tier D is off when false. */
  fetchLinks: boolean;
}

/**
 * The Intent Layer (L03) service. Sample selection (sources) is 100% code —
 * see `server/INSIGHTS.md`'s "against the leftover hook comment" note — the
 * model only classifies what it is handed. Follows the `ConventionsService`
 * idiom verbatim: resolve the feature model → LLM call with a schema →
 * persist. See `modules/intent/README.md` for the confidence formula and the
 * four plan/spec retrieval tiers.
 */
export class IntentService implements IntentPort {
  private readonly repo: IntentRepository;

  constructor(private readonly deps: IntentDeps) {
    this.repo = deps.repo;
  }

  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new AppError('pull_not_found', 'Pull request not found', 404);
    const row = await this.repo.getIntentRow(prId);
    return row ? toIntentDto(row, pull.headSha) : null;
  }

  async ensure(
    workspaceId: string,
    prId: string,
    opts: IntentDeriveOptions = {},
  ): Promise<{ record: PrIntentRecord; block: string } | null> {
    try {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) return null;
      const row = await this.repo.getIntentRow(prId);
      if (row && row.headSha === pull.headSha) {
        const record = toIntentDto(row, pull.headSha);
        return { record, block: buildBlock(record) };
      }
      const record = await this.derive(workspaceId, prId, opts);
      return { record, block: buildBlock(record) };
    } catch (err) {
      opts.onEvent?.('info', `intent: derivation failed — ${(err as Error).message}`);
      return null;
    }
  }

  async derive(
    workspaceId: string,
    prId: string,
    opts: IntentDeriveOptions = {},
  ): Promise<PrIntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new AppError('pull_not_found', 'Pull request not found', 404);
    const repo = await this.repo.getRepo(pull.repoId);

    try {
      const { provider, model } = await this.deps.resolveModel(workspaceId);
      const { sources, messages } = await this.buildRequest(pull, repo, opts);

      const llm = await this.deps.llm(provider);
      const result = await llm.completeStructured<IntentClassification>({
        model,
        schema: IntentClassification,
        schemaName: INTENT_SCHEMA_NAME,
        messages,
        temperature: 0,
        maxRetries: 2,
      });

      await this.repo.upsertIntent(prId, {
        intent: result.data.intent,
        inScope: result.data.in_scope,
        outOfScope: result.data.out_of_scope,
        headSha: pull.headSha,
        confidence: deriveConfidence(sources),
        sources,
        provider,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      await this.repo.markFailed(prId, message);
      throw new AppError('intent_failed', message, 422);
    }

    const row = await this.repo.getIntentRow(prId);
    if (!row) throw new AppError('intent_failed', 'Intent was not persisted', 422);
    return toIntentDto(row, pull.headSha);
  }

  /** Assemble every source + the classifier's two messages. 100% code — the
   *  model never chooses what it is shown. */
  private async buildRequest(
    pull: PullRow,
    repo: RepoBasics | undefined,
    opts: IntentDeriveOptions,
  ): Promise<{ sources: IntentSource[]; messages: ChatMessage[] }> {
    const sources: IntentSource[] = [];

    // ---- pr_title (always available) ----
    sources.push({ kind: 'pr_title', origin: null, ref: pull.title, status: 'available', detail: null });

    // ---- pr_body ----
    const bodyRaw = pull.body?.trim() ?? '';
    const body = bodyRaw.length > 0 ? bodyRaw.slice(0, MAX_BODY_CHARS) : null;
    sources.push(
      body
        ? { kind: 'pr_body', origin: null, ref: `${body.length} chars`, status: 'available', detail: null }
        : { kind: 'pr_body', origin: null, ref: '0 chars', status: 'unavailable', detail: 'PR has no description' },
    );

    // ---- changed_files ----
    let fileDigest: string;
    if (opts.diff) {
      fileDigest = synthesizeFileDigest(opts.diff.files);
      const n = opts.diff.files.length;
      sources.push({
        kind: 'changed_files',
        origin: null,
        ref: `${n} file(s)`,
        status: n > 0 ? 'available' : 'unavailable',
        detail: n > 0 ? null : 'PR has no changed files',
      });
    } else {
      const files = await this.repo.getPrFiles(pull.id);
      fileDigest = synthesizeFileDigestFromCounts(files);
      sources.push({
        kind: 'changed_files',
        origin: null,
        ref: `${files.length} file(s)`,
        status: files.length > 0 ? 'partial' : 'unavailable',
        detail: files.length > 0 ? 'no hunk headers — diff was not loaded' : 'PR has no recorded files',
      });
    }

    // ---- project_context ----
    const specChunks = repo ? await this.repo.getSpecChunks(repo.id, MAX_SPEC_CHUNKS) : [];
    sources.push({
      kind: 'project_context',
      origin: null,
      ref: `${specChunks.length} spec chunk(s)`,
      status: specChunks.length > 0 ? 'available' : 'unavailable',
      detail: specChunks.length > 0 ? null : '0 spec chunks indexed',
    });

    // ---- plan_spec (tiers A-D) ----
    const plans = await this.collectPlans(pull, repo);
    sources.push(...plans.sources);

    const messages = buildIntentMessages({
      prTitle: pull.title,
      prBody: body,
      fileDigest,
      specChunks: specChunks.map((c) => c.content),
      plans: plans.resolved,
      unavailableNotes: plans.unavailableNotes,
    });

    return { sources, messages };
  }

  /**
   * The plan/spec resolver — tier A first (free, already-held text), then
   * tiers B-D in parallel with `Promise.allSettled` so one dead link cannot
   * stall the others. Every outcome becomes exactly one `IntentSource`; a
   * failure is recorded with its real reason, never swallowed and never
   * replaced by invented content (decision 5).
   */
  private async collectPlans(
    pull: PullRow,
    repo: RepoBasics | undefined,
  ): Promise<{ sources: IntentSource[]; resolved: ResolvedPlan[]; unavailableNotes: string[] }> {
    const sources: IntentSource[] = [];
    const resolved: ResolvedPlan[] = [];
    const unavailableNotes: string[] = [];
    const body = pull.body ?? '';

    // Tier A — inline, free, no I/O.
    const inline = extractInlinePlan(body);
    if (inline) {
      sources.push({ kind: 'plan_spec', origin: 'inline', ref: inline.heading, status: 'available', detail: null });
      resolved.push({ ref: inline.heading, text: inline.text });
    }

    if (!repo) return { sources, resolved, unavailableNotes };

    const refs = detectPlanRefs(body, repo.fullName).slice(0, MAX_PLAN_REFS);
    const outcomes = await Promise.allSettled(refs.map((ref) => this.resolvePlanRef(ref, repo)));

    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i]!;
      const outcome = outcomes[i]!;
      if (outcome.status === 'fulfilled' && outcome.value) {
        sources.push({ kind: 'plan_spec', origin: ref.origin, ref: ref.raw, status: 'available', detail: null });
        resolved.push({ ref: ref.raw, text: outcome.value });
      } else {
        const detail =
          outcome.status === 'rejected'
            ? ((outcome.reason as Error)?.message ?? String(outcome.reason))
            : 'not found';
        sources.push({ kind: 'plan_spec', origin: ref.origin, ref: ref.raw, status: 'unavailable', detail });
        unavailableNotes.push(`${ref.raw} was not retrieved (${detail}) — do not guess its contents.`);
      }
    }

    return { sources, resolved, unavailableNotes };
  }

  /** One reference, one tier. Returns `null` for "not found" (not an error);
   *  throws for everything else so `Promise.allSettled` captures the real reason. */
  private async resolvePlanRef(ref: PlanRef, repo: RepoBasics): Promise<string | null> {
    if (ref.origin === 'repo_file') {
      if (!repo.clonePath) return null;
      return this.deps.readPlanFile(repo.clonePath, ref.target);
    }
    if (ref.origin === 'github_issue') {
      const github = await this.deps.github();
      const issue = await github.getIssue({ owner: repo.owner, name: repo.name }, Number(ref.target));
      const text = [issue.title, issue.body ?? ''].filter(Boolean).join('\n\n').trim();
      return text.length > 0 ? text : null;
    }
    // external_url — tier D
    if (!this.deps.fetchLinks) {
      throw new Error('external fetching disabled');
    }
    const res = await this.deps.urlFetcher.fetch(ref.target, {
      maxBytes: PLAN_FETCH_BYTES,
      timeoutMs: PLAN_FETCH_TIMEOUT_MS,
    });
    const text = Buffer.from(res.bytes).toString('utf8').trim();
    return text.length > 0 ? text : null;
  }
}

/**
 * The prompt text for the `intent` slot — `Intent: …`, `In scope: …`,
 * `Out of scope: …`, plus a confidence line so the reviewer can discount a
 * thin classification. Returned UNWRAPPED; `assemblePrompt` owns the
 * `wrapUntrusted`, the same way it owns `repo_map` and `callers`.
 */
function buildBlock(record: PrIntentRecord): string {
  const lines = [
    `Intent: ${record.intent}`,
    `In scope: ${record.in_scope.length > 0 ? record.in_scope.join('; ') : '(not stated)'}`,
    `Out of scope: ${record.out_of_scope.length > 0 ? record.out_of_scope.join('; ') : '(not stated)'}`,
  ];

  const available = record.sources.filter((s) => s.status === 'available').length;
  const total = record.sources.length;
  const unresolved = record.sources.filter((s) => s.status === 'unavailable').map((s) => s.ref);
  const suffix =
    unresolved.length > 0
      ? `; ${unresolved.join(', ')} ${unresolved.length === 1 ? 'was' : 'were'} not retrieved`
      : '';
  lines.push(`Confidence: ${Math.round(record.confidence * 100)}% — derived from ${available} of ${total} source(s)${suffix}`);

  return lines.join('\n');
}
