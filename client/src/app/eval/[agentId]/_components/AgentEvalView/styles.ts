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
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  card: {
    padding: 16,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
