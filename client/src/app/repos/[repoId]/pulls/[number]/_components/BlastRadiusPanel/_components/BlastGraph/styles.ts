import type { CSSProperties } from "react";

export const s = {
  /** The SVG keeps its natural size so labels never squash; a wide graph
      scrolls sideways inside the card instead of overlapping. */
  scroller: {
    width: "100%",
    overflowX: "auto",
    overflowY: "hidden",
  } satisfies CSSProperties,
  svg: {
    display: "block",
    maxWidth: "none",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "24px 0",
    textAlign: "center",
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    gap: 16,
    marginTop: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendDot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 99,
    background: color,
    display: "inline-block",
  }),
} as const;
