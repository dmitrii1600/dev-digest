import type { CSSProperties } from "react";

export const s = {
  svg: {
    width: "100%",
    height: "auto",
    display: "block",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "24px 0",
    textAlign: "center",
  } satisfies CSSProperties,
} as const;
