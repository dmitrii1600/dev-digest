import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  filter: { marginLeft: "auto", width: 220 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  /** The house panel recipe (see AgentCard/styles.ts, VersionsTab/styles.ts):
   *  one `border` shorthand — never `border` + `borderColor`, which is itself a
   *  shorthand and trips React's style warning (INSIGHTS, 2026-09-16). */
  row: (enabled: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.6,
  }),
  handle: {
    background: "none",
    border: "none",
    cursor: "grab",
    color: "var(--text-muted)",
    fontSize: 16,
    lineHeight: 1,
    padding: "2px 4px",
    userSelect: "none",
  } satisfies CSSProperties,
  name: { fontSize: 13, flex: 1 } satisfies CSSProperties,
  typeBadge: { marginLeft: "auto", textTransform: "capitalize" } satisfies CSSProperties,
} as const;
