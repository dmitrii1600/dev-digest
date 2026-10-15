/* AgentTabs — the Tabs view: one tab per agent, the selected agent's summary and
   its full finding cards (the PR page's own FindingsPanel, so Accept / Dismiss /
   Turn into eval case change the same finding — AC-11). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore } from "@devdigest/ui";
import type { MultiReviewAgent } from "@devdigest/shared";
import { AgentAvatar } from "@/components/agent-avatar";
import { FindingsPanel } from "@/components/findings-panel";
import { formatRunCost } from "@/components/run-cost-badge";
import { formatSecondsOrDash } from "../helpers";

const s = {
  tabs: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 } satisfies React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 12px",
    borderRadius: 8,
    cursor: "pointer",
    font: "inherit",
    fontSize: 13,
    color: "var(--text-primary)",
    background: active ? "var(--bg-hover)" : "transparent",
    border: `1px solid ${active ? "var(--border-strong)" : "var(--border)"}`,
  }),
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } satisfies React.CSSProperties,
  name: { fontSize: 15, fontWeight: 600 } satisfies React.CSSProperties,
  stats: { fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" } satisfies React.CSSProperties,
  summary: { fontSize: 13.5, color: "var(--text-secondary)", marginBottom: 14 } satisfies React.CSSProperties,
};

export function AgentTabs({
  agents,
  prId,
  onViewTrace,
}: {
  agents: MultiReviewAgent[];
  prId: string;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiReview");
  const [selected, setSelected] = React.useState(0);
  const agent = agents[Math.min(selected, agents.length - 1)];
  if (!agent) return null;
  const { run } = agent;
  const status = run.status ?? "running";
  const cost = run.cost_usd == null ? "—" : formatRunCost(run.cost_usd);
  const label = (a: MultiReviewAgent) => {
    const st = a.run.status ?? "running";
    return st === "done" ? (a.run.score ?? "") : t(`results.status.${st}`);
  };

  return (
    <div>
      <div role="tablist" style={s.tabs}>
        {agents.map((a, i) => (
          <button
            key={a.run.run_id}
            role="tab"
            type="button"
            aria-selected={a === agent}
            style={s.tab(a === agent)}
            onClick={() => setSelected(i)}
          >
            <AgentAvatar name={a.run.agent_name} size="sm" />
            <span>{a.run.agent_name}</span>
            <span style={{ color: "var(--text-muted)" }}>{label(a)}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <div style={s.head}>
          {status === "done" && run.score != null && <CircularScore score={run.score} size={40} />}
          <span style={s.name}>{run.agent_name}</span>
          <span style={s.stats}>{t("results.runStats", { time: formatSecondsOrDash(run.duration_ms), cost })}</span>
          <Button kind="secondary" size="sm" onClick={() => onViewTrace(run.run_id)}>
            {t("results.viewTrace")}
          </Button>
        </div>
        {status === "running" && <div style={s.summary}>{t("results.status.running")}</div>}
        {(status === "failed" || status === "cancelled") && (
          <div style={s.summary}>
            <div>{t(status === "failed" ? "results.status.failed" : "results.status.cancelled")}</div>
            {run.error && <div>{run.error}</div>}
          </div>
        )}
        {agent.summary && (
          <div style={s.summary}>{agent.summary}</div>
        )}
        <FindingsPanel
          findings={agent.findings}
          prId={prId}
          evalAgentAvailable={!!run.agent_id && !!run.agent_name}
        />
      </div>
    </div>
  );
}
