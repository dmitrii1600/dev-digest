/* CriticalPaths — the files on the index's dependency chains, each with the
   model's one-line reason and an Open link to GitHub (default branch). LLM text
   is plain text in a wrapping span — never in a Badge (nowrap). */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingFile } from "@devdigest/shared";
import { githubFileUrl } from "../../helpers";

const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 8 } satisfies CSSProperties,
  icon: { flexShrink: 0, marginTop: 3, color: "var(--text-muted)" } satisfies CSSProperties,
  text: { flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" } satisfies CSSProperties,
  reason: { color: "var(--text-secondary)" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  open: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12.5,
    color: "var(--accent-text)",
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
          <Icon.File size={14} aria-hidden="true" style={s.icon} />
          <span style={s.text}>
            <span className="mono">{f.path}</span>
            {" — "}
            <span style={f.reason ? s.reason : s.muted}>{f.reason ?? t("noReason")}</span>
          </span>
          <a
            href={githubFileUrl(fullName, branch, f.path)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("openFile", { path: f.path })}
            style={s.open}
          >
            {t("open")}
            <Icon.ExternalLink size={12} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
