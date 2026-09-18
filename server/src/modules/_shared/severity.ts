import type { SeverityCounts } from '@devdigest/shared';

/**
 * Tally finding severities for a set of findings.
 *
 * Shared because two modules count the same thing from the same rows: the PR
 * list (`pulls/routes.ts` — the latest review per PR) and the run timeline
 * (`reviews/repository/run.repo.ts` — per run). One implementation means the
 * two surfaces cannot drift apart.
 *
 * Keys are the `Severity` enum's own spelling (UPPERCASE) because the result is
 * serialized straight onto `PrMeta.findings_counts` / `RunSummary.findings_counts`
 * — re-casing here would mean re-casing back in every reader.
 *
 * `findings.severity` is a free-text column, not a pg enum, so a row holding
 * anything outside the three known levels is ignored rather than crashing the
 * endpoint.
 */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.CRITICAL += 1;
    else if (r.severity === 'WARNING') c.WARNING += 1;
    else if (r.severity === 'SUGGESTION') c.SUGGESTION += 1;
  }
  return c;
}
