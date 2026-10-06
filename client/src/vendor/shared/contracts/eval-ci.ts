import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import {
  EvalOwnerKind,
  EvalCase,
  EvalExpectation,
  EvalTarget,
  Conformance,
  Provider,
  CiFailOn,
} from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/**
 * Size caps for a hand-written eval case. One source for the API and the case editor, so
 * the two cannot drift. Strings are counted in code points (`*Chars`) or UTF-8 bytes (`*Bytes`).
 */
export const EVAL_CASE_LIMITS = {
  nameChars: 120,
  diffBytes: 65_536,
  prTitleChars: 300,
  prBodyBytes: 16_384,
  /** Editor-only: the API carries `expectation` and `target` as fields, not the JSON text. */
  expectedJsonBytes: 8_192,
} as const;

const codePoints = (s: string): number => Array.from(s).length;
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Create/update body for a manual eval case. `owner_kind` / `owner_id` come from the URL,
 * never the body. The diff, title and body are stored exactly as entered.
 */
export const EvalCaseInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .refine((s) => codePoints(s) <= EVAL_CASE_LIMITS.nameChars, {
        message: `name must be at most ${EVAL_CASE_LIMITS.nameChars} characters`,
      }),
    input_diff: z
      .string()
      .min(1)
      .refine((s) => utf8Bytes(s) <= EVAL_CASE_LIMITS.diffBytes, {
        message: `input_diff must be at most ${EVAL_CASE_LIMITS.diffBytes} bytes`,
      }),
    input_meta: z
      .object({
        pr_title: z.string().refine((s) => codePoints(s) <= EVAL_CASE_LIMITS.prTitleChars, {
          message: `pr_title must be at most ${EVAL_CASE_LIMITS.prTitleChars} characters`,
        }),
        pr_body: z.string().refine((s) => utf8Bytes(s) <= EVAL_CASE_LIMITS.prBodyBytes, {
          message: `pr_body must be at most ${EVAL_CASE_LIMITS.prBodyBytes} bytes`,
        }),
      })
      .strict(),
    expectation: EvalExpectation,
    target: EvalTarget.refine((t) => t.start_line <= t.end_line, {
      message: 'start_line must not be after end_line',
      path: ['start_line'],
    }),
  })
  .strict();
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** `POST /eval-cases/:id/runs` — a host agent is required for a skill-owned case, refused for an agent-owned one. */
export const EvalCaseRunRequest = z.object({ host_agent_id: z.string().uuid().optional() }).strict();
export type EvalCaseRunRequest = z.infer<typeof EvalCaseRunRequest>;

/** `POST /skills/:id/eval-runs` — the agent whose prompt, model and strategy the skill is evaluated on. */
export const EvalSkillRunRequest = z.object({ host_agent_id: z.string().uuid() }).strict();
export type EvalSkillRunRequest = z.infer<typeof EvalSkillRunRequest>;

/**
 * Eval cases are made from decided findings (`EvalCase`, `knowledge.ts`); a suite
 * run is one row per RUN (`EvalSuiteRun`) with one `EvalCaseResult` per case.
 * A metric is `null` ("not available", shown "—") when its denominator is empty —
 * never 0 or 1.
 */

/** Whether a run covered the whole set (`suite`) or one case (`single`, case-authoring). */
export const EvalRunKind = z.enum(['suite', 'single']);
export type EvalRunKind = z.infer<typeof EvalRunKind>;

/** `partial` = some cases errored; `failed` = every case errored or the run was interrupted. */
export const EvalRunStatus = z.enum(['running', 'completed', 'partial', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

export const EvalCaseResultStatus = z.enum(['passed', 'failed', 'errored']);
export type EvalCaseResultStatus = z.infer<typeof EvalCaseResultStatus>;

/** A skill enabled on the agent when the run started, with its version at that moment. */
export const EvalRunSkill = z.object({
  skill_id: z.string(),
  name: z.string(),
  version: z.number().int(),
});
export type EvalRunSkill = z.infer<typeof EvalRunSkill>;

/** A case in the run's set, with the content fingerprint it had at run time. */
export const EvalRunCaseRef = z.object({
  case_id: z.string(),
  fingerprint: z.string(),
});
export type EvalRunCaseRef = z.infer<typeof EvalRunCaseRef>;

export const EvalMetrics = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export type EvalMetrics = z.infer<typeof EvalMetrics>;

/** One eval run: the header, the agent snapshot it ran against and the aggregate metrics. */
export const EvalSuiteRun = z.object({
  id: z.string(),
  kind: EvalRunKind,
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  provider: z.string(),
  model: z.string(),
  status: EvalRunStatus,
  error: z.string().nullable(),
  skills: z.array(EvalRunSkill),
  cases: z.array(EvalRunCaseRef),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  cases_errored: z.number().int(),
  metrics: EvalMetrics,
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

/** The outcome of one case in one run. `case_id` is null once the case was deleted. */
export const EvalCaseResult = z.object({
  case_id: z.string().nullable(),
  case_name: z.string(),
  expectation: EvalExpectation,
  target: EvalTarget,
  fingerprint: z.string(),
  status: EvalCaseResultStatus,
  error: z.string().nullable(),
  produced: z.number().int(),
  kept: z.number().int(),
  matched: z.number().int(),
  findings: z.array(
    z.object({
      file: z.string(),
      start_line: z.number().int(),
      end_line: z.number().int(),
      title: z.string(),
      severity: z.string(),
    }),
  ),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/** `GET /eval-runs/:id` — the run plus every case's result. */
export const EvalSuiteRunDetail = EvalSuiteRun.extend({
  results: z.array(EvalCaseResult),
});
export type EvalSuiteRunDetail = z.infer<typeof EvalSuiteRunDetail>;

/**
 * A case in the Evals tab list, with its result in the latest completed suite run.
 * `latest_single` is the secondary marker: non-null only when a single-case run of this case
 * is newer than that suite run (or there is no completed suite run).
 */
export const EvalCaseListItem = EvalCase.extend({
  last_result: z.enum(['passed', 'failed', 'errored', 'never_run']),
  latest_single: z
    .object({
      run_id: z.string(),
      status: EvalCaseResultStatus,
      started_at: z.string(),
    })
    .nullable(),
});
export type EvalCaseListItem = z.infer<typeof EvalCaseListItem>;

/**
 * `GET /eval-cases/:id/runs/latest` — the case editor's read. `latest` is the newest finished
 * result of this case from a run of either kind; `running` is a running single run of it.
 */
export const EvalCaseRunState = z.object({
  latest: z.object({ run: EvalSuiteRun, result: EvalCaseResult }).nullable(),
  running: EvalSuiteRun.nullable(),
});
export type EvalCaseRunState = z.infer<typeof EvalCaseRunState>;

/** `GET /agents/:id/eval-cases` — `passing` / `total` cover the current cases only. */
export const EvalCaseList = z.object({
  cases: z.array(EvalCaseListItem),
  passing: z.number().int(),
  total: z.number().int(),
  latest_run_id: z.string().nullable(),
});
export type EvalCaseList = z.infer<typeof EvalCaseList>;

/** `POST /findings/:id/eval-case` — `created: false` reports the case that already existed. */
export const EvalCaseCreateResult = z.object({
  case: EvalCase,
  created: z.boolean(),
});
export type EvalCaseCreateResult = z.infer<typeof EvalCaseCreateResult>;

/** A metric that dropped between the two latest completed runs, in percentage points. */
export const EvalRegression = z.object({
  metric: z.enum(['recall', 'precision', 'citation_accuracy']),
  drop_points: z.number(),
});
export type EvalRegression = z.infer<typeof EvalRegression>;

/** One card on the workspace dashboard: an agent that has cases and its latest run. */
export const EvalAgentCard = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  latest: EvalSuiteRun.nullable(),
});
export type EvalAgentCard = z.infer<typeof EvalAgentCard>;

/** `GET /agents/:id/eval-runs/compare?a=&b=` — values older → newer, deltas newer − older. */
export const EvalRunComparison = z.object({
  older: EvalSuiteRun,
  newer: EvalSuiteRun,
  deltas: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  case_sets: z.object({
    same: z.boolean(),
    older_count: z.number().int(),
    newer_count: z.number().int(),
    edited_count: z.number().int(),
  }),
  model_changed: z.boolean(),
  skills_changed: z.boolean(),
});
export type EvalRunComparison = z.infer<typeof EvalRunComparison>;

/** One point on the dashboard trend (per completed run, chronological). */
export const EvalTrendPoint = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  agent_version: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number().nullable(),
  cases_passed: z.number().int(),
  cases_total: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an agent, or the whole workspace (`owner_*` null, `agents` filled). */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  owner_name: z.string().nullable(),
  cases_total: z.number().int(),
  current: EvalMetrics.extend({
    cases_passed: z.number().int(),
    cases_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }).nullable(),
  /** Metrics as signed percentage points, `cases_passed` as a signed case count; null when either run lacks the value. */
  delta: EvalMetrics.extend({
    cases_passed: z.number().int().nullable(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalSuiteRun),
  /** One card per agent with cases; `[]` on a per-agent dashboard. */
  agents: z.array(EvalAgentCard),
  running: EvalSuiteRun.nullable(),
  regressions: z.array(EvalRegression),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
