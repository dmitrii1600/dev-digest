/* AgentColumn — one agent's result in the Columns view: header (avatar, name,
   time and cost), a status or a compact findings list, and a "View trace" footer
   that is shown for every run, failed ones included (EC-2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Icon, SEV } from "@devdigest/ui";
import type { MultiReviewAgent } from "@devdigest/shared";
import { AgentAvatar, agentLook } from "@/components/agent-avatar";
import { formatRunCost } from "@/components/run-cost-badge";
import { formatSecondsOrDash } from "../helpers";

const ellipsis: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const s = {
  col: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
  } satisfies React.CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", minWidth: 0 } satisfies React.CSSProperties,
  name: { fontSize: 13.5, fontWeight: 600, ...ellipsis } satisfies React.CSSProperties,
  stats: { fontSize: 12, color: "var(--text-muted)" } satisfies React.CSSProperties,
  body: { flex: 1, padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 } satisfies React.CSSProperties,
  status: { fontSize: 13, color: "var(--text-secondary)" } satisfies React.CSSProperties,
  row: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } satisfies React.CSSProperties,
  rowHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 } satisfies React.CSSProperties,
  title: { fontSize: 13, ...ellipsis } satisfies React.CSSProperties,
  loc: { fontSize: 11.5, color: "var(--text-muted)", ...ellipsis } satisfies React.CSSProperties,
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies React.CSSProperties,
};

export function AgentColumn({
  agent,
  onViewTrace,
}: {
  agent: MultiReviewAgent;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiReview");
  const { run, findings } = agent;
  const status = run.status ?? "running";
  const cost = run.cost_usd == null ? "—" : formatRunCost(run.cost_usd);

  return (
    <section aria-label={run.agent_name ?? undefined} style={{ ...s.col, borderTop: `3px solid ${agentLook(run.agent_name).color}` }}>
      <div style={s.head}>
        <AgentAvatar name={run.agent_name} size="md" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={s.name}>{run.agent_name}</div>
          <div style={s.stats}>{t("results.runStats", { time: formatSecondsOrDash(run.duration_ms), cost })}</div>
        </div>
        {status === "done" && run.score != null && <CircularScore score={run.score} size={38} />}
      </div>
      <div style={s.body}>
        {status === "running" && <div style={s.status}>{t("results.status.running")}</div>}
        {(status === "failed" || status === "cancelled") && (
          <div style={s.status}>
            <div>{t(status === "failed" ? "results.status.failed" : "results.status.cancelled")}</div>
            {run.error && <div>{run.error}</div>}
          </div>
        )}
        {status === "done" &&
          findings.map((f) => {
            const sev = SEV[f.severity];
            const SevIcon = Icon[sev.icon];
            return (
              <div key={f.id} style={s.row}>
                <span style={{ ...s.rowHead, color: sev.c }}>
                  <SevIcon size={13} />
                  {sev.label}
                </span>
                <span style={s.title}>{f.title}</span>
                <span className="mono" style={s.loc}>
                  {f.file}:{f.start_line}
                </span>
              </div>
            );
          })}
      </div>
      <div style={s.foot}>
        <span>{t("results.findingsCount", { count: findings.length })}</span>
        <Button kind="secondary" size="sm" onClick={() => onViewTrace(run.run_id)}>
          {t("results.viewTrace")}
        </Button>
      </div>
    </section>
  );
}
