/* StatusPill — a CI run status as a tinted pill with a dot. The label is always
   text, so the colour never carries the meaning alone. */
import React from "react";
import { useTranslations } from "next-intl";
import type { StatusKey } from "./helpers";
import { s } from "./styles";

const TONE: Record<StatusKey, { c: string; bg: string }> = {
  succeeded: { c: "var(--ok)", bg: "var(--ok-bg)" },
  noFindings: { c: "var(--text-secondary)", bg: "var(--info-bg)" },
  failed: { c: "var(--crit)", bg: "var(--crit-bg)" },
  running: { c: "var(--accent-text)", bg: "var(--accent-bg)" },
};

export function StatusPill({ status }: { status: StatusKey }) {
  const t = useTranslations("ci");
  const tone = TONE[status];
  return (
    <span style={{ ...s.pill, color: tone.c, background: tone.bg }}>
      <span style={{ ...s.dot, background: tone.c }} aria-hidden />
      {t(`runs.status.${status}`)}
    </span>
  );
}
