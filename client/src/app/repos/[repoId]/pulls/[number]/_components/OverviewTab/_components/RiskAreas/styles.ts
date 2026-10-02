import type { CSSProperties } from "react";

/** Co-located styles for RiskAreas. */
export const s = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  /** Per-side borders: an open pill takes the severity colour. */
  pill: (open: boolean, color: string): CSSProperties => {
    const edge = `1px solid ${open ? color : "var(--border)"}`;
    return {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      borderRadius: 8,
      borderTop: edge,
      borderRight: edge,
      borderBottom: edge,
      borderLeft: edge,
      background: "var(--bg-elevated)",
      minWidth: 0,
    };
  },
  row: {
    display: "flex",
    alignItems: "stretch",
    minWidth: 0,
  } satisfies CSSProperties,
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    padding: "8px 10px",
    border: "none",
    background: "transparent",
    font: "inherit",
    textAlign: "left",
    color: "var(--text-primary)",
    cursor: "pointer",
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  severity: (color: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color,
  }),
  ref: {
    fontSize: 12,
    color: "var(--accent-text)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  expander: {
    display: "inline-grid",
    placeItems: "center",
    padding: "0 10px",
    border: "none",
    borderLeft: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  explanation: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  refs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
  refBtn: {
    padding: "2px 6px",
    border: "1px solid var(--border)",
    borderRadius: 5,
    background: "var(--bg-hover)",
    fontSize: 12,
    color: "var(--accent-text)",
    cursor: "pointer",
    overflowWrap: "anywhere",
    textAlign: "left",
  } satisfies CSSProperties,
} as const;
