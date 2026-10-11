import type { FindingRecord, Severity } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import type { EvalCaseStatus } from "../FindingCard";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * Optionally drop low-confidence findings, optionally keep a single severity,
 * then sort by severity.
 *
 * `severity: null` means "no severity filter" and reproduces the pre-filter
 * behaviour exactly, so the toggle's off state is the original list.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | null = null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severity) shown = shown.filter((f) => f.severity === severity);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** What the card says after a failed "Turn into eval case": a diff over the 64 KB
 *  freeze cap (422 `diff_too_large`, EC-12) is named; every other failure is generic. */
export function evalStatusForError(err: unknown): EvalCaseStatus {
  const details = err instanceof ApiError ? (err.details as { reason?: string } | undefined) : undefined;
  return err instanceof ApiError && err.status === 422 && details?.reason === "diff_too_large"
    ? "too_large"
    : "error";
}
