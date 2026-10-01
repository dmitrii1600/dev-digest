/* FirstTasks — one line per starter task; each path it names is a GitHub link. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { OnboardingTask } from "@devdigest/shared";
import { githubFileUrl } from "../../helpers";

const s = {
  list: { margin: 0, padding: "0 0 0 20px", display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  item: { whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 0 } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "none", marginLeft: 6 } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
};

export function FirstTasks({
  tasks,
  fullName,
  branch,
}: {
  tasks: OnboardingTask[];
  fullName: string;
  branch: string;
}) {
  const t = useTranslations("onboarding");
  if (tasks.length === 0) return <div style={s.muted}>{t("sectionEmpty.first_tasks")}</div>;
  return (
    <ul style={s.list}>
      {tasks.map((task, i) => (
        <li key={`${i}:${task.text}`} style={s.item}>
          {task.text}
          {task.paths.map((p) => (
            <a
              key={p}
              className="mono"
              href={githubFileUrl(fullName, branch, p)}
              target="_blank"
              rel="noopener noreferrer"
              style={s.link}
            >
              {p}
            </a>
          ))}
        </li>
      ))}
    </ul>
  );
}
