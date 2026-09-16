import type { CSSProperties } from "react";

/** Co-located styles for the PR-list findings hover preview. */
export const CARD_WIDTH = 400;

export const s = {
  /* position: fixed is load-bearing, not a style choice: the PR-list table card
     sets `overflow: hidden` (../../app/repos/[repoId]/pulls/styles.ts), so an
     absolutely-positioned child of a row is clipped at the card's edge. Fixed
     positioning escapes that, at the cost of anchoring by getBoundingClientRect. */
  card: (top: number, left: number): CSSProperties => ({
    position: "fixed",
    top,
    left,
    width: CARD_WIDTH,
    maxHeight: 420,
    overflowY: "auto",
    zIndex: 50,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    boxShadow: "0 12px 32px rgba(0,0,0,.35)",
    padding: "10px 0 4px",
    cursor: "default",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 14px 9px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "11px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  titleLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  metaLine: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
  } satisfies CSSProperties,
  location: {
    fontSize: 12,
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  rationale: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,
  empty: {
    padding: "14px",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};
