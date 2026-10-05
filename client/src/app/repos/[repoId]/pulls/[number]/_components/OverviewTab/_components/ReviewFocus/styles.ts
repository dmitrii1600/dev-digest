import type { CSSProperties } from "react";

/** Co-located styles for ReviewFocus. Card chrome follows IntentCard's. */
export const s = {
  card: {
    padding: 10,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  rowBtn: {
    display: "block",
    width: "100%",
    padding: "6px 8px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    font: "inherit",
    fontSize: 13,
    textAlign: "left",
    color: "var(--text-secondary)",
    cursor: "pointer",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  target: {
    color: "var(--accent-text)",
    fontSize: 12,
  } satisfies CSSProperties,
} as const;
