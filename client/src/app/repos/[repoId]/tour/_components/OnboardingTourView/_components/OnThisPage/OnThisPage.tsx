/* OnThisPage — the left-hand list of the five sections. The active one carries
   an accent bar and `aria-current`; picking one asks the view to expand it and
   scroll it into view (AC-4). */
"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSectionId } from "@devdigest/shared";
import { SECTIONS } from "../../constants";

const s = {
  nav: { display: "flex", flexDirection: "column", width: 180, flexShrink: 0, position: "sticky", top: 72, alignSelf: "flex-start" } satisfies CSSProperties,
  label: { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  item: (on: boolean): CSSProperties => ({
    display: "block",
    textAlign: "left",
    padding: "5px 0 5px 11px",
    marginLeft: -2,
    background: "transparent",
    borderStyle: "solid",
    borderWidth: "0 0 0 2px",
    borderColor: on ? "var(--accent)" : "transparent",
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: on ? 600 : 500,
    fontSize: 12.5,
    cursor: "pointer",
    transition: "color .12s, border-color .12s",
  }),
};

export function OnThisPage({
  active,
  onSelect,
}: {
  active?: OnboardingSectionId;
  onSelect: (id: OnboardingSectionId) => void;
}) {
  const t = useTranslations("onboarding");
  return (
    <nav aria-label={t("onThisPage")} style={s.nav}>
      <div style={s.label}>{t("onThisPage")}</div>
      {SECTIONS.map(({ id }) => (
        <button
          key={id}
          type="button"
          style={s.item(id === active)}
          aria-current={id === active ? "location" : undefined}
          onClick={() => onSelect(id)}
        >
          {t(`sections.${id}`)}
        </button>
      ))}
    </nav>
  );
}
