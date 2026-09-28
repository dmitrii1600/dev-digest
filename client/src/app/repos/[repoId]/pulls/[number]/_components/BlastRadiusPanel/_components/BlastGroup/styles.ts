import type { CSSProperties } from "react";

/** Co-located styles for one collapsible symbol group — a compact tree row
    on a subtle elevated background (`--bg-hover`, one step up from the
    card's own `--bg-elevated`), with a vertical guide line down the caller
    list for the tree look. Colours are CSS tokens only. */
export const s = {
  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-hover)",
    overflow: "hidden",
  } satisfies CSSProperties,
  groupHeader: {
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
  groupHeaderLeft: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  codeIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  symbolName: {
    fontSize: 14,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  callerCount: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  groupBody: {
    padding: "10px 14px 14px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  /** The tree's vertical guide line: a left border the caller rows hang off,
      ~14px of indent between the guide and the row content. */
  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginLeft: 7,
    paddingLeft: 14,
    borderLeft: "1px solid var(--border)",
  } satisfies CSSProperties,
  callerRow: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  guideGlyph: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  chipsRow: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
} as const;
