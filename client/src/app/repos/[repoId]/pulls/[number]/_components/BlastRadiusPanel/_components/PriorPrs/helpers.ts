/** Pure helpers for `PriorPrs` — no React, no hooks. */

const MERGED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** `"2026-03-18T00:00:00Z"` → `"Mar 18, 2026"`. */
export function formatMergedDate(iso: string): string {
  return MERGED_DATE_FORMAT.format(new Date(iso));
}
