import type { CSSProperties } from "react";

/** Co-located styles for the skill ContextTab. */
export const s = {
  inherits: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px" } satisfies CSSProperties,
  box: {
    marginTop: 16,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  boxLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  boxBody: { fontSize: 12, whiteSpace: "pre-wrap" } satisfies CSSProperties,
} as const;
