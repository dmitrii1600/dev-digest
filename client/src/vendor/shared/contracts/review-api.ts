import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

export const IntentSourceStatus = z.enum(['available', 'partial', 'unavailable']);
export type IntentSourceStatus = z.infer<typeof IntentSourceStatus>;

// plan_spec covers all four retrieval tiers; `origin` says which one.
export const IntentSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'changed_files',
  'project_context',
  'plan_spec',
  'linked_issue',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

export const PlanOrigin = z.enum(['inline', 'repo_file', 'github_issue', 'external_url']);
export type PlanOrigin = z.infer<typeof PlanOrigin>;

export const IntentSource = z.object({
  kind: IntentSourceKind,
  /** Which retrieval tier produced it; null for the non-plan kinds. */
  origin: PlanOrigin.nullish(),
  /** What it points at: '#123', 'https://…', '9 files', '0 spec chunks'. */
  ref: z.string(),
  status: IntentSourceStatus,
  /** Why it is partial/unavailable, for the card. */
  detail: z.string().nullish(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/** Intent persisted for a PR (the Intent plus provenance the UI and the
 *  reviewer prompt both need). Provenance hangs off this wrapper, not
 *  `Intent` itself, because `Intent` is also embedded in `PrBrief`. */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  /** Derived in code from `sources`; never self-reported by the model. */
  confidence: z.number().min(0).max(1),
  sources: z.array(IntentSource),
  /** The commit this was derived from; null when unknown ⇒ treated as stale. */
  head_sha: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** null = unknown, never 0. */
  cost_usd: z.number().nullable(),
  /** Last derivation failure; the previous good text is kept alongside it. */
  error: z.string().nullish(),
  generated_at: z.string(),
  /** Per-request: head_sha !== the PR's current head. Not a column. */
  stale: z.boolean(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** `GET /pulls/:id/intent` — wraps in `{ derived }` so "never derived" and
 *  "derived but failed" are distinguishable from a bare nullable body. */
export const PrIntentResponse = z.object({ derived: PrIntentRecord.nullable() });
export type PrIntentResponse = z.infer<typeof PrIntentResponse>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
