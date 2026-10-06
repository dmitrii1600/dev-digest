/* AgentEvalView — `/eval/[agentId]`: the agent's current version, a switcher to
   another agent and a time window (both kept in the URL), "Run eval", the four metric
   tiles with their signed changes, a banner when a metric regressed, the trend and the
   runs table with Compare. The tiles and the banner always read the agent's latest two
   runs; only the trend and the table follow the window. The dashboard hook polls while a
   run is in flight. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MetricTiles, MetricTrendChart } from "@/components/eval-metrics";
import { ApiError } from "@/lib/api";
import { useAgent } from "@/lib/hooks/agents";
import { useAgentEvalDashboard, useAgentEvalRuns, useEvalDashboard, useStartEvalRun } from "@/lib/hooks/evals";
import { AgentSwitcher } from "../AgentSwitcher";
import { EvalRunsTable } from "../EvalRunsTable";
import { RegressionBanner } from "../RegressionBanner";
import { WindowSelect } from "../WindowSelect";
import { inWindow, parseWindow, sinceFor, type EvalWindow } from "../window";
import { s } from "./styles";

export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const search = useSearchParams();
  const timeWindow = parseWindow(search.get("window"));
  // Frozen per window: a `since` that moved on every render would refetch forever.
  const since = React.useMemo(() => sinceFor(timeWindow, new Date()), [timeWindow]);

  const { data, isLoading, isError, refetch } = useAgentEvalDashboard(agentId);
  const runsQuery = useAgentEvalRuns(agentId, { since });
  const workspace = useEvalDashboard();
  const { data: agent } = useAgent(agentId);
  const start = useStartEvalRun(agentId);

  // EC-11: an id that is not an agent with cases (unknown, deleted, or not a uuid) goes back to the landing.
  const agentMissing = !!workspace.data && !workspace.isFetching && !workspace.data.agents.some((a) => a.agent_id === agentId);
  React.useEffect(() => {
    if (agentMissing) router.replace("/eval?notice=agent_not_found");
  }, [agentMissing, router]);

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: data?.owner_name ?? t("page.crumbEvals") },
  ];

  if (agentMissing) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }
  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("agentPage.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const setWindow = (w: EvalWindow) => router.replace(`/eval/${agentId}?window=${w}`);
  const running = !!data?.running || start.isPending;
  // A 409 only means a run is already live: the refetch shows it as running, so no error text.
  const startError =
    start.isError && !(start.error instanceof ApiError && start.error.status === 409) ? start.error.message : null;
  const runs = runsQuery.data;
  const trend = (data?.trend ?? []).filter((p) => inWindow(p.ran_at, since));
  // EC-10: nothing inside a bounded window — offer the wider one; the tiles stay.
  const windowEmpty = timeWindow !== "all" && !!runs && runs.length === 0 && trend.length === 0;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.head}>
          <div>
            <h1 style={s.h1}>{data?.owner_name ?? t("dashboard.defaultTitle")}</h1>
            {agent && <div style={s.version}>{t("agentPage.currentVersion", { version: agent.version })}</div>}
          </div>
          <div style={s.controls}>
            <AgentSwitcher agents={workspace.data?.agents ?? []} agentId={agentId} window={timeWindow} />
            <WindowSelect value={timeWindow} onChange={setWindow} />
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              disabled={!data || data.cases_total === 0 || running}
              loading={running}
              onClick={() => start.mutate()}
            >
              {running ? t("dashboard.running") : t("dashboard.runEval", { count: data?.cases_total ?? 0 })}
            </Button>
          </div>
        </div>
        {startError && (
          <div role="alert" style={s.error}>
            {startError}
          </div>
        )}
        {isLoading || !data ? (
          <Skeleton height={200} />
        ) : (
          <>
            <RegressionBanner regressions={data.regressions} />
            <MetricTiles dashboard={data} />
            {windowEmpty ? (
              <div style={s.card}>
                <div style={s.muted}>{t("agentPage.emptyWindow")}</div>
                <Button kind="secondary" size="sm" onClick={() => setWindow("all")}>
                  {t("agentPage.showAllRuns")}
                </Button>
              </div>
            ) : (
              <>
                <div style={s.card}>
                  <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
                  <MetricTrendChart trend={trend} />
                </div>
                <div>
                  <div style={s.sectionTitle}>{t("agentPage.runsHeading")}</div>
                  {runs ? <EvalRunsTable key={agentId} agentId={agentId} runs={runs} /> : <Skeleton height={120} />}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
