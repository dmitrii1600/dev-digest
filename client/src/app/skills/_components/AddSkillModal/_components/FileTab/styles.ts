import type { CSSProperties } from "react";

/** Co-located styles for FileTab — the picker and the archive-contents table.
 *  Everything the URL tab shares (body box, error row, actions) lives in the
 *  modal's own `styles.ts`. */
export const s = {
  picker: {
    border: "1.5px dashed var(--border-strong)",
    borderRadius: 9,
    padding: "32px 20px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,
  pickerLabel: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  pickerHint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  fileInput: { fontSize: 13 } satisfies CSSProperties,
  entriesTitle: { fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  entryRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  entryPath: {
    fontFamily: "var(--font-mono, monospace)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  entryReason: { color: "var(--text-muted)" } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    marginTop: 10,
  } satisfies CSSProperties,
} as const;
