import type { CSSProperties } from "react";

/** Co-located styles for the /eval landing. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 20 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  headActions: { display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" } satisfies CSSProperties,
  helper: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 14,
    marginBottom: 28,
  } satisfies CSSProperties,
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  notice: {
    fontSize: 13,
    padding: "10px 12px",
    marginBottom: 16,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
