/* BlastGraph — P3-b graph view: changed symbols on the left, the distinct
   caller files that reference them on the right, one <line> per caller edge.
   Plain SVG, no charting dependency. Layout is computed in helpers.ts (pure,
   tested there) so this component stays pure rendering. Every node carries a
   <title> with the full name/path, because labels are shortened to fit. */
"use client";

import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { layoutBlastGraph, type GraphNode } from "./helpers";
import { s } from "./styles";

function Node({ node, fill, accent }: { node: GraphNode; fill: string; accent: boolean }) {
  return (
    <g>
      <title>{node.title}</title>
      <rect
        x={node.x}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={6}
        fill="var(--bg-elevated)"
        stroke={accent ? "var(--accent)" : "var(--border-strong)"}
      />
      <text
        x={node.x + 10}
        y={node.y}
        className="mono"
        fill={fill}
        fontSize={12}
        textAnchor="start"
        dominantBaseline="middle"
      >
        {node.label}
      </text>
    </g>
  );
}

export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");

  if (downstream.length === 0) {
    return <div style={s.empty}>{t("graph.empty")}</div>;
  }

  const layout = layoutBlastGraph(downstream);

  return (
    <div style={s.scroller}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        style={s.svg}
      >
        {layout.edges.map((e) => (
          <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--border-strong)" />
        ))}
        {layout.symbolNodes.map((n) => (
          <Node key={`sym-${n.id}`} node={n} fill="var(--text-primary)" accent />
        ))}
        {layout.fileNodes.map((n) => (
          <Node key={`file-${n.id}`} node={n} fill="var(--text-secondary)" accent={false} />
        ))}
      </svg>
    </div>
  );
}
