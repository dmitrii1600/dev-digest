import type { CSSProperties } from "react";

/** Co-located styles for OnboardingTourView. */
export const s = {
  page: { display: "flex", gap: 24, padding: "20px 24px", alignItems: "flex-start" } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 4 } satisfies CSSProperties,
  headText: { flex: 1, minWidth: 240 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  name: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  stale: { fontSize: 12.5, color: "var(--warn, var(--text-secondary))" } satisfies CSSProperties,
  errorLink: { color: "var(--accent-text)" } satisfies CSSProperties,
  center: { padding: 24, flex: 1 } satisfies CSSProperties,
};
