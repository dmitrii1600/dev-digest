import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 18,
  } satisfies CSSProperties,
  bodyLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 } satisfies CSSProperties,
  bodyBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 18,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
