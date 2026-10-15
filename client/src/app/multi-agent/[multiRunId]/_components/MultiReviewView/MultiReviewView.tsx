/* MultiReviewView — `/multi-agent/[multiRunId]`: header, meta row, the Columns or
   Tabs view of every agent's result, the disagreement block and the trace drawer.
   Re-reads every 2 s while any agent run is in flight (see useMultiReview). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { formatRunCost } from "@/components/run-cost-badge";
import { ApiError } from "@/lib/api";
import { useMultiReview } from "@/lib/hooks/multi-review";
import { AgentColumn } from "../AgentColumn";
import { AgentTabs } from "../AgentTabs";
import { DisagreementBlock } from "../DisagreementBlock";
import { formatSecondsOrDash, totalCost, wallTimeMs } from "../helpers";
import { s } from "./styles";

type View = "columns" | "tabs";

export function MultiReviewView({ id }: { id: string }) {
  const t = useTranslations("multiReview");
  const { data, isLoading, error, refetch } = useMultiReview(id);
  const [view, setView] = React.useState<View>("columns");
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);

  const crumb = [
    { label: t("results.crumb"), href: "/multi-agent" },
    ...(data ? [{ label: `#${data.pr.number}`, mono: true }] : []),
  ];

  if (error) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 422);
    return (
      <AppShell crumb={crumb}>
        {notFound ? (
          <>
            <EmptyState icon="Boxes" title={t("results.notFound.title")} body={t("results.notFound.body")} />
            <div style={{ textAlign: "center" }}>
              <Link href="/multi-agent" style={s.link}>
                {t("results.notFound.cta")}
              </Link>
            </div>
          </>
        ) : (
          <ErrorState fullScreen title={error.message} onRetry={() => refetch()} />
        )}
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={32} style={{ marginBottom: 16 }} />
          <Skeleton height={220} />
        </div>
      </AppShell>
    );
  }

  const { agents, pr } = data;
  const traced = agents.find((a) => a.run.run_id === traceRunId);
  const cost = totalCost(data);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.head}>
          <Link href="/multi-agent" style={s.link}>
            {t("results.configureRun")}
          </Link>
          <h1 style={s.h1}>{t("results.title")}</h1>
          <span style={s.selected}>{t("results.selected", { count: agents.length })}</span>
          <div role="group" aria-label={t("results.viewSwitch")} style={s.switch}>
            <Button kind="secondary" size="sm" active={view === "columns"} aria-pressed={view === "columns"} onClick={() => setView("columns")}>
              {t("results.columns")}
            </Button>
            <Button kind="secondary" size="sm" active={view === "tabs"} aria-pressed={view === "tabs"} onClick={() => setView("tabs")}>
              {t("results.tabs")}
            </Button>
          </div>
        </div>
        <div style={s.meta}>
          <span className="mono">{t("results.prNumber", { number: pr.number })}</span>
          <span style={s.prTitle}>{pr.title}</span>
          <span style={s.metaRight}>
            {t("results.meta", {
              count: agents.length,
              time: formatSecondsOrDash(wallTimeMs(data)),
              cost: cost == null ? "—" : formatRunCost(cost),
            })}
          </span>
        </div>
        {view === "columns" ? (
          <div style={s.scroll}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: `repeat(${agents.length}, minmax(220px, 1fr))` }}>
              {agents.map((a) => (
                <AgentColumn key={a.run.run_id} agent={a} onViewTrace={setTraceRunId} />
              ))}
            </div>
          </div>
        ) : (
          <AgentTabs agents={agents} prId={pr.id} onViewTrace={setTraceRunId} />
        )}
        <DisagreementBlock agents={agents} />
      </div>
      {traced && (
        <RunTraceDrawer
          key={traced.run.run_id}
          runId={traced.run.run_id}
          agentName={traced.run.agent_name}
          prNumber={pr.number}
          findings={traced.findings}
          running={traced.run.status === "running"}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
