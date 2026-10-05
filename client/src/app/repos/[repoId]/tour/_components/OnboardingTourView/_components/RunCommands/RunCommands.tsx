/* RunCommands — numbered commands, each on a code-surface row as selectable
   plain text with a copy button. The command is only ever shown or copied,
   never run. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingCommand } from "@devdigest/shared";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

const s = {
  list: { listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 7,
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  num: { flexShrink: 0, width: 14, fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  code: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  } satisfies CSSProperties,
  copy: {
    flexShrink: 0,
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    padding: 2,
    display: "inline-flex",
  } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
};

export function RunCommands({ commands }: { commands: OnboardingCommand[] }) {
  const t = useTranslations("onboarding");
  const copy = useCopyToClipboard();
  if (commands.length === 0) return <div style={s.muted}>{t("sectionEmpty.run_locally")}</div>;
  return (
    <ol style={s.list}>
      {commands.map((c, i) => (
        <li key={`${i}:${c.line}`} style={s.row}>
          <span className="tnum" style={s.num}>
            {i + 1}
          </span>
          <code className="mono" style={s.code}>
            {c.line}
          </code>
          <button
            type="button"
            style={s.copy}
            aria-label={t("copyCommand", { command: c.line })}
            onClick={() => void copy(c.line, "command")}
          >
            <Icon.Copy size={13} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}
