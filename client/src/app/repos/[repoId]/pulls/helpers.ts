import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { sortBySeverity } from "@/components/findings-preview";
import { SIZE_MEDIUM_MAX, SIZE_SMALL_MAX, type PrMeta, type SizeInfo } from "./constants";

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: PrMeta): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

/** Compact relative time for the list's UPDATED column (e.g. "3h", "2d"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Findings of a PR's LATEST review, most severe first.
 *
 * Mirrors the rule the API applies to `PrMeta.findings_counts` (the single
 * newest review, not a merge across agents), so the hover preview and the
 * severity chips it hangs off can never show different numbers. `/pulls/:id/reviews`
 * returns reviews newest-first, so the first one wins.
 */
export function latestReviewFindings(reviews: ReviewRecord[] | undefined): FindingRecord[] {
  const latest = (reviews ?? []).find((r) => r.kind === "review");
  return latest ? sortBySeverity(latest.findings) : [];
}
