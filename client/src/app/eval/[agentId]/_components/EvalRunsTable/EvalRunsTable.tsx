/* EvalRunsTable — the agent's 20 newest suite runs, newest first. A completed or
   partial run has a checkbox; picking exactly two enables Compare, which opens
   the comparison modal. A `running` or `failed` run is listed but not selectable:
   it has no metrics to compare. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { formatCost, formatMetric, formatRunDate } from "@/components/eval-metrics";
import { CompareRunsModal } from "../CompareRunsModal";

const SELECTABLE: ReadonlySet<EvalSuiteRun["status"]> = new Set(["completed", "partial"]);
const COMPARE_COUNT = 2;

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  borderBottom: "1px solid var(--border)",
};
const TD: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)" };
/** Visually hidden, still in the accessibility tree: the checkbox's accessible name. */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

export function EvalRunsTable({ agentId, runs }: { agentId: string; runs: EvalSuiteRun[] }) {
  const t = useTranslations("eval");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const canCompare = selected.length === COMPARE_COUNT;

  if (runs.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <Button kind="secondary" size="sm" icon="BarChart" disabled={!canCompare} onClick={() => setComparing(true)}>
          {t("agentPage.compare")}
        </Button>
        {!canCompare && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("agentPage.compareHint")}</span>}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={TH} />
            {[
              t("dashboard.table.ranAt"),
              t("dashboard.table.version"),
              t("dashboard.table.recall"),
              t("dashboard.table.precision"),
              t("dashboard.table.citation"),
              t("dashboard.table.pass"),
              t("dashboard.table.cost"),
              t("dashboard.table.status"),
            ].map((h) => (
              <th key={h} style={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const date = formatRunDate(r.started_at);
            return (
              <tr key={r.id}>
                <td style={TD}>
                  {SELECTABLE.has(r.status) && (
                    <Checkbox
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      label={<span style={SR_ONLY}>{t("agentPage.selectRun", { date })}</span>}
                    />
                  )}
                </td>
                <td style={TD}>{date}</td>
                <td style={TD}>{t("dashboard.table.versionValue", { version: r.agent_version })}</td>
                <td className="tnum" style={TD}>
                  {formatMetric(r.metrics.recall)}
                </td>
                <td className="tnum" style={TD}>
                  {formatMetric(r.metrics.precision)}
                </td>
                <td className="tnum" style={TD}>
                  {formatMetric(r.metrics.citation_accuracy)}
                </td>
                <td className="tnum" style={TD}>
                  {r.cases_passed}/{r.cases_total}
                </td>
                <td className="tnum" style={TD}>
                  {formatCost(r.cost_usd)}
                </td>
                <td style={TD}>{t(`dashboard.status.${r.status}`)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {comparing && canCompare && (
        <CompareRunsModal agentId={agentId} runIds={[selected[0]!, selected[1]!]} onClose={() => setComparing(false)} />
      )}
    </div>
  );
}
