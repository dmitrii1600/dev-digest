/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, PrFile, Severity } from "@devdigest/shared";
import { FindingCard, type EvalCaseStatus } from "../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { useCreateEvalCaseFromFinding, useStartCaseRun } from "@/lib/hooks/evals";
import { EvalCaseConfirmModal } from "./_components/EvalCaseConfirmModal";
import { KEY_TO_ACTION } from "./constants";
import { evalStatusForError, visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severity = null,
  evalAgentAvailable = false,
  files,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Severity filter driven by the pills above; null shows everything. Owned by
   *  the accordion so the pills and this list read the same state. */
  severity?: Severity | null;
  /** The review has a producing agent that still exists — only then can a finding
   *  become an eval case (EC-3). */
  evalAgentAvailable?: boolean;
  /** The PR's files, for the eval-case confirmation modal's diff preview. */
  files?: PrFile[];
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const createEvalCase = useCreateEvalCaseFromFinding();
  const startCaseRun = useStartCaseRun();
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<FindingRecord | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [modalError, setModalError] = React.useState<"too_large" | "error" | null>(null);
  const busyRef = React.useRef(false);
  const [evalStatus, setEvalStatus] = React.useState<Record<string, EvalCaseStatus>>({});
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severity),
    [findings, hideLow, severity],
  );

  // Narrowing the list can strand the j/k cursor past the end. Clamp it here
  // rather than resetting it from an effect: derived during render, so there is
  // no second render pass and no frame where the highlight points at nothing.
  const focused = Math.min(focusIdx, Math.max(0, shown.length - 1));

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (confirming) return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focused]) {
        action.mutate({ findingId: shown[focused]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focused, action, prId, confirming]);

  const closeModal = () => {
    setConfirming(null);
    setModalError(null);
  };

  // User dismissal (Escape / backdrop / Cancel) reads the synchronous ref, not the
  // `busy` state: between submit() starting and React committing busy=true the
  // modal still holds a busy=false closure, and closing then would hide a request
  // that still saves the case.
  const cancelModal = () => {
    if (!busyRef.current) closeModal();
  };

  // Save only creates the case; Run also starts a single-case run and opens the
  // owning agent's Evals tab. A second click while a request is in flight is dropped.
  const submit = async (mode: "save" | "run") => {
    const f = confirming;
    if (!f || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setModalError(null);
    const setStatus = (status: EvalCaseStatus) => setEvalStatus((m) => ({ ...m, [f.id]: status }));
    try {
      let res;
      try {
        res = await createEvalCase.mutateAsync(f.id);
      } catch (err) {
        const status = evalStatusForError(err);
        setModalError(status === "too_large" ? "too_large" : "error");
        return;
      }
      if (mode === "save") {
        setStatus(res.created ? "created" : "exists");
        closeModal();
        return;
      }
      try {
        await startCaseRun.mutateAsync({ caseId: res.case.id });
      } catch (err) {
        // 409: the case is already running — treat as started.
        if (!(err instanceof ApiError && err.status === 409)) {
          setStatus("run_failed");
          closeModal();
          return;
        }
      }
      setStatus(res.created ? "created" : "exists");
      closeModal();
      router.push(`/agents/${res.case.owner_id}?tab=evals`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focused}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              evalAvailable={evalAgentAvailable}
              evalPending={confirming !== null}
              evalStatus={evalStatus[f.id] ?? null}
              onTurnIntoEval={() => setConfirming(f)}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>

      {confirming && (
        <EvalCaseConfirmModal
          finding={confirming}
          files={files}
          busy={busy}
          error={modalError}
          onSaveOnly={() => void submit("save")}
          onRun={() => void submit("run")}
          onCancel={cancelModal}
        />
      )}
    </div>
  );
}
