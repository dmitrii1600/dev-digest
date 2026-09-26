import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { ChatMessage, IntentSource, PlanOrigin, PrIntentRecord, UnifiedDiff } from '@devdigest/shared';
import type { IntentRow } from './repository.js';
import { INTENT_SCHEMA_NAME, INTENT_SYSTEM_PROMPT, MAX_FILES_IN_DIGEST, MAX_HUNKS_PER_FILE, MAX_PLAN_CHARS, MAX_PLAN_REFS } from './constants.js';

/**
 * Pure helpers for the Intent Layer: the changed-file digest, the plan/spec
 * detectors, the confidence formula, and the classifier's messages + DTO
 * mapping. Nothing here touches the filesystem, the network or the database
 * (the clone reader is `repository-plans.ts`, ring 3; the GitHub/URL
 * resolvers live in `service.ts`), so all of it is covered by the hermetic
 * `intent-helpers.test.ts`.
 */

export { INTENT_SCHEMA_NAME };

// ---------------------------------------------------------------- Changed files

/**
 * The classifier's `## Changed files` section when a real diff was loaded:
 * one line per file — `` `path` +N/-M `` — followed by its hunk headers
 * rebuilt from the structured hunk fields. NO `+`/`-` content line, no `raw`,
 * ever: this is arithmetic on numbers already in the type, never diff text.
 */
export function synthesizeFileDigest(files: UnifiedDiff['files']): string {
  if (files.length === 0) return '(no files changed)';
  const lines: string[] = [];
  for (const f of files.slice(0, MAX_FILES_IN_DIGEST)) {
    lines.push(`\`${f.path}\` +${f.additions}/-${f.deletions}`);
    for (const h of f.hunks.slice(0, MAX_HUNKS_PER_FILE)) {
      lines.push(`  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    }
    if (f.hunks.length > MAX_HUNKS_PER_FILE) {
      lines.push(`  … (${f.hunks.length - MAX_HUNKS_PER_FILE} more hunk(s))`);
    }
  }
  if (files.length > MAX_FILES_IN_DIGEST) {
    lines.push(`… (${files.length - MAX_FILES_IN_DIGEST} more file(s))`);
  }
  return lines.join('\n');
}

/**
 * The fallback digest when no diff was loaded (the standalone route): just
 * the persisted `pr_files` counts — paths and add/del, no hunk headers. The
 * caller records this source as `partial`, never `available`.
 */
export function synthesizeFileDigestFromCounts(
  files: { path: string; additions: number; deletions: number }[],
): string {
  if (files.length === 0) return '(no files recorded)';
  return files
    .slice(0, MAX_FILES_IN_DIGEST)
    .map((f) => `\`${f.path}\` +${f.additions}/-${f.deletions}`)
    .join('\n');
}

// ---------------------------------------------------------------- Tier A: inline plan

export interface InlinePlan {
  /** The heading or marker that identified the section (for the source's `ref`). */
  heading: string;
  text: string;
}

const PLAN_HEADING_RE = /^(#{2,3})\s*(Plan|Spec|Specification|План|Специфікація)\b/i;
const HEADING_RE = /^(#{1,6})\s/;
const TASK_ITEM_RE = /^\s*-\s*\[[ xX]\]\s+/;
const FENCE_RE = /```[\s\S]*?```/g;

function matchPlanHeading(body: string): InlinePlan | null {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = PLAN_HEADING_RE.exec(lines[i]!);
    if (!m) continue;
    const level = m[1]!.length;
    const heading = lines[i]!.trim();
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const h = HEADING_RE.exec(lines[j]!);
      if (h && h[1]!.length <= level) {
        end = j;
        break;
      }
    }
    const text = lines.slice(i + 1, end).join('\n').trim();
    if (text.length === 0) return null;
    return { heading, text: text.slice(0, MAX_PLAN_CHARS) };
  }
  return null;
}

function matchTaskList(body: string): InlinePlan | null {
  const lines = body.split(/\r?\n/);
  let bestStart = -1;
  let bestEnd = -1;
  let bestCount = 0;
  let i = 0;
  while (i < lines.length) {
    if (TASK_ITEM_RE.test(lines[i]!)) {
      const start = i;
      let count = 0;
      while (i < lines.length && (TASK_ITEM_RE.test(lines[i]!) || lines[i]!.trim() === '')) {
        if (TASK_ITEM_RE.test(lines[i]!)) count += 1;
        i += 1;
      }
      if (count > bestCount) {
        bestCount = count;
        bestStart = start;
        bestEnd = i;
      }
    } else {
      i += 1;
    }
  }
  if (bestCount < 3) return null;
  const text = lines.slice(bestStart, bestEnd).join('\n').trim();
  if (text.length === 0) return null;
  return { heading: 'task-list', text: text.slice(0, MAX_PLAN_CHARS) };
}

function matchDominantFence(body: string): InlinePlan | null {
  const matches = [...body.matchAll(FENCE_RE)];
  if (matches.length !== 1) return null;
  const fence = matches[0]![0];
  const trimmed = body.trim();
  if (trimmed.length === 0 || fence.length < trimmed.length * 0.6) return null;
  const inner = fence.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, '').trim();
  if (inner.length === 0) return null;
  return { heading: 'fenced-block', text: inner.slice(0, MAX_PLAN_CHARS) };
}

/**
 * Tier A — the plan/spec already written into the PR body itself: a
 * `## Plan` / `## Spec` / `## Specification` / `## План` / `## Специфікація`
 * heading (case-insensitive) up to the next same-or-higher-level heading;
 * falling back to a top-level task list (≥ 3 items) or a single fenced block
 * that makes up most of the body. Pure string work, no I/O.
 */
export function extractInlinePlan(body: string): InlinePlan | null {
  if (!body || body.trim().length === 0) return null;
  return matchPlanHeading(body) ?? matchTaskList(body) ?? matchDominantFence(body);
}

// ---------------------------------------------------------------- Tiers B–D: refs

export interface PlanRef {
  /** The raw text matched in the body (for display / dedup). */
  raw: string;
  origin: Exclude<PlanOrigin, 'inline'>;
  /** repo-relative path (`repo_file`), issue number as a string (`github_issue`), or the URL (`external_url`). */
  target: string;
}

const GH_BLOB_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/blob\/[^/\s]+\/([^\s)>\]"'`]+)/g;
const GH_ISSUE_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/issues\/(\d+)/g;
const GENERIC_URL_RE = /https?:\/\/[^\s)>\]"'`]+/g;
const OWNER_REPO_ISSUE_RE = /\b[\w.-]+\/[\w.-]+#(\d+)\b/g;
const BARE_ISSUE_RE = /(^|[^\w/])#(\d+)\b/g;
const REL_MD_PATH_RE = /(^|[^:/\w])([a-zA-Z0-9_][\w./-]*\.mdx?)\b/g;

/**
 * Percent-decode a blob-URL path from the (untrusted) PR body. A malformed
 * escape (`docs/100%.md`) makes `decodeURIComponent` throw `URIError`; keep the
 * raw path instead, so one bad link becomes an `unavailable` source rather than
 * failing the whole derivation.
 */
function decodePathSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Blank out every match of `re` (same length, so offsets of other regexes are unaffected). */
function blank(body: string, re: RegExp): string {
  return body.replace(re, (m) => ' '.repeat(m.length));
}

/**
 * Tiers B–D — every plan/spec-shaped reference in the PR body, deduped and
 * capped at `MAX_PLAN_REFS`. Classification only — this function never
 * fetches; the resolvers in `service.ts` / `repository-plans.ts` do, and they
 * are ring 3. `repoFullName` (`owner/name`) is used only to decide whether a
 * GitHub blob URL points at THIS repo (→ `repo_file`) or elsewhere
 * (→ `external_url`) — still pure string comparison, no I/O.
 */
export function detectPlanRefs(body: string, repoFullName: string): PlanRef[] {
  const refs: PlanRef[] = [];
  const seen = new Set<string>();
  const push = (raw: string, origin: PlanRef['origin'], target: string) => {
    if (refs.length >= MAX_PLAN_REFS) return;
    const key = `${origin}:${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ raw, origin, target });
  };

  let working = body;

  for (const m of body.matchAll(GH_BLOB_URL_RE)) {
    const [raw, owner, repoName, path] = m as unknown as [string, string, string, string];
    if (`${owner}/${repoName}`.toLowerCase() === repoFullName.toLowerCase()) {
      push(raw, 'repo_file', decodePathSafe(path));
    } else {
      push(raw, 'external_url', raw);
    }
  }
  working = blank(working, GH_BLOB_URL_RE);

  for (const m of working.matchAll(GH_ISSUE_URL_RE)) {
    const [raw, , , n] = m as unknown as [string, string, string, string];
    push(raw, 'github_issue', n);
  }
  working = blank(working, GH_ISSUE_URL_RE);

  for (const m of working.matchAll(GENERIC_URL_RE)) {
    const [raw] = m;
    push(raw, 'external_url', raw);
  }
  working = blank(working, GENERIC_URL_RE);

  for (const m of working.matchAll(OWNER_REPO_ISSUE_RE)) {
    const [raw, n] = m as unknown as [string, string];
    push(raw, 'github_issue', n!);
  }
  working = blank(working, OWNER_REPO_ISSUE_RE);

  for (const m of working.matchAll(BARE_ISSUE_RE)) {
    const n = (m as unknown as [string, string, string])[2];
    push(`#${n}`, 'github_issue', n!);
  }
  working = blank(working, BARE_ISSUE_RE);

  for (const m of working.matchAll(REL_MD_PATH_RE)) {
    const path = (m as unknown as [string, string, string])[2];
    push(path!, 'repo_file', path!);
  }

  return refs.slice(0, MAX_PLAN_REFS);
}

// ---------------------------------------------------------------- Confidence

/**
 * Weights, summed then penalised, clamped to `[0.05, 0.95]`. `plan_spec`
 * contributes its full weight once — when at least one `plan_spec` source is
 * `available` — not per-reference; `changed_files` partial credit is `.15`
 * (hunk-less pr_files fallback), everything else's partial credit is half its
 * full weight. Never self-reported by the model — the same rule that already
 * makes the review `score` a recomputation rather than a model claim.
 */
const SOURCE_WEIGHTS: Record<string, number> = {
  pr_title: 0.1,
  pr_body: 0.2,
  changed_files: 0.25,
  plan_spec: 0.3,
  project_context: 0.15,
};

const STATUS_RANK: Record<IntentSource['status'], number> = {
  unavailable: 0,
  partial: 1,
  available: 2,
};

export function deriveConfidence(sources: IntentSource[]): number {
  const bestByKind = new Map<string, IntentSource['status']>();
  let hasAvailablePlan = false;
  let unresolvedRefs = 0;

  for (const s of sources) {
    if (s.kind === 'plan_spec') {
      if (s.status === 'available') hasAvailablePlan = true;
      else unresolvedRefs += 1;
      continue;
    }
    if (s.kind === 'linked_issue') continue; // not part of the weighted formula
    const prev = bestByKind.get(s.kind);
    if (!prev || STATUS_RANK[s.status] > STATUS_RANK[prev]) bestByKind.set(s.kind, s.status);
  }

  let score = 0;
  for (const [kind, weight] of Object.entries(SOURCE_WEIGHTS)) {
    if (kind === 'plan_spec') {
      if (hasAvailablePlan) score += weight;
      continue;
    }
    const status = bestByKind.get(kind);
    if (status === 'available') score += weight;
    else if (status === 'partial') score += kind === 'changed_files' ? 0.15 : weight / 2;
  }

  const penalty = 1 - 0.1 * Math.min(unresolvedRefs, 3);
  return Math.min(0.95, Math.max(0.05, score * penalty));
}

// ---------------------------------------------------------------- Classifier request

export interface ResolvedPlan {
  /** The source's `ref` — reused as the `wrapUntrusted` label suffix. */
  ref: string;
  text: string;
}

export interface IntentMessageInput {
  prTitle: string;
  prBody: string | null;
  fileDigest: string;
  specChunks: string[];
  plans: ResolvedPlan[];
  /** One line per reference that could not be retrieved — never invented content. */
  unavailableNotes: string[];
}

/**
 * The classifier's two messages: system = `INTENT_SYSTEM_PROMPT`; user = the
 * task line plus one wrapped block per source, exactly as
 * `modules/conventions/helpers.ts` wraps its samples.
 */
export function buildIntentMessages(input: IntentMessageInput): ChatMessage[] {
  const parts: string[] = [
    'Classify the intent and scope of this pull request from the evidence below. ' +
      'Judge only from what is shown; do not infer the contents of anything not included.',
  ];
  parts.push(`## PR title\n${wrapUntrusted('pr-title', input.prTitle)}`);
  if (input.prBody && input.prBody.trim().length > 0) {
    parts.push(`## PR body\n${wrapUntrusted('pr-body', input.prBody)}`);
  }
  parts.push(`## Changed files\n${wrapUntrusted('changed-files', input.fileDigest)}`);
  if (input.specChunks.length > 0) {
    parts.push(
      `## Project context\n${input.specChunks.map((c, i) => wrapUntrusted(`spec:${i}`, c)).join('\n\n')}`,
    );
  }
  for (const plan of input.plans) {
    parts.push(`## Referenced plan/spec (${plan.ref})\n${wrapUntrusted(`plan:${plan.ref}`, plan.text)}`);
  }
  if (input.unavailableNotes.length > 0) {
    parts.push(`## Notes on unavailable references\n${input.unavailableNotes.map((n) => `- ${n}`).join('\n')}`);
  }
  return [
    { role: 'system', content: INTENT_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

// ---------------------------------------------------------------- DTO

export function toIntentDto(row: IntentRow, currentHeadSha: string | null): PrIntentRecord {
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    pr_id: row.prId,
    confidence: row.confidence,
    sources: row.sources,
    head_sha: row.headSha,
    provider: row.provider,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    error: row.error,
    generated_at: row.generatedAt.toISOString(),
    stale: row.headSha === null || currentHeadSha === null ? true : row.headSha !== currentHeadSha,
  };
}
