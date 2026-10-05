/* EvalsTab — an agent's eval cases and the latest suite results. Metric tiles
   (each with a signed change), "Run all evals", the case list under a
   "N / M passing" count, and a confirmed delete. Cases are made elsewhere: a
   decided finding on a PR becomes one ("Turn into eval case"). A run executes
   on the server after the POST returns, so the dashboard poll shows it
   `running` and the button stays disabled until it ends. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, IconBtn, Skeleton } from "@devdigest/ui";
import { ConfirmModal } from "@/components/confirm-modal";
import { MetricTiles } from "@/components/eval-metrics";
import { ApiError } from "@/lib/api";
import {
  useAgentEvalCases,
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useStartEvalRun,
} from "@/lib/hooks/evals";
import { EXPECTATION_KEY, RESULT_COLOR, RESULT_KEY, targetLabel } from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading: casesLoading, isError: casesError } = useAgentEvalCases(agentId);
  const { data: dashboard } = useAgentEvalDashboard(agentId);
  const start = useStartEvalRun(agentId);
  const del = useDeleteEvalCase(agentId);
  const [pendingDelete, setPendingDelete] = React.useState<{ id: string; name: string } | null>(null);

  const noCases = (cases?.total ?? 0) === 0;
  const running = !!dashboard?.running || start.isPending;
  // A 409 only means a run is already live: the refetch shows it as running, so no error text.
  const startError =
    start.isError && !(start.error instanceof ApiError && start.error.status === 409)
      ? start.error.message
      : null;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <div style={s.title}>{t("evalsTab.metricsTitle")}</div>
          <div style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</div>
        </div>
        <div style={s.spacer}>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={noCases || running}
            loading={running}
            onClick={() => start.mutate()}
          >
            {running ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
        </div>
      </div>
      {noCases && !casesLoading && <div style={s.helper}>{t("evalsTab.runAllEmpty")}</div>}
      {startError && (
        <div role="alert" style={s.error}>
          {startError}
        </div>
      )}

      <MetricTiles dashboard={dashboard} />

      <div style={s.head}>
        <div style={s.title}>{t("evalsTab.casesHeading")}</div>
        {cases && (
          <div style={s.count}>{t("evalsTab.passingCount", { passing: cases.passing, total: cases.total })}</div>
        )}
      </div>

      {casesLoading ? (
        <Skeleton height={120} />
      ) : casesError || !cases ? (
        <div role="alert" style={s.error}>
          {t("evalsTab.loadError")}
        </div>
      ) : cases.cases.length === 0 ? (
        <div style={s.empty}>{t("evalsTab.emptyCases")}</div>
      ) : (
        <div style={s.list}>
          {cases.cases.map((c) => (
            <div key={c.id} style={s.row}>
              <div style={s.rowMain}>
                <span style={s.name}>{c.name}</span>
                <span className="mono" style={s.meta}>
                  {t(EXPECTATION_KEY[c.expectation])} · {targetLabel(c.target)}
                </span>
              </div>
              <Badge color={RESULT_COLOR[c.last_result]}>{t(RESULT_KEY[c.last_result])}</Badge>
              <IconBtn
                icon="Trash"
                label={t("evalsTab.deleteAria", { name: c.name })}
                danger
                onClick={() => setPendingDelete({ id: c.id, name: c.name })}
              />
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={t("evalsTab.deleteTitle")}
          body={t("evalsTab.deleteBody")}
          confirmLabel={t("evalsTab.delete")}
          cancelLabel={t("evalsTab.cancel")}
          busy={del.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => del.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })}
        />
      )}
    </div>
  );
}
