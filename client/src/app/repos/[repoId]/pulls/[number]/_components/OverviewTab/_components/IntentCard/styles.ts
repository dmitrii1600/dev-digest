import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. Follows VerdictBanner's card chrome. */
export const s = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  intentText: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 20,
  } satisfies CSSProperties,
  scopeCol: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  scopeHeader: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  scopeList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    listStyle: "none",
    margin: 0,
    padding: 0,
    minWidth: 0,
  } satisfies CSSProperties,
  scopeItem: {
    display: "flex",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  scopeBullet: {
    flex: "none",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeItemText: {
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  scopeLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  notStated: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  confidenceBar: { width: 160 } satisfies CSSProperties,
  confidencePct: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  confidenceDetail: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: -6,
  } satisfies CSSProperties,
  sourcesRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  } satisfies CSSProperties,
} as const;
