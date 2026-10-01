/* RunCommands — numbered commands, each as selectable plain text with a copy
   button. The command is only ever shown or copied, never run. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingCommand } from "@devdigest/shared";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  num: { flexShrink: 0, width: 22, color: "var(--text-muted)", textAlign: "right" } satisfies CSSProperties,
  code: {
    flex: 1,
    minWidth: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
    padding: "2px 8px",
    borderRadius: 6,
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  copy: {
    flexShrink: 0,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    padding: 4,
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
          <span style={s.num}>{i + 1}.</span>
          <code className="mono" style={s.code}>
            {c.line}
          </code>
          <button
            type="button"
            style={s.copy}
            aria-label={t("copyCommand", { command: c.line })}
            onClick={() => void copy(c.line, "command")}
          >
            <Icon.Copy size={14} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}
