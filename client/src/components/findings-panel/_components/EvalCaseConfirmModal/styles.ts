import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseConfirmModal. The kit Modal gives children no padding. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  head: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" } satisfies CSSProperties,
  meta: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  file: { fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, overflowWrap: "anywhere" } satisfies CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    marginBottom: 4,
  } satisfies CSSProperties,
  pre: {
    margin: 0,
    padding: 12,
    maxHeight: 280,
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  muted: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--danger, #e5484d)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
};
