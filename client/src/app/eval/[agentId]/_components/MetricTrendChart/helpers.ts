import type { EvalTrendPoint } from "@devdigest/shared";

/** The trend shows the newest runs only (AC-12). */
export const TREND_MAX_POINTS = 20;

export interface TrendRow {
  i: number;
  recall: number | null;
  precision: number | null;
  citation: number | null;
}

const toPercent = (v: number | null): number | null => (v == null ? null : Math.round(v * 1000) / 10);

/** One chart row per run, oldest first, values as percent. A metric that was not
 *  available stays `null` — the line gaps there; it is never plotted as 0 % (EC-8). */
export function toChartRows(trend: EvalTrendPoint[]): TrendRow[] {
  return trend.slice(-TREND_MAX_POINTS).map((p, i) => ({
    i,
    recall: toPercent(p.recall),
    precision: toPercent(p.precision),
    citation: toPercent(p.citation_accuracy),
  }));
}
