/* BlastGraph — the graph view: changed symbols on the left, the distinct
   callers that reference them in the middle, and the endpoints/crons those
   callers reach on the right, joined by cubic-bezier edges. Plain SVG, no
   charting dependency. Layout is computed in helpers.ts (pure, tested there)
   so this component stays pure rendering. Every node carries a <title> with
   the full name/path, because labels are shortened to fit. */
"use client";

import { useTranslations } from "next-intl";
import type { ChangedSymbol, DownstreamImpact } from "@devdigest/shared";
import { layoutBlastGraph, type GraphNode, type GraphNodeKind } from "./helpers";
import { s } from "./styles";

const NODE_COLOR: Record<GraphNodeKind, { stroke: string; fill: string }> = {
  symbol: { stroke: "var(--accent)", fill: "var(--text-primary)" },
  caller: { stroke: "var(--border-strong)", fill: "var(--text-secondary)" },
  endpoint: { stroke: "var(--accent)", fill: "var(--accent-text)" },
  cron: { stroke: "var(--warn)", fill: "var(--warn)" },
};

function Node({ node }: { node: GraphNode }) {
  const { stroke, fill } = NODE_COLOR[node.kind];
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
        stroke={stroke}
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

export function BlastGraph({
  changedSymbols,
  downstream,
}: {
  changedSymbols: ChangedSymbol[];
  downstream: DownstreamImpact[];
}) {
  const t = useTranslations("blast");

  if (downstream.length === 0) {
    return <div style={s.empty}>{t("graph.empty")}</div>;
  }

  const layout = layoutBlastGraph(changedSymbols, downstream);

  return (
    <div>
      <div style={s.scroller}>
        <svg
          role="img"
          aria-label={t("graph.ariaLabel")}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          style={s.svg}
        >
          {layout.edges.map((e) => <path key={e.key} d={e.d} fill="none" stroke="var(--border-strong)" />)}
          {layout.symbolNodes.map((n) => (
            <Node key={`sym-${n.id}`} node={n} />
          ))}
          {layout.callerNodes.map((n) => (
            <Node key={`caller-${n.id}`} node={n} />
          ))}
          {layout.endpointNodes.map((n) => (
            <Node key={`fact-${n.id}`} node={n} />
          ))}
        </svg>
      </div>
      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={s.legendDot("var(--accent)")} /> {t("graph.legend.symbol")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendDot("var(--border-strong)")} /> {t("graph.legend.callers")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendDot("var(--accent-text)")} /> {t("graph.legend.endpoints")}
        </span>
      </div>
    </div>
  );
}
