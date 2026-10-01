import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
// Declared here, ahead of the Agents block, because `Onboarding` uses it at
// module-evaluation time.
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

/** Display order of the tour's five sections. */
export const OnboardingSectionId = z.enum([
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionId = z.infer<typeof OnboardingSectionId>;

/** A file the index picked, with the model's one-line reason (null when it gave none). */
export const OnboardingFile = z.object({
  path: z.string(),
  reason: z.string().nullable(),
});
export type OnboardingFile = z.infer<typeof OnboardingFile>;

export const OnboardingCommand = z.object({
  line: z.string(),
  source_path: z.string(),
});
export type OnboardingCommand = z.infer<typeof OnboardingCommand>;

export const OnboardingTask = z.object({
  text: z.string(),
  paths: z.array(z.string()).min(1),
});
export type OnboardingTask = z.infer<typeof OnboardingTask>;

/** The stored tour — one per repo. Every path in it was grounded before storing. */
export const Onboarding = z.object({
  repo_id: z.string(),
  generated_at: z.string(),
  index_sha: z.string(),
  files_indexed: z.number().int(),
  provider: Provider,
  model: z.string(),
  architecture: z.object({ prose: z.string(), diagram: z.string().nullable() }),
  critical_paths: z.array(OnboardingFile).max(6),
  run_locally: z.array(OnboardingCommand).max(10),
  reading_path: z.array(OnboardingFile).max(8),
  first_tasks: z.array(OnboardingTask).max(5),
});
export type Onboarding = z.infer<typeof Onboarding>;

/** `GET /repos/:id/onboarding` — the stored tour plus what the page needs around it. */
export const OnboardingPage = z.object({
  repo: z.object({
    name: z.string(),
    full_name: z.string(),
    default_branch: z.string(),
  }),
  tour: Onboarding.nullable(),
  generating: z.boolean(),
  stale: z.boolean(),
});
export type OnboardingPage = z.infer<typeof OnboardingPage>;

/** `POST /repos/:id/onboarding/generate` takes no input; send `{}`. */
export const OnboardingGenerateBody = z.object({}).strict();
export type OnboardingGenerateBody = z.infer<typeof OnboardingGenerateBody>;

/**
 * What the model returns — the model's contract, enforced out of band by
 * `response_format: json_schema`. No `.max()` and no `.optional()` (strict
 * json_schema); caps and the path check are applied in code before storing.
 */
export const OnboardingDraft = z.object({
  architecture: z
    .string()
    .describe('Markdown prose: what the system is and how its main parts fit together.'),
  diagram: z
    .string()
    .nullable()
    .describe('A Mermaid flowchart of the architecture, without code fences; null when none.'),
  file_reasons: z
    .array(
      z.object({
        path: z.string().describe('Repo-relative path of a listed file, exactly as shown.'),
        reason: z.string().describe('One line on why a new contributor should read this file.'),
      }),
    )
    .describe('One entry per listed file; only for files in the provided list.'),
  commands: z
    .array(
      z.object({
        line: z.string().describe('One shell command line to set up or run the project.'),
        source_path: z.string().describe('Path of the provided file the command comes from.'),
      }),
    )
    .describe('Commands to run the project locally, in order.'),
  first_tasks: z
    .array(
      z.object({
        text: z.string().describe('One line describing a starter task for a new contributor.'),
        paths: z.array(z.string()).describe('Provided file paths the task touches, at least one.'),
      }),
    )
    .describe('Starter tasks, one line each.'),
});
export type OnboardingDraft = z.infer<typeof OnboardingDraft>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum([
  'manual',
  'imported_url',
  'imported_file',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

/** One line an imported body tripped on — `rule` is a stable id the client maps to copy. */
export const SkillSecurityFinding = z.object({
  rule: z.string(),
  line: z.number().int(),
  excerpt: z.string(),
});
export type SkillSecurityFinding = z.infer<typeof SkillSecurityFinding>;

/** `not_scanned` for `manual` / `extracted` bodies (authored or accepted by the user). */
export const SkillSecurityStatus = z.enum(['clean', 'flagged', 'not_scanned']);
export type SkillSecurityStatus = z.infer<typeof SkillSecurityStatus>;

/**
 * Heuristic prompt-injection scan of an `imported_*` body. Computed on read,
 * never persisted; a `flagged` skill cannot be enabled until its body is
 * edited clean. Complements — does not replace — the prompt-time untrusted
 * wrapping and INJECTION_GUARD.
 */
export const SkillSecurityReport = z.object({
  status: SkillSecurityStatus,
  findings: z.array(SkillSecurityFinding),
});
export type SkillSecurityReport = z.infer<typeof SkillSecurityReport>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  /** Agents this skill is linked to (any binding, enabled or not). Built per request. */
  agent_count: z.number().int(),
  security: SkillSecurityReport,
});
export type Skill = z.infer<typeof Skill>;

export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  note: z.string().nullish(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/** One archive entry, as shown in the import preview. */
export const SkillImportEntry = z.object({
  path: z.string(),
  bytes: z.number().int(),
  kept: z.boolean(),
  reason: z.string(), // 'skill body' | 'not markdown' | 'executable — discarded' | …
});
export type SkillImportEntry = z.infer<typeof SkillImportEntry>;

export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  entries: z.array(SkillImportEntry),
  discarded: z.number().int(),
  warnings: z.array(z.string()),
  security: SkillSecurityReport,
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

/**
 * Per-skill usage. Attribution is AGENT-level: a finding cannot be proven to
 * come from a skill, so every number here counts the runs of the agents this
 * skill is attached to. The UI must say so.
 */
export const SkillStats = z.object({
  agents: z.number().int(),
  runs_30d: z.number().int(),
  findings_30d: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  accept_rate: z.number().nullable(), // null when accepted + dismissed === 0
  by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
});
export type SkillStats = z.infer<typeof SkillStats>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
/** Closed set so strict json_schema output and the card badge colour map agree. */
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'imports',
  'typing',
  'async',
  'error_handling',
  'testing',
  'api',
  'style',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/** A rejection is a state that survives a rescan, not the absence of acceptance. */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  /** The line the snippet was FOUND on during grounding — not the model's claim. */
  evidence_line: z.number().int().nullish(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  edited: z.boolean(),
  /** The skill that absorbed this candidate, once one was created from it. */
  skill_id: z.string().nullish(),
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionScanStatus = z.enum(['running', 'done', 'failed']);
export type ConventionScanStatus = z.infer<typeof ConventionScanStatus>;

export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  status: ConventionScanStatus,
  provider: z.string(),
  model: z.string(),
  sampled_files: z.array(z.string()),
  candidates_total: z.number().int(),
  candidates_grounded: z.number().int(),
  dropped_ungrounded: z.number().int(),
  dropped_duplicate: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(), // null = unknown, never 0
  error: z.string().nullish(),
  started_at: z.string(),
  finished_at: z.string().nullish(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** `GET /repos/:id/conventions` — the newest scan plus every non-rejected candidate. */
export const ConventionsPage = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
  rejected_count: z.number().int(),
});
export type ConventionsPage = z.infer<typeof ConventionsPage>;

/**
 * What the extraction model returns — the model's contract, enforced out of
 * band by `response_format: json_schema`. Not a DTO: the server verifies every
 * citation in code before anything is stored (`ConventionCandidate`).
 */
export const ConventionExtraction = z.object({
  candidates: z.array(
    z.object({
      category: ConventionCategory.describe('Which kind of convention this is.'),
      rule: z.string().describe('One imperative sentence a code reviewer can apply to a diff.'),
      evidence: z.object({
        path: z.string().describe('Repo-relative path of a sampled file, exactly as shown.'),
        line: z.number().int().describe('The line number shown in front of the quoted line.'),
        snippet: z.string().describe('That line, copied verbatim (without the line number).'),
      }),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe('How consistently the sample follows the rule, 0..1.'),
    }),
  ),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/** What `POST …/conventions/skill/preview` returns — editable before create. */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  evidence_files: z.array(z.string()),
  candidate_ids: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

// ---- Agents ----

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
