/* CiTab — agent editor CI tab. Lists the agent's CI installations (one row per
   repository) with the latest run per repo, the "Fail CI on" policy, and the
   runs table; opens the Export to CI wizard. One refresh of the stored runs
   from GitHub on mount. See client/specs and server/src/modules/ci/README.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, CiRun, CiUpdateResult } from "@devdigest/shared";
import { useAgentCi, useRefreshCiRuns, useUpdateCiConfig } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { CiRunsTable, StatusPill, statusKey, useRelativeTime } from "@/components/ci-runs-table";
import { FAIL_ON_OPTIONS } from "./constants";
import { ExportCiModal } from "./_components/ExportCiModal";
import { s } from "./styles";

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const ago = useRelativeTime();
  const { data, isLoading, isError, refetch } = useAgentCi(agent.id);
  const refresh = useRefreshCiRuns();
  const update = useUpdateCiConfig(agent.id);
  const updateAgent = useUpdateAgent();
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [updateResult, setUpdateResult] = React.useState<CiUpdateResult | null>(null);

  const refreshed = React.useRef(false);
  const { mutate: refreshMutate } = refresh;
  React.useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    refreshMutate({ agent_id: agent.id });
  }, [agent.id, refreshMutate]);

  if (isLoading) return <Skeleton height={200} />;
  if (isError || !data) return <ErrorState title={t("ciTab.loadError")} onRetry={() => refetch()} />;

  const { installations, runs } = data;
  const latestFor = (repo: string): CiRun | undefined => runs.find((r) => r.repo === repo);
  // The wizard sits at one stable position: the first export flips the tab from
  // the empty state to the list, and a moved modal would remount and lose its
  // success step (the "View pull request" link).
  const modal = wizardOpen ? <ExportCiModal agent={agent} onClose={() => setWizardOpen(false)} /> : null;

  const empty = (
    <div style={s.wrap}>
      <EmptyState
        icon="Workflow"
        title={t("ciTab.emptyTitle")}
        body={t("ciTab.emptyBody")}
        cta={t("ciTab.addToCi")}
        onCta={() => setWizardOpen(true)}
      />
    </div>
  );

  const list = (
    <div style={s.wrap}>
      <div style={s.head}>
        <h2 style={s.h2}>{t("ciTab.heading")}</h2>
        <span style={s.active}>
          <span style={s.activeDot} aria-hidden />
          {t("ciTab.activeIn", { count: installations.length })}
        </span>
        <div style={s.spacer}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            disabled={update.isPending}
            onClick={() => update.mutate(undefined, { onSuccess: setUpdateResult })}
          >
            {t("ciTab.updateConfig")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      {updateResult && (
        <div role="status">
          <div style={s.note}>
            {t("ciTab.updateDone", { count: updateResult.results.filter((r) => !r.error).length })}
          </div>
          {updateResult.results
            .filter((r) => r.error)
            .map((r) => (
              <div key={r.repo} style={s.error}>
                {t("ciTab.updateFailed", { repo: r.repo, message: r.error ?? "" })}
              </div>
            ))}
        </div>
      )}

      <div style={s.failOn}>
        <div style={s.failOnText}>
          <span id="ci-fail-on-label" style={s.failOnTitle}>
            {t("ciTab.failOn.label")}
          </span>
          <span style={s.note}>{t("ciTab.failOn.desc")}</span>
          <span style={s.note}>{t("ciTab.failOn.note")}</span>
        </div>
        <div role="radiogroup" aria-labelledby="ci-fail-on-label" style={s.segmented}>
          {FAIL_ON_OPTIONS.map((opt) => {
            const checked = agent.ci_fail_on === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={checked}
                style={s.segment(checked)}
                onClick={() => updateAgent.mutate({ id: agent.id, patch: { ci_fail_on: opt } })}
              >
                {t(`ciTab.failOn.${opt}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div style={s.list}>
        {installations.map((inst) => {
          const last = latestFor(inst.repo);
          const sk = last ? statusKey(last.status) : null;
          return (
            <div key={inst.id} style={s.row}>
              <Icon.GitBranch size={16} style={s.rowIcon} />
              <span style={s.repo}>{inst.repo}</span>
              <span style={s.tag}>
                <Icon.Workflow size={13} />
                {t("ciTab.target.gha")}
              </span>
              <span style={s.version}>{t("ciTab.workflowVersion", { version: inst.agent_version })}</span>
              {last && sk ? (
                <>
                  <StatusPill status={sk} />
                  <span style={s.muted}>{ago(last.ran_at)}</span>
                </>
              ) : (
                <span style={s.muted}>{t("ciTab.noRuns")}</span>
              )}
            </div>
          );
        })}
        <button type="button" style={s.dashed} onClick={() => setWizardOpen(true)}>
          <Icon.Plus size={15} />
          {t("ciTab.addRepository")}
        </button>
      </div>

      <p style={s.note}>{t("ciTab.updateNote")}</p>

      <h3 style={s.section}>{t("ciTab.runsTitle")}</h3>
      <CiRunsTable runs={runs} showAgent={false} />
    </div>
  );

  return (
    <>
      {installations.length === 0 ? empty : list}
      {modal}
    </>
  );
}
