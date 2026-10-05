import type { CSSProperties } from "react";

/** Co-located styles for the agent Evals tab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  helper: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  count: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  name: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "16px 0" } satisfies CSSProperties,
} as const;
