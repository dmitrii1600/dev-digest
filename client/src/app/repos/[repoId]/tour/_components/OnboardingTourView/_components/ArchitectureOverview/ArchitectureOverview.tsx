/* ArchitectureOverview — the model's prose through the Markdown renderer (no
   raw HTML), and the diagram only when the model returned one that parses.
   The diagram is restyled to the design: mono labels on surface boxes, muted
   arrows, and a border colour per node kind (store green, edge layer amber,
   entry point blue, client grey) from the classes `decorateDiagram` adds. The
   colours are theme tokens, so the diagram follows light and dark mode. */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { decorateDiagram, splitArchitecture } from "../../helpers";

const SCOPE = "dd-tour-diagram";
const SHAPES = ["rect", "polygon", "circle", "ellipse", "path"];
const shapes = (sel: string) => SHAPES.map((sh) => `.${SCOPE} ${sel} ${sh}`).join(",");

/** Mermaid writes its own theme rules under an id selector; `!important` is the only way past them. */
const DIAGRAM_CSS = `
.${SCOPE} svg { max-width: none !important; height: auto; flex-shrink: 0; }
${shapes(".node")} { fill: var(--bg-surface) !important; stroke: var(--border-strong) !important; stroke-width: 1.25px !important; }
.${SCOPE} .node rect { rx: 7px; ry: 7px; }
.${SCOPE} .node .nodeLabel, .${SCOPE} .node .label, .${SCOPE} .node text, .${SCOPE} .node span { color: var(--text-primary) !important; fill: var(--text-primary) !important; font-family: var(--font-mono) !important; font-size: 12px !important; }
.${SCOPE} .flowchart-link, .${SCOPE} .edgePath .path { stroke: var(--text-muted) !important; stroke-width: 1.25px !important; }
.${SCOPE} marker path, .${SCOPE} .arrowheadPath, .${SCOPE} .arrowMarkerPath { fill: var(--text-muted) !important; stroke: var(--text-muted) !important; }
.${SCOPE} .edgeLabel, .${SCOPE} .edgeLabel p, .${SCOPE} .edgeLabel span, .${SCOPE} .labelBkg { background-color: var(--bg-primary) !important; color: var(--text-secondary) !important; font-size: 11px !important; }
.${SCOPE} .edgeLabel rect { fill: var(--bg-primary) !important; }
.${SCOPE} .cluster rect { fill: transparent !important; stroke: var(--border) !important; stroke-dasharray: 4 3; }
.${SCOPE} .cluster .nodeLabel, .${SCOPE} .cluster-label span { color: var(--text-muted) !important; }
${shapes(".node.tour_store")} { stroke: var(--ok) !important; }
${shapes(".node.tour_edge")} { stroke: var(--warn) !important; }
${shapes(".node.tour_entry")} { stroke: var(--accent) !important; }
${shapes(".node.tour_client")} { stroke: var(--text-muted) !important; }
`;

/** Base-theme seeds: mermaid derives its palette from real colours and lays text out with this font. */
const THEME_VARIABLES = {
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  fontSize: "12px",
  primaryColor: "#141414",
  primaryTextColor: "#ededed",
  primaryBorderColor: "#3a3a3a",
  lineColor: "#6a6a6a",
};

/** Natural size (scroll when wider than the column) and wrapped labels: a chart
 *  shrunk to the column width turns 12px labels into unreadable specks. */
const FLOWCHART = { useMaxWidth: false, wrappingWidth: 170, nodeSpacing: 36, rankSpacing: 44, padding: 10 };

const s = {
  prose: { fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" } satisfies CSSProperties,
  diagram: { marginTop: 12 } satisfies CSSProperties,
  frame: { background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, justifyContent: "safe center" } satisfies CSSProperties,
  empty: { color: "var(--text-muted)" } satisfies CSSProperties,
};

export function ArchitectureOverview(props: { prose: string; diagram: string | null }) {
  const t = useTranslations("onboarding");
  const { prose, diagram } = splitArchitecture(props.prose, props.diagram);
  if (!prose.trim() && !diagram) return <div style={s.empty}>{t("sectionEmpty.architecture")}</div>;
  return (
    <>
      <div style={s.prose}>
        <Markdown>{prose}</Markdown>
      </div>
      {diagram && (
        <div style={s.diagram}>
          <style>{DIAGRAM_CSS}</style>
          <MermaidDiagram
            chart={decorateDiagram(diagram)}
            className={SCOPE}
            theme="base"
            themeVariables={THEME_VARIABLES}
            flowchart={FLOWCHART}
            stackWhenWide
            frameStyle={s.frame}
          />
        </div>
      )}
    </>
  );
}
