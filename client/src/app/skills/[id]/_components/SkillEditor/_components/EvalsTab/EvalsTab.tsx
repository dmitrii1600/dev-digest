/* EvalsTab (skill) — a skill's eval cases and its latest results on a host agent. The same row
   content and the same case editor as the agent Evals tab (`@/components/eval-cases`); what
   differs is the run: a skill has no model of its own, so "Run all evals" and every per-case Run
   first ask for a host agent among the agents the skill is linked to. The skill then runs with the
   host's prompt, model and strategy and only itself enabled. Skill runs live on this tab only —
   never on the agent's tab or the Eval Dashboard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import type { EvalCaseListItem } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { EvalCaseEditor, EvalCaseList } from "@/components/eval-cases";
import { MetricTiles } from "@/components/eval-metrics";
import { ApiError } from "@/lib/api";
import { useAgents } from "@/lib/hooks/agents";
import {
  useDeleteEvalCase,
  useSkillEvalCases,
  useSkillEvalDashboard,
  useStartCaseRun,
  useStartSkillEvalRun,
} from "@/lib/hooks/evals";
import { useSkillAgents } from "@/lib/hooks/skills";
import { HostPickerModal } from "./_components/HostPickerModal";
import { s } from "./styles";

/** What the host picker is for: the whole set, or one saved case. */
type PickerFor = { kind: "suite" } | { kind: "case"; caseId: string };

export function EvalsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const te = useTranslations("eval");
  const { data: cases, isLoading: casesLoading, isError: casesError } = useSkillEvalCases(skillId);
  const { data: dashboard } = useSkillEvalDashboard(skillId);
  const { data: linked } = useSkillAgents(skillId);
  const { data: agents } = useAgents();
  const startSuite = useStartSkillEvalRun(skillId);
  const caseRun = useStartCaseRun();
  const del = useDeleteEvalCase(skillId);
  const [pendingDelete, setPendingDelete] = React.useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = React.useState<EvalCaseListItem | "new" | null>(null);
  const [pickerFor, setPickerFor] = React.useState<PickerFor | null>(null);

  const hosts = (linked ?? []).map((l) => ({ id: l.agent_id, name: l.agent_name }));
  const noHost = hosts.length === 0;
  const noCases = (cases?.total ?? 0) === 0;
  const running = !!dashboard?.running || startSuite.isPending;
  const latest = dashboard?.recent_runs[0];
  const latestAgent = latest ? (agents?.find((a) => a.id === latest.agent_id)?.name ?? null) : null;
  const latestSkillVersion = latest?.skills.find((x) => x.skill_id === skillId)?.version;
  const editingCase = editing && editing !== "new" ? editing : undefined;
  const blockedReason = noHost ? t("evals.noHost") : null;

  // A 409 means that run is already live; say which one.
  const conflict = (err: unknown) => err instanceof ApiError && err.status === 409;
  const suiteError = !startSuite.isError
    ? null
    : conflict(startSuite.error)
      ? t("evals.runConflict")
      : startSuite.error.message;
  const caseRunError = !caseRun.isError
    ? null
    : conflict(caseRun.error)
      ? te("caseEditor.runConflict")
      : caseRun.error.message;

  const confirmHost = (hostAgentId: string) => {
    const target = pickerFor;
    setPickerFor(null);
    if (target?.kind === "suite") startSuite.mutate(hostAgentId);
    else if (target) caseRun.mutate({ caseId: target.caseId, hostAgentId });
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <div style={s.title}>{t("evals.title")}</div>
          <div style={s.subtitle}>{t("evals.subtitle")}</div>
        </div>
        <div style={s.spacer}>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={noHost || noCases || running}
            loading={running}
            onClick={() => setPickerFor({ kind: "suite" })}
          >
            {running ? t("evals.running") : t("evals.runAll")}
          </Button>
        </div>
      </div>
      {noHost && <div style={s.helper}>{t("evals.noHost")}</div>}
      {latest && (
        <div style={s.helper}>
          {t("evals.latestRun", {
            agent: latestAgent ?? t("evals.unknownAgent"),
            agentVersion: latest.agent_version,
            skillVersion: latestSkillVersion ?? "—",
          })}
        </div>
      )}
      {suiteError && (
        <div role="alert" style={s.error}>
          {suiteError}
        </div>
      )}
      {caseRunError && (
        <div role="alert" style={s.error}>
          {caseRunError}
        </div>
      )}

      <MetricTiles dashboard={dashboard} />

      <div style={s.head}>
        <div style={s.title}>{te("evalsTab.casesHeading")}</div>
        {cases && (
          <div style={s.count}>{t("evals.passingCount", { passing: cases.passing, total: cases.total })}</div>
        )}
        <div style={s.spacer}>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
            {t("evals.newCase")}
          </Button>
        </div>
      </div>

      {casesLoading ? (
        <Skeleton height={120} />
      ) : casesError || !cases ? (
        <div role="alert" style={s.error}>
          {t("evals.loadError")}
        </div>
      ) : cases.cases.length === 0 ? (
        <div style={s.empty}>{t("evals.emptyCases")}</div>
      ) : (
        <EvalCaseList
          cases={cases.cases}
          onEdit={setEditing}
          onRun={(c) => setPickerFor({ kind: "case", caseId: c.id })}
          onDelete={(c) => setPendingDelete({ id: c.id, name: c.name })}
          runBlockedReason={blockedReason}
          runningCaseId={caseRun.isPending ? caseRun.variables?.caseId : null}
        />
      )}

      {editing && (
        <EvalCaseEditor
          key={editingCase?.id ?? "new"}
          owner={{ kind: "skill", id: skillId }}
          initial={editingCase}
          takenNames={(cases?.cases ?? []).filter((c) => c.id !== editingCase?.id).map((c) => c.name)}
          onClose={() => setEditing(null)}
          onRun={(caseId) => setPickerFor({ kind: "case", caseId })}
          runBlockedReason={blockedReason}
        />
      )}

      {pickerFor && (
        <HostPickerModal
          hosts={hosts}
          lastHostId={latest?.agent_id}
          onConfirm={confirmHost}
          onCancel={() => setPickerFor(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          title={te("evalsTab.deleteTitle")}
          body={te("evalsTab.deleteBody")}
          confirmLabel={te("evalsTab.delete")}
          cancelLabel={te("evalsTab.cancel")}
          busy={del.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => del.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })}
        />
      )}
    </div>
  );
}
