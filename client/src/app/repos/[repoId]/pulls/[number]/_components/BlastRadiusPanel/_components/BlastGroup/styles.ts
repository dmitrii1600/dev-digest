import type { CSSProperties } from "react";

/** Co-located styles for one collapsible symbol group. Colours are CSS tokens only. */
export const s = {
  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  groupHeaderMain: { flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  symbolName: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  declaredIn: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  callerCount: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  groupBody: {
    padding: "10px 14px 14px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  callerList: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  callerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  callerName: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  chipsRow: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
} as const;
