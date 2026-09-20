import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 14, marginBottom: 24 } satisfies CSSProperties,
  section: { marginBottom: 20 } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 12 } satisfies CSSProperties,
  caveat: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 18,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
