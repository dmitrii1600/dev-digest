import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff, plus the generated brief record. Composed into PrBrief, the
 * `pr_brief.json` document, in which each writer owns one top-level key
 * (`brief` and `history`) and merges it in atomically.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/** What the intent classifier returns — the model's contract, enforced out of
 *  band by `response_format: json_schema`. Not a DTO: confidence and
 *  provenance are computed in code (PrIntentRecord). */
export const IntentClassification = z.object({
  intent: z
    .string()
    .describe(
      'One or two sentences: what this PR sets out to change, in the author’s terms, judged only from the evidence provided.',
    ),
  in_scope: z
    .array(z.string())
    .describe(
      'Short phrases naming the areas this PR is meant to touch — a subsystem, a file group, a behaviour. Empty when the evidence does not say.',
    ),
  out_of_scope: z
    .array(z.string())
    .describe(
      'Short phrases naming subject areas this PR does not set out to change. Never a quality property: "security", "error handling", "tests", "correctness" and the like NEVER belong here, and nothing in this list reduces what a reviewer checks.',
    ),
});
export type IntentClassification = z.infer<typeof IntentClassification>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  // Endpoints / crons declared in the caller's own file (from the index's
  // per-file facts). Optional: absent on the fallback path and in documents
  // persisted before the field existed; the per-symbol unions below stay the
  // source of truth for the counts.
  endpoints: z.array(z.string()).optional(),
  crons: z.array(z.string()).optional(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

// `index_stale` is blast's own: the index exists but was built by an older
// indexer version; the route queues a rebuild and says so instead of showing
// a half-empty map as if it were complete.
export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'index_stale',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

// `degraded` / `reason` are set by `GET /pulls/:id/blast-radius`; they are
// optional because `PrBrief` (which embeds this shape) is persisted in
// `pr_brief.json` and older documents will not carry them.
export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.nullish(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Generated PR Brief ----

/** Every [fact, status] pair a brief may report as missing, degraded or
 *  trimmed. The single source: the `BriefMissingFact` union below, the server
 *  helpers and the client copy all pin to it. */
export const BRIEF_FACT_PAIRS = [
  ['intent', 'absent'],
  ['intent', 'stale'],
  ['blast', 'degraded'],
  ['blast', 'unavailable'],
  ['linked_issue', 'absent'],
  ['linked_issue', 'missing_token'],
  ['linked_issue', 'fetch_failed'],
  ['linked_issue', 'cut'],
  ['project_context', 'absent'],
  ['project_context', 'skipped'],
  ['project_context', 'truncated'],
  ['project_context', 'dropped'],
  ['description', 'absent'],
  ['description', 'truncated'],
  ['callers', 'dropped'],
  ['file_stats', 'folded'],
] as const;

// `detail` carries: a BlastDegradedReason for blast/degraded; a document path
// for project_context/skipped|truncated|dropped; the issue number for
// linked_issue/missing_token|fetch_failed|cut; the folded-file count for
// file_stats/folded; null otherwise. A pair outside BRIEF_FACT_PAIRS fails
// PrBriefRecord parsing.
export const BriefMissingFact = z.discriminatedUnion('fact', [
  z.object({
    fact: z.literal('intent'),
    status: z.enum(['absent', 'stale']),
    detail: z.string().nullable(),
  }),
  z.object({
    fact: z.literal('blast'),
    status: z.enum(['degraded', 'unavailable']),
    detail: z.string().nullable(),
  }),
  z.object({
    fact: z.literal('linked_issue'),
    status: z.enum(['absent', 'missing_token', 'fetch_failed', 'cut']),
    detail: z.string().nullable(),
  }),
  z.object({
    fact: z.literal('project_context'),
    status: z.enum(['absent', 'skipped', 'truncated', 'dropped']),
    detail: z.string().nullable(),
  }),
  z.object({
    fact: z.literal('description'),
    status: z.enum(['absent', 'truncated']),
    detail: z.string().nullable(),
  }),
  z.object({
    fact: z.literal('callers'),
    status: z.enum(['dropped']),
    detail: z.string().nullable(),
  }),
  z.object({
    fact: z.literal('file_stats'),
    status: z.enum(['folded']),
    detail: z.string().nullable(),
  }),
]);
export type BriefMissingFact = z.infer<typeof BriefMissingFact>;
export type BriefFact = BriefMissingFact['fact'];

export const BriefReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().min(1),
  reason: z.string().max(200),
});
export type BriefReviewFocusItem = z.infer<typeof BriefReviewFocusItem>;

/** `Risk` as stored: bounded and always anchored to at least one file. */
export const StoredRisk = Risk.extend({
  title: z.string().max(120),
  explanation: z.string().max(600),
  file_refs: z.array(z.string()).min(1),
});
export type StoredRisk = z.infer<typeof StoredRisk>;

// A field added later must be `.nullish()` — stored documents predate it.
// `input_tokens` is our cl100k count of what we sent, taken before the call
// (NFR-2/NFR-9). `tokens_in`/`tokens_out` are the provider's reported usage
// (the banner cost line). They measure different things and are kept apart.
export const PrBriefRecord = z.object({
  summary: z.string().max(600),
  risks: z.array(StoredRisk).max(8),
  review_focus: z.array(BriefReviewFocusItem).max(8),
  missing_facts: z.array(BriefMissingFact),
  head_sha: z.string(),
  provider: z.string(),
  model: z.string(),
  input_tokens: z.number().int(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  generated_at: z.string(),
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;

export const PrBriefResponse = z.object({
  brief: PrBriefRecord.nullable(),
  stale: z.boolean(),
  head_sha: z.string(),
  generating: z.boolean(),
});
export type PrBriefResponse = z.infer<typeof PrBriefResponse>;

/** What the brief model returns — out-of-band `response_format: json_schema`.
 *  No caps, no `int()`/`min(1)`: the provider's schema dialect is narrow, so
 *  the file filter and the length caps are enforced in code, not here. */
export const BriefDraft = z.object({
  summary: z.string().describe('At most two sentences: what this PR does and why it matters to a reviewer.'),
  risks: z
    .array(
      z.object({
        kind: z.string().describe('A short category label, e.g. "security", "data", "compatibility".'),
        title: z.string().describe('A short headline for the risk.'),
        explanation: z.string().describe('Why this is a risk, in one or two sentences.'),
        severity: RiskSeverity,
        file_refs: z
          .array(z.string())
          .describe(
            'Paths from the listed files only. A ref may carry a line suffix, ":line" or ":start-end". At most 8 risks in total.',
          ),
      }),
    )
    .describe('At most 8 risks, most severe first.'),
  review_focus: z
    .array(
      z.object({
        file: z.string().describe('A bare path from the listed files, with no line suffix.'),
        line: z.number().describe('A new-side line number in that file.'),
        reason: z.string().describe('Why a reviewer should read this spot first.'),
      }),
    )
    .describe('At most 8 places to read first, in reading order.'),
});
export type BriefDraft = z.infer<typeof BriefDraft>;

// ---- PR Brief document (pr_brief.json) ----
// Each writer owns one top-level key and merges it atomically (`||`):
// `brief` is the generated brief, `history` is Prior PRs.
export const PrBrief = z.object({
  brief: PrBriefRecord.optional(),
  history: z
    .object({
      computed_for_sha: z.string(),
      history: z.array(PrHistoryItem),
    })
    .optional(),
});
export type PrBrief = z.infer<typeof PrBrief>;
