import type { CSSProperties } from "react";

/** Co-located styles for the Compare modal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  warn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    color: "var(--warn)",
    fontSize: 13,
  } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  diffBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  diffLines: { padding: "8px 0", maxHeight: 320, overflow: "auto" } satisfies CSSProperties,
  diffEmpty: { padding: "14px 18px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  lineNo: {
    width: 40,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;
