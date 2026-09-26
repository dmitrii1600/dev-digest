import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusPanel. Colours are CSS tokens only. */
export const s = {
  /** Card chrome, matching IntentCard so the two sit as equals in the top row. */
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** Stats (left) and the Tree/Graph toggle (right) share one header row. */
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** Separates the map from the "Prior PRs" block at the bottom of the card. */
  divider: {
    height: 1,
    background: "var(--border)",
    margin: "4px 0",
  } satisfies CSSProperties,
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  statNum: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  reasonText: {
    fontSize: 13,
    color: "var(--warn)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /** Segmented Tree/Graph control — one pill, the active side filled. */
  viewToggle: {
    display: "inline-flex",
    padding: 3,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  toggleBtn: (pressed: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 14px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    border: "none",
    background: pressed ? "var(--accent-bg)" : "transparent",
    color: pressed ? "var(--accent-text)" : "var(--text-secondary)",
  }),
  groupList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  degradedRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  resyncNote: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
