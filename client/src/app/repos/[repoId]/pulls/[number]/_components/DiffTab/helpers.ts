import type { FindingRecord, PrFile, ReviewRecord, SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { ROLE_ORDER } from "./constants";

const NO_AGENT = "∅";

/**
 * "Which findings count" (spec decision 1) — the latest `kind='review'`
 * review PER AGENT (`agent_id ?? null`; `null` is its own bucket),
 * non-dismissed only. This is the SAME rule the server applies
 * (`server/src/modules/smart-diff/helpers.ts#latestReviewPerAgent`), so the
 * `● N` counter, the file dot and the inline cards can never disagree with
 * what a Dismiss just did.
 *
 * Deliberately NOT `latestReviewFindings` (`pulls/helpers.ts:33`) — that is
 * the single-latest-review rule the PR list's severity chips use, a
 * different aggregation for a different surface. Do not "make them
 * consistent" — they describe different things on purpose.
 */
export function latestFindingsPerAgent(reviews: ReviewRecord[] | undefined): FindingRecord[] {
  const byAgent = new Map<string, ReviewRecord>();
  for (const review of reviews ?? []) {
    if (review.kind !== "review") continue;
    const key = review.agent_id ?? NO_AGENT;
    const current = byAgent.get(key);
    if (!current || Date.parse(review.created_at) > Date.parse(current.created_at)) {
      byAgent.set(key, review);
    }
  }
  return [...byAgent.values()]
    .flatMap((review) => review.findings)
    .filter((f) => f.dismissed_at == null);
}

/** Groups findings by their file path — the file card / line-matching lookup. */
export function findingsByPath(findings: FindingRecord[]): Map<string, FindingRecord[]> {
  const map = new Map<string, FindingRecord[]>();
  for (const finding of findings) {
    const list = map.get(finding.file);
    if (list) list.push(finding);
    else map.set(finding.file, [finding]);
  }
  return map;
}

export interface FileGroup {
  role: SmartDiffRole;
  files: PrFile[];
}

/**
 * Buckets `files` into the five roles — always all five, in `ROLE_ORDER`,
 * keeping `files`'s own (GitHub) order within a group, so Smart order and
 * Original order agree on in-group ordering. A path the smart-diff response
 * doesn't mention — including every path, when `smartDiff` itself is
 * undefined (still loading) — goes to `core`.
 */
export function groupFiles(files: PrFile[], smartDiff: SmartDiff | undefined): FileGroup[] {
  const roleByPath = new Map<string, SmartDiffRole>();
  for (const group of smartDiff?.groups ?? []) {
    for (const file of group.files) {
      roleByPath.set(file.path, group.role);
    }
  }

  const byRole = new Map<SmartDiffRole, PrFile[]>(ROLE_ORDER.map((role) => [role, []]));
  for (const file of files) {
    const role = roleByPath.get(file.path) ?? "core";
    byRole.get(role)!.push(file);
  }

  return ROLE_ORDER.map((role) => ({ role, files: byRole.get(role) ?? [] }));
}
