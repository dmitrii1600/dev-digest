/* BlastGraph — P3-b graph view: changed symbols on the left, the distinct
   caller files that reference them on the right, one <line> per caller edge.
   Plain SVG, no charting dependency. Layout is computed in helpers.ts (pure,
   tested there) so this component stays pure rendering. */
"use client";

import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { layoutBlastGraph } from "./helpers";
import { s } from "./styles";

export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");

  if (downstream.length === 0) {
    return <div style={s.empty}>{t("graph.empty")}</div>;
  }

  const layout = layoutBlastGraph(downstream);

  return (
    <svg
      role="img"
      aria-label={t("graph.ariaLabel")}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={s.svg}
    >
      {layout.edges.map((e) => (
        <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--border-strong)" />
      ))}
      {layout.symbolNodes.map((n) => (
        <text
          key={`sym-${n.id}`}
          x={n.x}
          y={n.y}
          className="mono"
          fill="var(--text-primary)"
          fontSize={12}
          textAnchor="start"
          dominantBaseline="middle"
        >
          {n.label}
        </text>
      ))}
      {layout.fileNodes.map((n) => (
        <text
          key={`file-${n.id}`}
          x={n.x}
          y={n.y}
          className="mono"
          fill="var(--text-secondary)"
          fontSize={12}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {n.label}
        </text>
      ))}
    </svg>
  );
}
