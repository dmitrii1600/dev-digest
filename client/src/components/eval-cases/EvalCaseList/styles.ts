import type { CSSProperties } from "react";

/** Co-located styles for the shared eval case rows. */
export const s = {
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
  nameLine: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  name: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  marker: { fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  disabled: { display: "inline-flex", opacity: 0.4, cursor: "not-allowed" } satisfies CSSProperties,
  results: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 } satisfies CSSProperties,
} as const;
