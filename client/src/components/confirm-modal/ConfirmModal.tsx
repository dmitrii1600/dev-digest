/* ConfirmModal — the one destructive-action confirm for the studio, built on
   `Modal` from @devdigest/ui. Three ways out, as the Skills Lab criteria
   enumerate: Confirm (danger), Cancel, and the header X (`Modal`'s `onClose`).
   Shared because two feature folders (`/skills` cards and `/agents` cards)
   need it — see specs/05-skills-lab-criteria-gaps.md, "Open questions". */
"use client";

import React from "react";
import { Button, Modal } from "@devdigest/ui";
import { s } from "./styles";

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: React.ReactNode;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      width={440}
      title={title}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button kind="danger" icon="Trash" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div style={s.body}>{body}</div>
    </Modal>
  );
}

export default ConfirmModal;
