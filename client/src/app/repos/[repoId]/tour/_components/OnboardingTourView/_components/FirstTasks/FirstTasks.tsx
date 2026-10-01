/* FirstTasks — starter tasks as cards: the task in bold, each file it names as a
   mono GitHub link, and the model's complexity estimate as a badge (green for
   low, amber otherwise). A task stored before labels existed has no badge. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { OnboardingComplexity, OnboardingTask } from "@devdigest/shared";
import { githubFileUrl } from "../../helpers";
import { InlineCode } from "../InlineCode/InlineCode";

const s = {
  grid: {
    listStyle: "none",
    margin: "4px 0 0",
    padding: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 10,
  } satisfies CSSProperties,
  card: {
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: "var(--text-primary)", overflowWrap: "anywhere" } satisfies CSSProperties,
  paths: { display: "flex", flexDirection: "column", gap: 3, marginTop: 7 } satisfies CSSProperties,
  link: { fontSize: 11, color: "var(--text-muted)", textDecoration: "none", overflowWrap: "anywhere" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  badge: { marginTop: 9, border: "1px solid var(--border-strong)", fontSize: 11 } satisfies CSSProperties,
};

const COMPLEXITY_COLOR: Record<OnboardingComplexity, string> = {
  low: "var(--ok)",
  medium: "var(--warn)",
  high: "var(--warn)",
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
    <ul style={s.grid}>
      {tasks.map((task, i) => (
        <li key={`${i}:${task.text}`} style={s.card}>
          <div style={s.title}>
            <InlineCode text={task.text} />
          </div>
          <div style={s.paths}>
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
          </div>
          {task.complexity && (
            <Badge color={COMPLEXITY_COLOR[task.complexity]} bg="transparent" style={s.badge}>
              {t(`complexity.${task.complexity}`)}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
