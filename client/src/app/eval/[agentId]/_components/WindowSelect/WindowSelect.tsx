/* WindowSelect — the time-window picker of the agent eval page: 7 days, 30 days,
   90 days or all. A native <select> (keyboard-operable) under a visible label. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import { WINDOWS, WINDOW_LABEL_KEY, type EvalWindow } from "../window";

const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)" };

export function WindowSelect({ value, onChange }: { value: EvalWindow; onChange: (w: EvalWindow) => void }) {
  const t = useTranslations("eval");
  const options = WINDOWS.map((w) => ({ value: w, label: t(`agentPage.${WINDOW_LABEL_KEY[w]}`) }));
  return (
    <label style={LABEL}>
      {t("agentPage.windowLabel")}
      <SelectInput
        value={value}
        mono={false}
        options={options}
        onChange={(v) => {
          const next = WINDOWS.find((w) => w === v);
          if (next) onChange(next);
        }}
      />
    </label>
  );
}
