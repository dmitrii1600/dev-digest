import type { CSSProperties } from "react";

/** Co-located styles for the skill Evals tab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  helper: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  count: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "16px 0" } satisfies CSSProperties,
} as const;
