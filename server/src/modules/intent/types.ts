import type { PrIntentRecord, RunEventKind, UnifiedDiff } from '@devdigest/shared';

/**
 * The intent port — the `RepoIntel` precedent
 * ([repo-intel/types.ts](../repo-intel/types.ts)). `modules/reviews/run-executor.ts`
 * reaches this ONLY through `Container['intent']` — a type-only edge
 * (`tsPreCompilationDeps: false` in `.dependency-cruiser.cjs`), never by
 * importing `modules/intent/*` directly, which `no-cross-module-reach-in`
 * forbids. `IntentService` implements this in `service.ts`; the composition
 * root (`platform/container.ts`) is the only OTHER file allowed to import it.
 */

export interface IntentDeriveOptions {
  /** An already-loaded diff (the review path has one); omitted → falls back to `pr_files`. */
  diff?: UnifiedDiff;
  /** Progress sink — the engine's own idiom, so no RunLogger coupling here. */
  onEvent?: (kind: RunEventKind, msg: string, data?: unknown) => void;
}

export interface IntentPort {
  /** Throws `AppError('pull_not_found', …)` when the PR itself doesn't exist. */
  get(workspaceId: string, prId: string): Promise<PrIntentRecord | null>;
  /** Derive only when missing or the row's `head_sha` is stale. Never throws:
   *  a failure is reported through `opts.onEvent` and returns `null`, so the
   *  review continues with the section omitted. */
  ensure(
    workspaceId: string,
    prId: string,
    opts?: IntentDeriveOptions,
  ): Promise<{ record: PrIntentRecord; block: string } | null>;
  /** Force a re-derivation (the Re-run button). Throws `AppError` on failure. */
  derive(workspaceId: string, prId: string, opts?: IntentDeriveOptions): Promise<PrIntentRecord>;
}
