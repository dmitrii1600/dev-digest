import type { CSSProperties } from "react";

/** Co-located styles for the "Prior PRs touching these files" collapsible
    section — one compact card (chevron header + count badge, collapsed by
    default), each prior PR as a row with a divider above all but the first.
    Colours are CSS tokens only, matching `BlastGroup`'s look. */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-hover)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 14px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  historyIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  headerTitle: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  body: {
    padding: "6px 14px 12px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  empty: {
    padding: "10px 0",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 0",
  } satisfies CSSProperties,
  itemDivided: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  itemHeader: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  itemTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  itemMeta: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  itemNote: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chipsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
} as const;
