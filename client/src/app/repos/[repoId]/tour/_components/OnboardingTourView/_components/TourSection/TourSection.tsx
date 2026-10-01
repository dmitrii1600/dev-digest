/* TourSection — one accordion section. The header button's accessible name is
   the section title (NFR-7): the Expand/Collapse hint lives in `title`, never
   in `aria-label`, so the name stays stable while the state changes. */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";

const s = {
  root: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    scrollMarginTop: 72,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "13px 16px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-primary)",
    textAlign: "left",
  } satisfies CSSProperties,
  lead: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  title: { flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600 } satisfies CSSProperties,
  chevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  body: { padding: "0 16px 16px", fontSize: 13.5 } satisfies CSSProperties,
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
        <span style={s.lead} aria-hidden="true">
          <Lead size={15} />
        </span>
        <span style={s.title}>{title}</span>
        <Icon.ChevronDown size={16} aria-hidden="true" style={s.chevron(expanded)} />
      </button>
      {expanded && (
        <div id={bodyId} role="region" aria-label={title} style={s.body}>
          {children}
        </div>
      )}
    </section>
  );
}
