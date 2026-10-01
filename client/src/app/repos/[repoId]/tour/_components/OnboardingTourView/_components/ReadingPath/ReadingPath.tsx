/* ReadingPath — the index's files in reading order: position, the path as a
   GitHub link, and the model's reason (or a muted "No reason given"). */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { OnboardingFile } from "@devdigest/shared";
import { githubFileUrl } from "../../helpers";

const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  num: { flexShrink: 0, width: 22, color: "var(--text-muted)", textAlign: "right" } satisfies CSSProperties,
  text: { flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
  reason: { display: "block", color: "var(--text-secondary)" } satisfies CSSProperties,
  noReason: { display: "block", color: "var(--text-muted)" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
};

export function ReadingPath({
  files,
  fullName,
  branch,
}: {
  files: OnboardingFile[];
  fullName: string;
  branch: string;
}) {
  const t = useTranslations("onboarding");
  if (files.length === 0) return <div style={s.muted}>{t("sectionEmpty.reading_path")}</div>;
  return (
    <ol style={s.list}>
      {files.map((f, i) => (
        <li key={f.path} style={s.row}>
          <span style={s.num}>{i + 1}.</span>
          <span style={s.text}>
            <a
              className="mono"
              href={githubFileUrl(fullName, branch, f.path)}
              target="_blank"
              rel="noopener noreferrer"
              style={s.link}
            >
              {f.path}
            </a>
            <span style={f.reason ? s.reason : s.noReason}>{f.reason ?? t("noReason")}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
