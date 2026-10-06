/* TrendTooltip — the hover/focus card of MetricTrendChart: the run's date, the agent
   version it ran against and its cost ("—" when unknown). A private part of the chart. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatCost, formatRunDate } from "../format";
import type { TrendRow } from "./helpers";

export interface TrendTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: TrendRow }>;
}

const card: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  fontSize: 12,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

export function TrendTooltip({ active, payload }: TrendTooltipProps) {
  const t = useTranslations("eval");
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div style={card}>
      <div>
        <span style={{ color: "var(--text-muted)" }}>{t("dashboard.table.ranAt")} </span>
        {formatRunDate(row.ran_at)}
      </div>
      <div>{t("dashboard.table.versionValue", { version: row.agent_version })}</div>
      <div>
        <span style={{ color: "var(--text-muted)" }}>{t("dashboard.table.cost")} </span>
        {formatCost(row.cost_usd)}
      </div>
    </div>
  );
}
