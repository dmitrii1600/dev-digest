/* HostPickerModal — asks which linked agent should host a skill's eval run. The skill runs with
   that agent's prompt, model and strategy and only the skill under test enabled. The default is
   the host of the skill's latest run when that agent is still linked, otherwise the first one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, SelectInput } from "@devdigest/ui";
import type { CSSProperties } from "react";

/** Co-located styles. */
const s = {
  body: { display: "flex", flexDirection: "column", gap: 14, padding: "18px 24px" } satisfies CSSProperties,
  text: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;

export interface HostOption {
  id: string;
  name: string;
}

export function HostPickerModal({
  hosts,
  lastHostId,
  onConfirm,
  onCancel,
}: {
  hosts: HostOption[];
  /** Host of the skill's latest run, if any. */
  lastHostId?: string | null;
  onConfirm: (hostAgentId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");
  const [chosen, setChosen] = React.useState<string>(
    () => (hosts.find((h) => h.id === lastHostId) ?? hosts[0])?.id ?? "",
  );

  return (
    <Modal
      width={460}
      title={t("evals.hostPicker.title")}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel}>
            {t("evals.hostPicker.cancel")}
          </Button>
          <Button kind="primary" icon="Play" disabled={!chosen} onClick={() => onConfirm(chosen)}>
            {t("evals.hostPicker.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.text}>{t("evals.hostPicker.body")}</div>
        <label style={s.label}>
          {t("evals.hostPicker.label")}
          <SelectInput
            mono={false}
            value={chosen}
            onChange={setChosen}
            options={hosts.map((h) => ({ value: h.id, label: h.name }))}
          />
        </label>
      </div>
    </Modal>
  );
}
