import type { CSSProperties } from "react";

/** Co-located styles for SkillListItem. */
export const s = {
  row: (active: boolean, enabled: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 7,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "transparent"),
    background: active ? "var(--bg-hover)" : "transparent",
    opacity: enabled ? 1 : 0.65,
    marginBottom: 4,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  name: {
    fontSize: 13.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  badgeRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" } satisfies CSSProperties,
  typeDot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  toggleWrap: { flexShrink: 0 } satisfies CSSProperties,
} as const;
