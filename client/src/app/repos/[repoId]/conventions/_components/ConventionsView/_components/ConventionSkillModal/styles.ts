import type { CSSProperties } from "react";

/** Co-located styles for ConventionSkillModal. */
export const s = {
  // `Modal` pads its header and footer but not the children slot — every
  // Modal consumer pads its own body (24px), and this one forgot to.
  body: { display: "flex", flexDirection: "column", gap: 16, padding: 24 } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 7,
    background: "var(--accent-bg)",
    border: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } satisfies CSSProperties,
  agents: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  agentRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } satisfies CSSProperties,
  agentModel: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  bodyHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginBottom: 6,
  } satisfies CSSProperties,
  bodyHeadSpacer: { flex: 1 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10, width: "100%" } satisfies CSSProperties,
  footerNote: { flex: 1, fontSize: 12.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
