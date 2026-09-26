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
} as const;
