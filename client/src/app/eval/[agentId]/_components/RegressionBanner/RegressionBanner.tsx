/* RegressionBanner — names each metric that dropped between the two latest
   completed runs and by how many points (AC-15). Renders nothing when no metric
   dropped. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRegression } from "@devdigest/shared";

const METRIC_LEGEND_KEY: Record<EvalRegression["metric"], string> = {
  recall: "dashboard.legend.recall",
  precision: "dashboard.legend.precision",
  citation_accuracy: "dashboard.legend.citation",
};

export function RegressionBanner({ regressions }: { regressions: EvalRegression[] }) {
  const t = useTranslations("eval");
  if (regressions.length === 0) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--crit)",
        color: "var(--crit)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {regressions.map((r) => (
        <div key={r.metric}>
          {t("agentPage.regression", { metric: t(METRIC_LEGEND_KEY[r.metric]), points: r.drop_points.toFixed(1) })}
        </div>
      ))}
    </div>
  );
}
