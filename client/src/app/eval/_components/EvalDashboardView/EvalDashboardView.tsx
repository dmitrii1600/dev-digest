/* EvalDashboardView — `/eval`: one card per agent that has eval cases, then the
   newest eval runs across agents. Cases are made from decided findings, so an
   empty workspace explains that rather than offering a form (EC-10). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { formatCost, formatMetric, formatRunDate } from "@/components/eval-metrics";
import { useEvalDashboard } from "@/lib/hooks/evals";
import { AgentEvalCard } from "./_components/AgentEvalCard";
import { RunAllAgentsModal, runAllSummary } from "./_components/RunAllAgentsModal";
import { s } from "./styles";

export function EvalDashboardView({ notice }: { notice?: string }) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const [confirmingRunAll, setConfirmingRunAll] = React.useState(false);
  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("dashboard.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const canRunAll = runAllSummary(data?.agents ?? []).eligible.length > 0;
  const agentName = new Map((data?.agents ?? []).map((a) => [a.agent_id, a.agent_name]));

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.head}>
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          {data && (
            <div style={s.headActions}>
              <Button
                kind="primary"
                size="sm"
                icon="Play"
                disabled={!canRunAll}
                onClick={() => setConfirmingRunAll(true)}
              >
                {t("dashboard.runAllAgents")}
              </Button>
              {!canRunAll && <span style={s.helper}>{t("dashboard.runAllNone")}</span>}
            </div>
          )}
        </div>
        {notice === "agent_not_found" && (
          <div role="status" style={s.notice}>
            {t("dashboard.notFoundNotice")}
          </div>
        )}
        {isLoading || !data ? (
          <Skeleton height={160} />
        ) : data.agents.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("dashboard.emptyTitle")} body={t("dashboard.emptyBody")} />
        ) : (
          <>
            <div style={s.grid}>
              {data.agents.map((card) => (
                <AgentEvalCard key={card.agent_id} card={card} />
              ))}
            </div>
            <div style={s.sectionTitle}>{t("dashboard.recentRunsAll")}</div>
            {data.recent_runs.length === 0 ? (
              <div style={s.muted}>{t("dashboard.noRuns")}</div>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    {[
                      t("dashboard.table.agent"),
                      t("dashboard.table.ranAt"),
                      t("dashboard.table.version"),
                      t("dashboard.table.recall"),
                      t("dashboard.table.precision"),
                      t("dashboard.table.citation"),
                      t("dashboard.table.pass"),
                      t("dashboard.table.cost"),
                      t("dashboard.table.status"),
                    ].map((h) => (
                      <th key={h} style={s.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recent_runs.map((r) => (
                    <tr key={r.id}>
                      <td style={s.td}>{agentName.get(r.agent_id) ?? "—"}</td>
                      <td style={s.td}>{formatRunDate(r.started_at)}</td>
                      <td style={s.td}>{t("dashboard.table.versionValue", { version: r.agent_version })}</td>
                      <td className="tnum" style={s.td}>
                        {formatMetric(r.metrics.recall)}
                      </td>
                      <td className="tnum" style={s.td}>
                        {formatMetric(r.metrics.precision)}
                      </td>
                      <td className="tnum" style={s.td}>
                        {formatMetric(r.metrics.citation_accuracy)}
                      </td>
                      <td className="tnum" style={s.td}>
                        {r.cases_passed}/{r.cases_total}
                      </td>
                      <td className="tnum" style={s.td}>
                        {formatCost(r.cost_usd)}
                      </td>
                      <td style={s.td}>{t(`dashboard.status.${r.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      {confirmingRunAll && data && (
        <RunAllAgentsModal cards={data.agents} onClose={() => setConfirmingRunAll(false)} />
      )}
    </AppShell>
  );
}
