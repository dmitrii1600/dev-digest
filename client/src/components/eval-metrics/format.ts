/* Pure display formatters for eval metrics. A metric or delta is `null` when its
   denominator was empty ("not available") — it renders "—", never 0 % or 100 %
   (spec EC-8). Cost goes through `formatRunCost` (@/components/run-cost-badge). */
import { formatRunCost } from "@/components/run-cost-badge";

export const NOT_AVAILABLE = "—";

/** A 0–1 ratio as one-decimal percent: 0.825 → "82.5%", 0 → "0.0%", null → "—". */
export function formatMetric(v: number | null | undefined): string {
  return v == null ? NOT_AVAILABLE : `${(v * 100).toFixed(1)}%`;
}

/** Signed percentage-point change, one decimal: 3 → "+3.0", -2.5 → "−2.5", 0 → "0.0". */
export function formatDeltaPoints(d: number | null | undefined): string {
  if (d == null) return NOT_AVAILABLE;
  const r = Math.round(d * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
}

/** Signed whole-case change: 2 → "+2", -2 → "−2", 0 → "0". */
export function formatDeltaCases(d: number | null | undefined): string {
  if (d == null) return NOT_AVAILABLE;
  const r = Math.round(d);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}`;
}

/** Signed dollar change between two runs: 0.003 → "+$0.003", -0.5 → "−$0.50", null → "—". */
export function formatCostDelta(d: number | null | undefined): string {
  if (d == null) return NOT_AVAILABLE;
  if (d === 0) return formatRunCost(0);
  return `${d > 0 ? "+" : "−"}${formatRunCost(Math.abs(d))}`;
}

/** A run timestamp for display; an unparseable value is shown as-is. */
export function formatRunDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Run cost in dollars; unknown (`null`) is "—", never "$0.00". */
export function formatCost(costUsd: number | null | undefined): string {
  return costUsd == null ? NOT_AVAILABLE : formatRunCost(costUsd);
}
