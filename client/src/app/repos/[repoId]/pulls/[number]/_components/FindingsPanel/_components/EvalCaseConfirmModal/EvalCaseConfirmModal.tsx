/* EvalCaseConfirmModal — presentational confirmation before a finding becomes an
   eval case: what it will freeze (title, severity, location, expectation, the
   overlapping diff hunks) and Save only / Run / Cancel. FindingsPanel owns the
   mutations. Title, file and patch are untrusted and render as plain text only. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, SeverityBadge } from "@devdigest/ui";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { lineLabel } from "../../../FindingCard";
import { PREVIEW_MAX_LINES } from "./constants";
import { previewHunks } from "./helpers";
import { s } from "./styles";

export function EvalCaseConfirmModal({
  finding,
  files,
  busy,
  error,
  onSaveOnly,
  onRun,
  onCancel,
}: {
  finding: FindingRecord;
  files?: PrFile[];
  busy: boolean;
  error: "too_large" | "error" | null;
  onSaveOnly: () => void;
  onRun: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("prReview");
  const titleId = React.useId();
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const preview = React.useMemo(() => previewHunks(files, finding), [files, finding]);

  // The kit Modal has no name prop: label its dialog node from the title.
  React.useEffect(() => {
    bodyRef.current?.closest('[role="dialog"]')?.setAttribute("aria-labelledby", titleId);
  }, [titleId]);

  // While a request is in flight every way out is inert, so "closed" never means "saved anyway".
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <Modal
      width={720}
      title={<span id={titleId}>{t("evalConfirm.title")}</span>}
      subtitle={t("evalConfirm.subtitle")}
      onClose={busy ? () => {} : onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel} disabled={busy}>
            {t("evalConfirm.cancel")}
          </Button>
          <Button kind="secondary" onClick={onRun} disabled={busy}>
            {t("evalConfirm.run")}
          </Button>
          <Button kind="primary" onClick={onSaveOnly} disabled={busy} autoFocus>
            {t("evalConfirm.saveOnly")}
          </Button>
        </div>
      }
    >
      <div ref={bodyRef} style={s.body}>
        <div style={s.head}>
          <div style={s.title}>{finding.title}</div>
          <div style={s.meta}>
            <SeverityBadge severity={finding.severity} />
            <span style={s.file}>
              {finding.file}:{lineLabel(finding)}
            </span>
          </div>
        </div>
        <div>
          <div style={s.label}>{t("evalConfirm.expectation")}</div>
          <code>{finding.accepted_at ? t("evalConfirm.mustFind") : t("evalConfirm.mustNotFlag")}</code>
        </div>
        <div>
          <div style={s.label}>{t("evalConfirm.diffPreview")}</div>
          {preview ? (
            <>
              <pre style={s.pre}>{preview.lines.join("\n")}</pre>
              {preview.truncated && (
                <div style={s.muted}>{t("evalConfirm.previewTruncated", { count: PREVIEW_MAX_LINES })}</div>
              )}
            </>
          ) : (
            <div style={s.muted}>{t("evalConfirm.previewUnavailable")}</div>
          )}
        </div>
        {error && (
          <div role="alert" style={s.error}>
            {error === "too_large" ? t("finding.evalDiffTooLarge") : t("finding.evalCaseFailed")}
          </div>
        )}
      </div>
    </Modal>
  );
}
