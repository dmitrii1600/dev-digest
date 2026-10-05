/* AgentEvalView — `/eval/[agentId]`: the four metric tiles with their signed
   changes, a banner when a metric regressed, the trend over the newest runs and
   the runs table with Compare. Everything comes from the agent's eval dashboard,
   which the hook polls while a run is in flight. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MetricTiles } from "@/components/eval-metrics";
import { useAgentEvalDashboard } from "@/lib/hooks/evals";
import { EvalRunsTable } from "../EvalRunsTable";
import { MetricTrendChart } from "../MetricTrendChart";
import { RegressionBanner } from "../RegressionBanner";
import { s } from "./styles";

export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useAgentEvalDashboard(agentId);
  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: data?.owner_name ?? t("page.crumbEvals") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("agentPage.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <h1 style={s.h1}>{data?.owner_name ?? t("dashboard.defaultTitle")}</h1>
        {isLoading || !data ? (
          <Skeleton height={200} />
        ) : (
          <>
            <RegressionBanner regressions={data.regressions} />
            <MetricTiles dashboard={data} />
            <div style={s.card}>
              <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
              <MetricTrendChart trend={data.trend} />
            </div>
            <div>
              <div style={s.sectionTitle}>{t("agentPage.runsHeading")}</div>
              <EvalRunsTable agentId={agentId} runs={data.recent_runs} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
