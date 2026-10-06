/* MetricTrendChart — recall / precision / citation per completed run, on
   recharts directly. The vendored LineChart turns a missing value into 0, which
   would plot "not available" as 0 % (EC-12); here a null point is a gap. Every
   point is plotted — the caller picks the range. Points are keyboard-focusable
   (`accessibilityLayer`) and show the same tooltip as hover. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvalTrendPoint } from "@devdigest/shared";
import { toChartRows } from "./helpers";
import { TrendTooltip } from "./TrendTooltip";

const SERIES = [
  { key: "recall", legendKey: "dashboard.legend.recall", color: "var(--accent)" },
  { key: "precision", legendKey: "dashboard.legend.precision", color: "var(--ok)" },
  { key: "citation", legendKey: "dashboard.legend.citation", color: "var(--warn)" },
] as const;

export function MetricTrendChart({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");
  const rows = React.useMemo(() => toChartRows(trend), [trend]);
  if (rows.length < 2) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("agentPage.notEnoughRuns")}</div>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart accessibilityLayer data={rows} margin={{ top: 14, right: 14, bottom: 8, left: -10 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickFormatter={(v: number) => `${v}%`}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<TrendTooltip />} />
          <Legend />
          {SERIES.map((sr) => (
            <Line
              key={sr.key}
              type="monotone"
              dataKey={sr.key}
              name={t(sr.legendKey)}
              stroke={sr.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
