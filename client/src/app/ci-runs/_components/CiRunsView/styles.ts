import type { CSSProperties } from "react";

export const s = {
  page: { display: "flex", flexDirection: "column", gap: 18, padding: "28px 28px" } satisfies CSSProperties,
  head: { display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-muted)", margin: "6px 0 0" } satisfies CSSProperties,
  controls: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  filters: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  /** A filter chip: an icon plus a borderless native select; accent when a value is set. */
  filter: (active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 4px 0 12px",
    borderRadius: 6,
    border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-secondary)",
  }),
  select: {
    padding: "6px 8px 6px 0",
    fontSize: 13,
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
