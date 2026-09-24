import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { ROLE_RULES, SMART_DIFF_ROLE_ORDER, type NormalizedPath } from './constants.js';
import type { SmartDiffFileInput, SmartDiffFindingInput, SmartDiffReviewInput } from './repository.js';

/**
 * Smart Diff (L03) — pure classifier + builder. Ring 2: no `drizzle-orm`,
 * `db/*`, `fastify` or `zod` runtime import; the `service.ts` caller supplies
 * plain data read by `repository.ts`. No LLM call anywhere in this module.
 */

/** `\` → `/`, lowercased, split into directory segments + basename. */
export function normalizePath(path: string): NormalizedPath {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const parts = normalized.split('/').filter((part) => part.length > 0);
  const base = parts[parts.length - 1] ?? '';
  const segments = parts.slice(0, -1);
  return { path: normalized, segments, base };
}

/** First matching rule wins (spec §Scope rules 1–4), else `core`. */
export function classifyFile(path: string): SmartDiffRole {
  const normalized = normalizePath(path);
  for (const rule of ROLE_RULES) {
    if (rule.test(normalized)) return rule.role;
  }
  return 'core';
}

/**
 * "Which findings count" (spec decision 1): the latest `kind='review'` review
 * per agent — `agentId ?? null` keyed, so `null` is its own bucket. Compared
 * explicitly by `createdAt`, never by input order, so a shuffled input array
 * gives the same result. The caller (repository.ts) has already filtered to
 * `kind === 'review'`.
 */
export function latestReviewPerAgent(
  reviews: readonly SmartDiffReviewInput[],
): SmartDiffReviewInput[] {
  const byAgent = new Map<string, SmartDiffReviewInput>();
  for (const review of reviews) {
    const key = review.agentId ?? '∅';
    const current = byAgent.get(key);
    if (!current || review.createdAt.getTime() > current.createdAt.getTime()) {
      byAgent.set(key, review);
    }
  }
  return [...byAgent.values()];
}

/**
 * Groups `files` into the five roles (non-empty groups only, in
 * `SMART_DIFF_ROLE_ORDER`, GitHub order kept within a group) and attaches
 * each file's sorted, unique, non-dismissed `finding_lines`. `findings` is
 * expected to already be the flattened result of `latestReviewPerAgent` (the
 * caller's job, not this function's) — a dismissed finding, and any finding
 * for a file not in `files`, is ignored here regardless. `split_suggestion`
 * is the spec's stub: `too_big` is always `false`, `proposed_splits` is
 * always `[]`; `total_lines` is the real Σ(additions + deletions).
 */
export function buildSmartDiff(
  files: readonly SmartDiffFileInput[],
  findings: readonly SmartDiffFindingInput[],
): SmartDiff {
  const linesByPath = new Map<string, number[]>();
  for (const finding of findings) {
    if (finding.dismissedAt != null) continue;
    const lines = linesByPath.get(finding.file) ?? [];
    lines.push(finding.startLine);
    linesByPath.set(finding.file, lines);
  }

  const filesByRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    const findingLines = [...new Set(linesByPath.get(file.path) ?? [])].sort((a, b) => a - b);
    const entry: SmartDiffFile = {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines,
    };
    const bucket = filesByRole.get(role);
    if (bucket) bucket.push(entry);
    else filesByRole.set(role, [entry]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of SMART_DIFF_ROLE_ORDER) {
    const bucket = filesByRole.get(role);
    if (bucket && bucket.length > 0) groups.push({ role, files: bucket });
  }

  const totalLines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);

  return {
    groups,
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
