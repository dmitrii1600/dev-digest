import { z } from 'zod';
import { Provider } from './knowledge.js';
import { SeverityCounts } from './findings.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    // Cheap by default — this is a small pre-review classification call that
    // runs on every fresh head. The Settings override wins.
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    // Cheap by default — a scan reads ~60k tokens of samples; same default as
    // onboarding. The workspace override in Settings → Feature Models wins.
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // Total USD this PR has cost: EVERY completed run, summed (list endpoint
  // only). Runs with unknown cost are skipped, never added as 0. Null/absent
  // when no run reported a cost.
  cost_usd: z.number().nullish(),
  // Severity breakdown of the PR's LATEST review (list endpoint only) — the
  // same review `score` above is taken from, so the donut and the chips can
  // never disagree. Null/absent until the PR has been reviewed.
  findings_counts: SeverityCounts.nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
export const ContextDocKind = z.enum(['specs', 'docs', 'insights', 'other']);
export type ContextDocKind = z.infer<typeof ContextDocKind>;

/** Why a listed document cannot be edited from the Project Context page. */
export const ContextReadOnlyReason = z.enum(['outside_root', 'tracked', 'too_large']);
export type ContextReadOnlyReason = z.infer<typeof ContextReadOnlyReason>;

/** Optimistic-concurrency token: SHA-256 hex of the file's bytes on disk. */
export const ContextFileVersion = z.string().regex(/^[0-9a-f]{64}$/);
export type ContextFileVersion = z.infer<typeof ContextFileVersion>;

export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
  kind: ContextDocKind.nullish(),
  /** Tokens of the block as injected (capped). */
  tokens: z.number().int().nullish(),
  used_by: z.number().int().nullish(),
  /** SHA-256 hex of the on-disk bytes; the token a save or delete sends back. */
  version: ContextFileVersion.nullish(),
  /** True only for an untracked, <= 64 KB file under `.devdigest/specs/`. */
  editable: z.boolean().nullish(),
  read_only_reason: ContextReadOnlyReason.nullish(),
});
export type SpecFile = z.infer<typeof SpecFile>;

/** `total` is the uncapped count; `files` holds at most 500 entries, no `content`. */
export const ContextFileList = z.object({
  cloned: z.boolean(),
  total: z.number().int(),
  files: z.array(SpecFile),
});
export type ContextFileList = z.infer<typeof ContextFileList>;

export const ContextPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => p.toLowerCase().endsWith('.md'), { message: 'path must end in .md' });
export type ContextPath = z.infer<typeof ContextPath>;

export const ContextFileQuery = z.object({ path: ContextPath }).strict();
export type ContextFileQuery = z.infer<typeof ContextFileQuery>;

export const ContextRepoQuery = z.object({ repoId: z.string().uuid() }).strict();
export type ContextRepoQuery = z.infer<typeof ContextRepoQuery>;

export const ContextAttachmentsInput = z
  .object({ paths: z.array(ContextPath).max(500) })
  .strict()
  .refine((v) => new Set(v.paths).size === v.paths.length, {
    message: 'paths must be unique',
    path: ['paths'],
  });
export type ContextAttachmentsInput = z.infer<typeof ContextAttachmentsInput>;

/**
 * Body for PUT /repos/:id/context/file. `max` counts UTF-16 units, a safe
 * pre-filter; the exact byte rule runs in the service after CRLF to LF.
 * `version: null` means "expect the file to be absent".
 */
export const ContextFileSave = z
  .object({
    path: ContextPath,
    content: z.string().max(65_536),
    version: ContextFileVersion.nullable(),
  })
  .strict();
export type ContextFileSave = z.infer<typeof ContextFileSave>;

/** Query for DELETE /repos/:id/context/file. */
export const ContextFileDeleteQuery = z
  .object({ path: ContextPath, version: ContextFileVersion })
  .strict();
export type ContextFileDeleteQuery = z.infer<typeof ContextFileDeleteQuery>;

/** Body for POST /repos/:id/context/files (new file or new folder). */
export const ContextFileCreate = z
  .object({ kind: z.enum(['file', 'folder']), name: z.string().min(1).max(255) })
  .strict();
export type ContextFileCreate = z.infer<typeof ContextFileCreate>;

/** Body for POST /repos/:id/context/upload. 87,384 = 4 * ceil(65,536 / 3) base64 chars. */
export const ContextFileUpload = z
  .object({
    name: z.string().min(1).max(255),
    content_base64: z
      .string()
      .max(87_384)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
export type ContextFileUpload = z.infer<typeof ContextFileUpload>;

/** `details` of a 409 whose `error.code` is `version_conflict`. */
export const ContextConflictDetails = z.object({
  reason: z.enum(['changed', 'deleted']),
  current_version: ContextFileVersion.nullable(),
});
export type ContextConflictDetails = z.infer<typeof ContextConflictDetails>;

export const ContextAttachments = z.object({
  repo_id: z.string(),
  paths: z.array(z.string()),
});
export type ContextAttachments = z.infer<typeof ContextAttachments>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
