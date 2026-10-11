import type { CSSProperties } from "react";

/** Co-located styles for the Promote confirmation. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 12, fontSize: 14 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  list: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  warn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    color: "var(--warn)",
    fontSize: 13,
  } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
