import type { CSSProperties } from "react";

/** Co-located styles for SkillCard — the same panel recipe as AgentCard, so the
 *  two Skills Lab list screens read as one system. One `border` shorthand, never
 *  `border` + `borderColor` (INSIGHTS, 2026-09-16). */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: 14,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.6,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  iconBox: (color: string): CSSProperties => ({
    width: 26,
    height: 26,
    borderRadius: 7,
    background: color + "1a",
    color,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  }),
  name: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "8px 0",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  /** `Toggle` has no `disabled` prop and `vendor/ui` is do-not-touch, so a
   *  flagged skill's toggle is made inert by its wrapper (plus a no-op
   *  `onChange`). Shared with ConfigTab's Enabled toggle. */
  toggleDisabled: { opacity: 0.45, cursor: "not-allowed" } satisfies CSSProperties,
} as const;
