/* TourSection — one accordion section. The header button's accessible name is
   the section title (NFR-7): the Expand/Collapse hint lives in `title`, never
   in `aria-label`, so the name stays stable while the state changes. */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";

const s = {
  root: { border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-surface)", scrollMarginTop: 72 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 16px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-primary)",
    fontSize: 15,
    fontWeight: 650,
    textAlign: "left",
  } satisfies CSSProperties,
  title: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  body: { padding: "4px 16px 16px", fontSize: 13.5 } satisfies CSSProperties,
};

export function TourSection({
  id,
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("onboarding");
  const bodyId = `tour-body-${id}`;
  const Lead = Icon[icon];
  const Chevron = expanded ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <section id={`tour-${id}`} style={s.root}>
      <button
        type="button"
        style={s.header}
        aria-expanded={expanded}
        aria-controls={bodyId}
        title={t("expandHint")}
        onClick={onToggle}
      >
        <Lead size={16} aria-hidden="true" />
        <span style={s.title}>{title}</span>
        <Chevron size={16} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={bodyId} role="region" aria-label={title} style={s.body}>
          {children}
        </div>
      )}
    </section>
  );
}
