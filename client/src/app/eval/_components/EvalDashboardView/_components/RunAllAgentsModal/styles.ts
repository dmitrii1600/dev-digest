import type { CSSProperties } from "react";

/** Co-located styles for the Run all agents modal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 14, fontSize: 14 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  row: { display: "flex", alignItems: "baseline", gap: 14 } satisfies CSSProperties,
  name: { flex: 1, fontWeight: 600 } satisfies CSSProperties,
  cost: { minWidth: 64, textAlign: "right", color: "var(--text-secondary)" } satisfies CSSProperties,
  total: { fontWeight: 700 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
