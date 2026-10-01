/* OnThisPage — the left-hand list of the five sections; picking one asks the
   view to expand it and scroll it into view (AC-4). */
"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSectionId } from "@devdigest/shared";
import { SECTIONS } from "../../constants";

const s = {
  nav: { display: "flex", flexDirection: "column", gap: 2, width: 200, flexShrink: 0, position: "sticky", top: 72, alignSelf: "flex-start" } satisfies CSSProperties,
  label: { fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-muted)", padding: "0 8px 6px" } satisfies CSSProperties,
  item: {
    textAlign: "left",
    padding: "6px 8px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 13,
  } satisfies CSSProperties,
};

export function OnThisPage({ onSelect }: { onSelect: (id: OnboardingSectionId) => void }) {
  const t = useTranslations("onboarding");
  return (
    <nav aria-label={t("onThisPage")} style={s.nav}>
      <div style={s.label}>{t("onThisPage")}</div>
      {SECTIONS.map(({ id }) => (
        <button key={id} type="button" style={s.item} onClick={() => onSelect(id)}>
          {t(`sections.${id}`)}
        </button>
      ))}
    </nav>
  );
}
