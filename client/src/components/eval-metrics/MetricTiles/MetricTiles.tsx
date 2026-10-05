/* MetricTiles — the four headline tiles of an agent's eval results: recall,
   precision, citation accuracy and the pass count. Each carries a SIGNED change
   against the previous completed run as text (AC-10, NFR-8); a metric whose
   denominator was empty reads "—" (EC-8). Shared by the agent Evals tab and the
   /eval/[agentId] page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { MetricDelta } from "../MetricDelta";
import { formatMetric, NOT_AVAILABLE } from "../format";

const METRIC_TILES = [
  { key: "recall", labelKey: "dashboard.metrics.recall" },
  { key: "precision", labelKey: "dashboard.metrics.precision" },
  { key: "citation_accuracy", labelKey: "dashboard.metrics.citationAccuracy" },
] as const;

function TileValue({ text, delta, unit }: { text: string; delta: number | null; unit: "points" | "cases" }) {
  return (
    <>
      {text} <MetricDelta value={delta} unit={unit} />
    </>
  );
}

export function MetricTiles({ dashboard }: { dashboard: EvalDashboard | undefined }) {
  const t = useTranslations("eval");
  const current = dashboard?.current ?? null;
  const delta = dashboard?.delta;
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {METRIC_TILES.map(({ key, labelKey }) => (
        <MetricCard
          key={key}
          label={t(labelKey)}
          value={<TileValue text={formatMetric(current?.[key])} delta={delta?.[key] ?? null} unit="points" />}
        />
      ))}
      <MetricCard
        label={t("evalsTab.passTile")}
        value={
          <TileValue
            text={current ? `${current.cases_passed} / ${current.cases_total}` : NOT_AVAILABLE}
            delta={delta?.cases_passed ?? null}
            unit="cases"
          />
        }
      />
    </div>
  );
}
