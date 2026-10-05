/* AgentEvalCard — one agent that has eval cases: name, model, the version and
   date of its latest completed run, pass count and the three metrics. The whole
   card links to that agent's eval page. A metric that is not available reads
   "—" (EC-8). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { EvalAgentCard } from "@devdigest/shared";
import { formatMetric, formatRunDate } from "@/components/eval-metrics";

const CARD_STYLE: React.CSSProperties = {
  display: "block",
  padding: 16,
  borderRadius: 9,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "inherit",
  textDecoration: "none",
};

export function AgentEvalCard({ card }: { card: EvalAgentCard }) {
  const t = useTranslations("eval");
  const latest = card.latest;
  const metrics = [
    { label: t("dashboard.legend.recall"), value: latest?.metrics.recall ?? null },
    { label: t("dashboard.legend.precision"), value: latest?.metrics.precision ?? null },
    { label: t("dashboard.legend.citation"), value: latest?.metrics.citation_accuracy ?? null },
  ];
  return (
    <Link href={`/eval/${card.agent_id}`} style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{card.agent_name}</span>
        <Badge color="var(--text-secondary)" mono>
          {card.model}
        </Badge>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
        {latest
          ? t("dashboard.cardVersion", { version: latest.agent_version, date: formatRunDate(latest.started_at) })
          : t("dashboard.notRun")}
      </div>
      {latest && (
        <div className="tnum" style={{ fontSize: 13, fontWeight: 600, marginTop: 10 }}>
          {t("dashboard.cardCases", { passed: latest.cases_passed, total: latest.cases_total })}
        </div>
      )}
      <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
        {metrics.map((m) => (
          <div key={m.label}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.label}</div>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 700 }}>
              {formatMetric(m.value)}
            </div>
          </div>
        ))}
      </div>
    </Link>
  );
}
