import type { CSSProperties } from "react";

/** Co-located styles for SecurityBanner — the same crit recipe as the drawer's error row. */
export const s = {
  box: {
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 16,
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } satisfies CSSProperties,
  icon: { color: "var(--crit)", flexShrink: 0 } satisfies CSSProperties,
  title: { fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  body: { color: "var(--text-secondary)", marginBottom: 8 } satisfies CSSProperties,
  list: { margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  item: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  rule: { fontWeight: 600 } satisfies CSSProperties,
  excerpt: {
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  note: { marginTop: 10, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
