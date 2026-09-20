import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView — the same page recipe as SkillsListView. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)", fontWeight: 600 } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    minHeight: 32,
  } satisfies CSSProperties,
  barText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  barSpacer: { flex: 1 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  dimmed: { opacity: 0.55, pointerEvents: "none" } satisfies CSSProperties,
  errorBox: { marginBottom: 16 } satisfies CSSProperties,
} as const;
