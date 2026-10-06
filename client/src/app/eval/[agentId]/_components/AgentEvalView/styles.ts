import type { CSSProperties } from "react";

/** Co-located styles for the /eval/[agentId] screen. */
export const s = {
  page: {
    padding: "24px 32px 44px",
    maxWidth: 1100,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  version: { fontSize: 13, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  controls: { display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginLeft: "auto" } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  card: {
    padding: 16,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
