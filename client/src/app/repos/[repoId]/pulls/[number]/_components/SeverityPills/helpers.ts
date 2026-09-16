import type { FindingRecord, Severity, SeverityCounts } from "@devdigest/shared";

/** Display order: most severe first, matching FindingsPanel's sort. */
export const PILL_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/**
 * Tally findings by severity.
 *
 * Deliberately counts the SAME array the cards below are rendered from, so a
 * pill's number and the cards it filters to cannot drift apart — the two are
 * one computation, not two that happen to agree.
 */
export function countBySeverity(findings: FindingRecord[]): SeverityCounts {
  const c: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL") c.CRITICAL += 1;
    else if (f.severity === "WARNING") c.WARNING += 1;
    else if (f.severity === "SUGGESTION") c.SUGGESTION += 1;
  }
  return c;
}
