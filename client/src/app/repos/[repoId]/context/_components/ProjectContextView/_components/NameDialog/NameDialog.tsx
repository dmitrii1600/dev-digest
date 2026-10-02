/* NameDialog — asks for the name of a new file or folder under
   .devdigest/specs/. Pre-filled, so Create is one click; the server owns every
   name rule and its 422 comes back as `error`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, TextInput } from "@devdigest/ui";
import { s } from "../../styles";

export function NameDialog({
  kind,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  kind: "file" | "folder";
  busy: boolean;
  error: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("context");
  const [name, setName] = React.useState(kind === "file" ? t("nameDialog.defaultFile") : t("nameDialog.defaultFolder"));
  const inputId = React.useId();
  const canCreate = name.length > 0 && !busy;
  const submit = () => {
    if (canCreate) onConfirm(name);
  };

  return (
    <Modal
      width={440}
      title={kind === "file" ? t("nameDialog.fileTitle") : t("nameDialog.folderTitle")}
      onClose={onCancel}
      footer={
        <div style={s.dialogFooter}>
          <Button kind="ghost" onClick={onCancel} disabled={busy}>
            {t("nameDialog.cancel")}
          </Button>
          <Button kind="primary" onClick={submit} loading={busy} disabled={!canCreate}>
            {t("nameDialog.create")}
          </Button>
        </div>
      }
    >
      <div style={s.dialogBody}>
        <label htmlFor={inputId} style={s.dialogLabel}>
          {t("nameDialog.label")}
        </label>
        <TextInput
          id={inputId}
          mono
          autoFocus
          value={name}
          onChange={setName}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        {error && (
          <div role="alert" style={s.dialogError}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
