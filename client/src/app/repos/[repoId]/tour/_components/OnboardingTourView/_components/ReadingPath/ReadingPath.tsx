/* ReadingPath — the index's files in reading order: a numbered accent badge,
   the path as a GitHub link, and the model's reason (or "No reason given")
   underneath. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { MonoLink } from "@devdigest/ui";
import type { OnboardingFile } from "@devdigest/shared";
import { githubFileUrl } from "../../helpers";
import { InlineCode } from "../InlineCode/InlineCode";

const s = {
  list: { listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 11 } satisfies CSSProperties,
  num: {
    width: 20,
    height: 20,
    borderRadius: 99,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    fontSize: 11,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    marginTop: 1,
  } satisfies CSSProperties,
  text: { flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" } satisfies CSSProperties,
  why: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  noReason: { fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic", marginTop: 2 } satisfies CSSProperties,
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
          <span className="tnum" style={s.num}>
            {i + 1}
          </span>
          <div style={s.text}>
            <MonoLink href={githubFileUrl(fullName, branch, f.path)}>{f.path}</MonoLink>
            <div style={f.reason ? s.why : s.noReason}>{f.reason ? <InlineCode text={f.reason} /> : t("noReason")}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
