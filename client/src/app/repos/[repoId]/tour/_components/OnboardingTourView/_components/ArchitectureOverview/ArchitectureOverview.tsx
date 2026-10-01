/* ArchitectureOverview — the model's prose through the Markdown renderer (no
   raw HTML), and the diagram only when the model returned one that parses. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram";

const s = {
  diagram: { marginTop: 12 } satisfies CSSProperties,
  empty: { color: "var(--text-muted)" } satisfies CSSProperties,
};

export function ArchitectureOverview({ prose, diagram }: { prose: string; diagram: string | null }) {
  const t = useTranslations("onboarding");
  if (!prose.trim() && !diagram) return <div style={s.empty}>{t("sectionEmpty.architecture")}</div>;
  return (
    <>
      <Markdown>{prose}</Markdown>
      {diagram && (
        <div style={s.diagram}>
          <MermaidDiagram chart={diagram} />
        </div>
      )}
    </>
  );
}
