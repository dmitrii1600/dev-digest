/* RunCostBadge — cost + token usage of one review run.

   Three variants:
     compact  — "$0.012"                 (COST column in the PR list)
     timeline — "9,119 tok · $0.0013"    (run row in the PR timeline)
     detail   — "$0.014 · 8.2K→1.3K"     (verdict/stat surfaces on PR detail)

   A run with no data renders "—", never "$0.00": a null cost means the
   provider reported no usage, which is "unknown", not "free". Pure display —
   every number comes from the run row the page already fetched, so rendering a
   badge costs zero extra model calls. */
"use client";

import React from "react";

/** "$0.0013" / "$0.012" (2 significant digits under $1), "$12.50" at or above. */
export function formatRunCost(costUsd: number): string {
  if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd === 0) return "$0.00"; // a genuine zero, unlike null
  if (costUsd < 0.0001) return "<$0.0001";
  return `$${Number(costUsd.toPrecision(2))}`;
}

/**
 * One token count, abbreviated: 15230 → "15.2K", 820 → "820".
 *
 * Deliberately NOT named `formatTokens`: the run-trace drawer already exports a
 * two-argument `formatTokens(in, out)` helper, and two same-named formatters
 * with different signatures is a trap.
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  const k = (count / 1000).toFixed(1);
  return `${k.endsWith(".0") ? k.slice(0, -2) : k}K`;
}

export type RunCostBadgeVariant = "compact" | "timeline" | "detail";

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: RunCostBadgeVariant;
}) {
  const cost = costUsd != null ? formatRunCost(costUsd) : null;
  const totalTokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  const tokens =
    variant === "detail" && tokensIn != null && tokensOut != null
      ? `${formatTokenCount(tokensIn)}→${formatTokenCount(tokensOut)}`
      : variant === "timeline" && totalTokens > 0
        ? `${totalTokens.toLocaleString("en-US")} tok`
        : null;
  // The timeline reads tokens-first ("9,119 tok · $0.0013"); everywhere else
  // the money leads.
  const parts = (variant === "timeline" ? [tokens, cost] : [cost, tokens]).filter(
    (p): p is string => p != null,
  );
  const known = parts.length > 0;
  return (
    <span
      className="mono"
      style={{ fontSize: 12, color: known ? "var(--text-secondary)" : "var(--text-muted)" }}
    >
      {known ? parts.join(" · ") : "—"}
    </span>
  );
}

export default RunCostBadge;
