import type { CSSProperties } from "react";
import type { SmartDiffRole } from "@devdigest/shared";

/** Co-located styles for DiffGroup. Follows IntentCard's card chrome. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  header: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    background: "var(--bg-primary)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 4px",
    border: "none",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  roleSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    flexShrink: 0,
  } satisfies CSSProperties,
  label: {
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  right: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  findingsCounter: {
    color: "var(--crit)",
    fontWeight: 600,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the group is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    flexShrink: 0,
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** One colour per role, from existing CSS custom properties — never a literal. */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  tests: "var(--ok)",
  wiring: "var(--warn)",
  docs: "var(--text-muted)",
  boilerplate: "var(--border-strong)",
};
