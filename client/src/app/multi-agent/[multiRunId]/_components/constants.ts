import type { Severity } from "@devdigest/shared";

/** How far (in lines) two findings of different agents may be apart and still
   count as the same location: each range is widened by this on both sides. */
export const MATCH_LINE_SLACK = 3;

/** Lower rank = more severe. Local on purpose: a runtime import from
   `@devdigest/shared` breaks the webpack build (client/INSIGHTS). */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
