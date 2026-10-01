/* CriticalPaths — the files on the index's dependency chains, each on its own
   surface row: file icon, mono path, the model's one-line reason, and an Open
   link to GitHub (default branch). LLM text is plain text in a wrapping span —
   never in a Badge (nowrap). */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingFile } from "@devdigest/shared";
import { githubFileUrl } from "../../helpers";
import { InlineCode } from "../InlineCode/InlineCode";

const s = {
  list: { listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 7 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 11px",
    borderRadius: 7,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  icon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  text: { flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.5 } satisfies CSSProperties,
  path: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  reason: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  noReason: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  open: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 9px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    fontSize: 12.5,
    fontWeight: 500,
    color: "var(--text-primary)",
    textDecoration: "none",
  } satisfies CSSProperties,
};

export function CriticalPaths({
  files,
  fullName,
  branch,
}: {
  files: OnboardingFile[];
  fullName: string;
  branch: string;
}) {
  const t = useTranslations("onboarding");
  if (files.length === 0) return <div style={s.muted}>{t("sectionEmpty.critical_paths")}</div>;
  return (
    <ul style={s.list}>
      {files.map((f) => (
        <li key={f.path} style={s.row}>
          <Icon.FileText size={13} aria-hidden="true" style={s.icon} />
          <span style={s.text}>
            <span className="mono" style={s.path}>
              {f.path}
            </span>
            <span style={s.reason}>{" — "}</span>
            <span style={f.reason ? s.reason : s.noReason}>{f.reason ? <InlineCode text={f.reason} /> : t("noReason")}</span>
          </span>
          <a
            href={githubFileUrl(fullName, branch, f.path)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("openFile", { path: f.path })}
            style={s.open}
          >
            {t("open")}
          </a>
        </li>
      ))}
    </ul>
  );
}
