import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  entry: { marginBottom: 10 } satisfies CSSProperties,
  row: (current: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid " + (current ? "var(--border-strong)" : "var(--border)"),
    background: current ? "var(--bg-hover)" : "var(--bg-elevated)",
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  topRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } satisfies CSSProperties,
  version: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  diffBox: {
    marginTop: 8,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  diffCaption: {
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  diffLines: { padding: "8px 0", maxHeight: 360, overflow: "auto" } satisfies CSSProperties,
  diffEmpty: { padding: "14px 18px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  lineNo: {
    width: 40,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
