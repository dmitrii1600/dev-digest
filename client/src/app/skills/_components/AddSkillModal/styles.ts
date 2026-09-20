import type { CSSProperties } from "react";

/** Co-located styles for AddSkillModal and its tabs. `Modal` pads its header
 *  and footer but not the children slot, so the tab body pads itself (24px,
 *  the same as every other Modal consumer). The action row lives inside the
 *  body because each tab owns its own submit state. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  section: { marginBottom: 22 } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    border: "1px solid var(--crit)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 16,
  } satisfies CSSProperties,
  bodyBox: {
    maxHeight: 220,
    overflow: "auto",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 12,
    background: "var(--bg-primary)",
    fontSize: 13,
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  status: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  urlRow: { display: "flex", gap: 10, alignItems: "flex-start" } satisfies CSSProperties,
  urlInput: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  sourceRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginBottom: 16,
  } satisfies CSSProperties,
  sourceUrl: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
