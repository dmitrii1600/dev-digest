import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusPanel. Colours are CSS tokens only. */
export const s = {
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    flexWrap: "wrap",
    marginBottom: 12,
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statNum: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  reasonText: {
    fontSize: 13,
    color: "var(--warn)",
    marginBottom: 14,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  viewToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  } satisfies CSSProperties,
  toggleBtn: (pressed: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 12px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "inherit",
    cursor: "pointer",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: pressed ? "var(--accent)" : "var(--border)",
    background: pressed ? "var(--accent-bg)" : "transparent",
    color: pressed ? "var(--accent-text)" : "var(--text-secondary)",
  }),
  groupList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  degradedRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  resyncNote: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
