import type { CSSProperties } from "react";

/** Co-located styles for the multi-agent results page. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1400, margin: "0 auto" } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 12 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  selected: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  switch: { display: "inline-flex", gap: 4, marginLeft: "auto" } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  prTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 } satisfies CSSProperties,
  metaRight: { marginLeft: "auto", flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  scroll: { overflowX: "auto" } satisfies CSSProperties,
  link: { color: "var(--accent)", fontSize: 13 } satisfies CSSProperties,
};
