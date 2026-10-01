/* DocPane — the selected document: heading, Preview | Edit, Save, Delete, the
   conflict / error banner, and the body. Presentational over a `SpecDraft`;
   read-only files (outside .devdigest/specs/, tracked, over 64 KB) get Preview
   only and say why. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Markdown } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import type { SpecDraft } from "../../useSpecDraft";
import { s } from "../../styles";

export type DocMode = "preview" | "edit";

export function DocPane({
  path,
  file,
  usedBy,
  mode,
  onModeChange,
  draft,
}: {
  path: string;
  file: SpecFile;
  usedBy: number;
  mode: DocMode;
  onModeChange: (mode: DocMode) => void;
  draft: SpecDraft;
}) {
  const t = useTranslations("context");
  const [confirm, setConfirm] = React.useState<"delete" | "reload" | null>(null);
  const editable = file.editable === true;
  const editing = editable && mode === "edit";
  const busy = draft.saving || draft.deleting;
  const { saveConflict, deleteConflict } = draft;

  return (
    <>
      <div style={s.rightHead}>
        <h2 className="mono" style={s.path}>
          {path}
        </h2>
        <Badge color="var(--text-secondary)">{t("usedBy", { count: usedBy })}</Badge>
        <span style={s.spacer} />
        {editable && (
          <div role="group" aria-label={t("mode.group")} style={s.modeGroup}>
            {(["preview", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                style={s.modeBtn(mode === m)}
                onClick={() => onModeChange(m)}
              >
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
        )}
        {editable && (
          <>
            <span aria-live="polite" style={draft.dirty ? s.statusDirty : s.status}>
              {draft.dirty ? t("unsaved") : t("saved")}
            </span>
            <Button kind="danger" size="sm" icon="Trash" disabled={busy} loading={draft.deleting} onClick={() => setConfirm("delete")}>
              {draft.deleting ? t("deleting") : t("delete")}
            </Button>
            <Button kind="primary" size="sm" disabled={!draft.dirty || busy} loading={draft.saving} onClick={draft.save}>
              {draft.saving ? t("saving") : t("save")}
            </Button>
          </>
        )}
      </div>

      {!editable && (
        <div style={s.readOnlyNote}>
          <Badge color="var(--text-secondary)">{t("readOnly.label")}</Badge>
          <span>{t(`readOnly.${file.read_only_reason ?? "outside_root"}`)}</span>
        </div>
      )}

      {saveConflict && (
        <div role="alert" style={s.banner}>
          <span style={s.bannerText}>{t(`conflict.${saveConflict.reason}`)}</span>
          <Button size="sm" kind="secondary" onClick={() => setConfirm("reload")}>
            {t("conflict.reload")}
          </Button>
          <Button size="sm" kind="danger" disabled={busy} onClick={() => draft.overwrite(saveConflict.current_version)}>
            {t("conflict.overwrite")}
          </Button>
        </div>
      )}
      {deleteConflict && (
        <div role="alert" style={s.banner}>
          <span style={s.bannerText}>
            {t(deleteConflict.reason === "deleted" ? "conflict.deleteGone" : "conflict.deleteChanged")}
          </span>
          <Button size="sm" kind="secondary" onClick={() => setConfirm("reload")}>
            {t("conflict.reload")}
          </Button>
        </div>
      )}
      {draft.saveFailed && (
        <div role="alert" style={s.banner}>
          <span style={s.bannerText}>{t("writeError.save")}</span>
          <Button size="sm" kind="secondary" disabled={busy} onClick={draft.save}>
            {t("writeError.retry")}
          </Button>
        </div>
      )}
      {draft.deleteFailed && (
        <div role="alert" style={s.banner}>
          <span style={s.bannerText}>{t("writeError.delete")}</span>
          <Button size="sm" kind="secondary" disabled={busy} onClick={draft.remove}>
            {t("writeError.retry")}
          </Button>
        </div>
      )}

      {editing ? (
        <textarea
          className="mono"
          style={s.editor}
          spellCheck={false}
          aria-label={t("editorLabel", { path })}
          value={draft.text}
          onChange={(e) => draft.setText(e.target.value)}
        />
      ) : (
        <Markdown>{draft.text}</Markdown>
      )}

      {confirm === "delete" && (
        <ConfirmModal
          title={t("confirm.deleteTitle", { path })}
          body={draft.dirty ? t("confirm.deleteBodyUnsaved") : t("confirm.deleteBody")}
          confirmLabel={t("confirm.deleteConfirm")}
          cancelLabel={t("confirm.cancel")}
          busy={draft.deleting}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            draft.remove();
          }}
        />
      )}
      {confirm === "reload" && (
        <ConfirmModal
          title={t("confirm.reloadTitle")}
          body={t("confirm.reloadBody")}
          confirmLabel={t("confirm.reloadConfirm")}
          cancelLabel={t("confirm.cancel")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void draft.reload();
          }}
        />
      )}
    </>
  );
}
