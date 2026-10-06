import type { EvalTrendPoint } from "@devdigest/shared";

export interface TrendRow {
  i: number;
  recall: number | null;
  precision: number | null;
  citation: number | null;
  /** Carried for the tooltip only. */
  ran_at: string;
  agent_version: number;
  cost_usd: number | null;
}

const toPercent = (v: number | null): number | null => (v == null ? null : Math.round(v * 1000) / 10);

/** One chart row per run, oldest first, values as percent. A metric that was not
 *  available stays `null` — the line gaps there; it is never plotted as 0 % (EC-12).
 *  No cap: the caller decides the range (a time window, or every run). */
export function toChartRows(trend: EvalTrendPoint[]): TrendRow[] {
  return trend.map((p, i) => ({
    i,
    recall: toPercent(p.recall),
    precision: toPercent(p.precision),
    citation: toPercent(p.citation_accuracy),
    ran_at: p.ran_at,
    agent_version: p.agent_version,
    cost_usd: p.cost_usd,
  }));
}
