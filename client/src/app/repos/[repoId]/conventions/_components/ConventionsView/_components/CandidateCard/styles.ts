import type { CSSProperties } from "react";

/** Co-located styles for CandidateCard. The status accent is an inset shadow,
 *  not a `borderLeft`, so the one `border` shorthand stays alone (INSIGHTS,
 *  2026-09-16). */
export const s = {
  card: (accepted: boolean): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 8,
    border: "1px solid " + (accepted ? "var(--border-strong)" : "var(--border)"),
    background: "var(--bg-elevated)",
    boxShadow: accepted ? "inset 3px 0 0 var(--ok)" : "none",
  }),
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  rule: { fontSize: 15, fontWeight: 600, fontStyle: "italic", flex: 1, minWidth: 0 } satisfies CSSProperties,
  evidence: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  evidencePath: { flex: 1 } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  confidenceRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  confidenceBar: { width: 130 } satisfies CSSProperties,
  actions: { display: "flex", flexDirection: "column", gap: 8, width: 150, flexShrink: 0 } satisfies CSSProperties,
  editRow: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  fieldLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
