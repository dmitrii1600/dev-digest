import type { CSSProperties } from "react";

/** Co-located styles for PrBrief. Card chrome follows IntentCard's. */
export const s = {
  section: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 10,
    minHeight: 320,
    padding: 24,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  emptyTile: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  emptyTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 14,
    color: "var(--text-secondary)",
    margin: 0,
    maxWidth: 380,
  } satisfies CSSProperties,
  skeletonRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
  divider: {
    height: 1,
    background: "var(--border)",
  } satisfies CSSProperties,
  stale: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  factsTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    margin: 0,
  } satisfies CSSProperties,
  facts: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: "0 0 0 18px",
    fontSize: 13,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  errorLink: {
    color: "var(--accent-text)",
    textDecoration: "underline",
  } satisfies CSSProperties,
} as const;
