import type { CSSProperties } from "react";

export const s = {
  /** Intent (L03) and Blast radius (L04) side by side, as in the design;
      collapses to one column on narrow screens. */
  topRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 20,
    alignItems: "start",
    marginBottom: 20,
  } satisfies CSSProperties,
  /** Intent, then the brief's Risk areas, stacked in the grid's first column. */
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    minWidth: 0,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere", // a long URL in a PR body must not scroll Overview sideways (NFR-12)
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
