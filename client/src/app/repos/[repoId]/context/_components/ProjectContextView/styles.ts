import type { CSSProperties } from "react";

/** Co-located styles for ProjectContextView. */
export const s = {
  page: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  left: {
    width: 320,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  leftHead: { display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 8px" } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", padding: "0 16px 8px" } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "0 8px" } satisfies CSSProperties,
  item: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "7px 8px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: "var(--text-primary)",
  }),
  itemPath: { fontSize: 12, flex: 1, minWidth: 0, wordBreak: "break-all" } satisfies CSSProperties,
  kind: { textTransform: "capitalize" } satisfies CSSProperties,
  count: { fontSize: 12, color: "var(--text-muted)", padding: "10px 16px", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  right: { flex: 1, minWidth: 0, overflow: "auto", padding: "20px 28px" } satisfies CSSProperties,
  rightHead: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } satisfies CSSProperties,
  path: { fontSize: 16, fontWeight: 700, wordBreak: "break-all" } satisfies CSSProperties,
  prompt: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
