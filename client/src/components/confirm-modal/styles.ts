import type { CSSProperties } from "react";

/** Co-located styles for ConfirmModal. */
export const s = {
  body: { padding: 24, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
