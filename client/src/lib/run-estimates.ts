/* run-estimates.ts — display helpers for the per-agent "time · cost" estimates
   shown by the PR-page picker and the Configure run screen. Unknown values are
   "—", never 0 (an unknown cost is not free). */
import type { AgentRunEstimate } from "@devdigest/shared";
import { formatRunCost } from "@/components/run-cost-badge/RunCostBadge";

const UNKNOWN = "—";

/** 6200 → "6.2"; null → null. */
export function formatSeconds1(ms: number | null | undefined): string | null {
  return ms == null ? null : (ms / 1000).toFixed(1);
}

export function estimateParts(est?: AgentRunEstimate): { time: string; cost: string } {
  const secs = formatSeconds1(est?.avg_duration_ms);
  return {
    time: secs == null ? UNKNOWN : `${secs}s`,
    cost: est?.avg_cost_usd == null ? UNKNOWN : formatRunCost(est.avg_cost_usd),
  };
}

/** Whole seconds for the "~{seconds}s" hint; null when unknown. */
export function hintSeconds(est?: AgentRunEstimate): number | null {
  return est?.avg_duration_ms == null ? null : Math.round(est.avg_duration_ms / 1000);
}

/** Fan-out aggregate: time = max over agents with a duration; cost = sum, or
   "—" as soon as any selected agent's cost is unknown. */
export function aggregateParts(selected: (AgentRunEstimate | undefined)[]): { time: string; cost: string } {
  const durations = selected.map((e) => e?.avg_duration_ms).filter((d): d is number => d != null);
  const time = durations.length ? `${formatSeconds1(Math.max(...durations))}s` : UNKNOWN;
  const costs = selected.map((e) => e?.avg_cost_usd);
  const known = costs.length > 0 && costs.every((c): c is number => c != null);
  const cost = known ? formatRunCost((costs as number[]).reduce((a, b) => a + b, 0)) : UNKNOWN;
  return { time, cost };
}
