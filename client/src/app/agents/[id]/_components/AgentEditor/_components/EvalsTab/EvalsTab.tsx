/* EvalsTab — an agent's eval cases and the latest suite results. Metric tiles
   (each with a signed change), "Run all evals", "New eval case", the case list
   under a "N / M passing" count, per-row Run / Edit / Delete (delete is
   confirmed). Cases come from a decided finding ("Turn into eval case") or are
   written here by hand in the shared case editor. A run executes on the server
   after the POST returns, so the dashboard poll shows it `running` and the
   button stays disabled until it ends. A single-case run never touches the
   suite numbers; its result shows beside the row. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { EvalCaseListItem } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { EvalCaseEditor, EvalCaseList } from "@/components/eval-cases";
import { MetricTiles } from "@/components/eval-metrics";
import { ApiError } from "@/lib/api";
import {
  useAgentEvalCases,
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useStartCaseRun,
  useStartEvalRun,
} from "@/lib/hooks/evals";
import { s } from "./styles";

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading: casesLoading, isError: casesError } = useAgentEvalCases(agentId);
  const { data: dashboard } = useAgentEvalDashboard(agentId);
  const start = useStartEvalRun(agentId);
  const del = useDeleteEvalCase(agentId);
  const caseRun = useStartCaseRun();
  const [pendingDelete, setPendingDelete] = React.useState<{ id: string; name: string } | null>(null);
  // `null` = closed, `"new"` = a blank case, otherwise the case being edited.
  const [editing, setEditing] = React.useState<EvalCaseListItem | "new" | null>(null);

  const noCases = (cases?.total ?? 0) === 0;
  const running = !!dashboard?.running || start.isPending;
  // A 409 only means a run is already live: the refetch shows it as running, so no error text.
  const startError =
    start.isError && !(start.error instanceof ApiError && start.error.status === 409)
      ? start.error.message
      : null;
  // A 409 on a case run means that case is already running — say so.
  const caseRunError = !caseRun.isError
    ? null
    : caseRun.error instanceof ApiError && caseRun.error.status === 409
      ? t("caseEditor.runConflict")
      : caseRun.error.message;
  const editingCase = editing && editing !== "new" ? editing : undefined;

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
      {caseRunError && (
        <div role="alert" style={s.error}>
          {caseRunError}
        </div>
      )}

      <MetricTiles dashboard={dashboard} />

      <div style={s.head}>
        <div style={s.title}>{t("evalsTab.casesHeading")}</div>
        {cases && (
          <div style={s.count}>{t("evalsTab.passingCount", { passing: cases.passing, total: cases.total })}</div>
        )}
        <div style={s.spacer}>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
            {t("caseEditor.newCase")}
          </Button>
        </div>
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
        <EvalCaseList
          cases={cases.cases}
          onEdit={setEditing}
          onRun={(c) => caseRun.mutate({ caseId: c.id })}
          onDelete={(c) => setPendingDelete({ id: c.id, name: c.name })}
          runningCaseId={caseRun.isPending ? caseRun.variables?.caseId : null}
        />
      )}

      {editing && (
        <EvalCaseEditor
          key={editingCase?.id ?? "new"}
          owner={{ kind: "agent", id: agentId }}
          initial={editingCase}
          takenNames={(cases?.cases ?? []).filter((c) => c.id !== editingCase?.id).map((c) => c.name)}
          onClose={() => setEditing(null)}
          onRun={(caseId) => caseRun.mutate({ caseId })}
        />
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
