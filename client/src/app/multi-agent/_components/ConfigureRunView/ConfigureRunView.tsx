/* ConfigureRunView — `/multi-agent`: pick a PR of the active repo, check the
   agents to fan out, see the time/cost estimate, start the run and open its
   results page. Always goes through POST /pulls/:id/multi-review, even for one
   agent, so the run has a results page. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, ErrorState, Skeleton, Toggle } from "@devdigest/ui";
import { AgentAvatar } from "@/components/agent-avatar";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks/core";
import { useAgentRunEstimates, useStartMultiReview } from "@/lib/hooks/multi-review";
import { aggregateParts, estimateParts } from "@/lib/run-estimates";
import { useActiveRepo } from "@/providers/repo-context";
import { s } from "./styles";

export function ConfigureRunView() {
  const t = useTranslations("multiReview");
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const { data: pulls, isLoading: pullsLoading, error: pullsError, refetch: refetchPulls } = usePulls(activeRepo?.id);
  const { data: agents, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useAgents();
  const { data: estimates } = useAgentRunEstimates();
  const start = useStartMultiReview();

  const [prId, setPrId] = React.useState("");
  const [startFailed, setStartFailed] = React.useState(false);
  // null = untouched → every enabled agent is checked (derived).
  const [picked, setPicked] = React.useState<Set<string> | null>(null);

  const enabled = (agents ?? []).filter((a) => a.enabled);
  const checked = picked ?? new Set(enabled.map((a) => a.id));
  const chosen = enabled.filter((a) => checked.has(a.id));
  const allChecked = enabled.length > 0 && chosen.length === enabled.length;
  const estOf = (id: string) => estimates?.find((e) => e.agent_id === id);
  const agg = aggregateParts(chosen.map((a) => estOf(a.id)));

  const runLabel =
    chosen.length === 0
      ? t("configure.selectAgents")
      : chosen.length === 1
        ? t("configure.runOne")
        : t("configure.runMulti", { count: chosen.length });

  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const run = async () => {
    setStartFailed(false);
    try {
      const res = await start.mutateAsync({ prId, agentIds: chosen.map((a) => a.id) });
      router.push(`/multi-agent/${res.multi_run_id}`);
    } catch {
      setStartFailed(true);
    }
  };

  const crumb = [{ label: t("results.crumb"), href: "/multi-agent" }, { label: t("configure.crumb") }];
  const selectLabelId = "configure-pr-label";

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <h1 style={s.h1}>{t("configure.title")}</h1>
        <p style={s.subtitle}>{t("configure.subtitle")}</p>

        <div style={s.step}>
          <span style={s.stepNum}>1</span>
          <span id={selectLabelId} style={s.stepTitle}>
            {t("configure.stepPr")}
          </span>
        </div>
        <select
          aria-labelledby={selectLabelId}
          style={s.select}
          value={prId}
          onChange={(e) => setPrId(e.target.value)}
        >
          <option value="">{t("configure.selectPr")}</option>
          {(pulls ?? [])
            .filter((p) => p.id)
            .map((p) => (
              <option key={p.id!} value={p.id!}>
                {t("configure.prItem", { number: p.number, title: p.title })}
              </option>
            ))}
        </select>

        <div style={s.step}>
          <span style={s.stepNum}>2</span>
          <span style={s.stepTitle}>{t("configure.stepAgents")}</span>
          {prId && enabled.length > 0 && (
            <label style={{ ...s.stepAction, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              {allChecked ? t("configure.clearAll") : t("configure.selectAll")}
              <Toggle
                on={allChecked}
                onChange={(on) => setPicked(on ? new Set(enabled.map((a) => a.id)) : new Set())}
              />
            </label>
          )}
        </div>

        {pullsLoading || agentsLoading ? (
          <Skeleton height={120} />
        ) : pullsError || agentsError ? (
          <ErrorState
            title={t("configure.loadFailed")}
            onRetry={() => {
              void refetchPulls();
              void refetchAgents();
            }}
          />
        ) : !prId ? (
          <div style={s.empty}>
            <div style={s.emptyTitle}>{t("configure.pickPrFirst")}</div>
            <div style={s.emptyBody}>{t("configure.pickPrFirstBody")}</div>
          </div>
        ) : enabled.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyTitle}>{t("configure.noEnabled")}</div>
            <button type="button" style={s.link} onClick={() => router.push("/agents")}>
              {t("configure.goToAgents")}
            </button>
          </div>
        ) : (
          <div style={s.cards}>
            {enabled.map((a) => {
              const est = estimateParts(estOf(a.id));
              return (
                <div key={a.id} style={s.card}>
                  <div style={s.cardMain}>
                    <Checkbox
                      checked={checked.has(a.id)}
                      onChange={(v) => toggle(a.id, v)}
                      label={
                        <span style={s.agentLabel}>
                          <AgentAvatar name={a.name} size="sm" />
                          <span style={s.ellipsis}>{a.name}</span>
                        </span>
                      }
                    />
                    {a.description && <span style={{ ...s.desc, ...s.ellipsis }}>{a.description}</span>}
                  </div>
                  <span style={s.estimate}>{t("configure.estimate", { time: est.time, cost: est.cost })}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={s.runBar}>
          <Button
            kind="primary"
            disabled={!prId || chosen.length === 0 || start.isPending}
            loading={start.isPending}
            onClick={run}
          >
            {runLabel}
          </Button>
          {startFailed && (
            <span role="alert" style={s.aggregate}>
              {t("configure.startFailed")}
            </span>
          )}
          {prId && chosen.length > 0 && (
            <span style={s.aggregate}>{t("configure.aggregate", { time: agg.time, cost: agg.cost })}</span>
          )}
        </div>
      </div>
    </AppShell>
  );
}
