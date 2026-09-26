/* Pure layout for the P3-b graph view — two columns (changed symbols on the
   left, caller files on the right), one edge per caller. No DOM, no hooks;
   unit-tested directly. */
import type { DownstreamImpact } from "@devdigest/shared";

const COLUMN_MARGIN = 140;
const ROW_HEIGHT = 28;
const ROW_MARGIN = 16;
const MIN_WIDTH = 360;

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphLayout {
  symbolNodes: GraphNode[];
  fileNodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** Lays out changed symbols (left column) against the distinct caller files
    that reference them (right column), with one line per caller edge. */
export function layoutBlastGraph(downstream: DownstreamImpact[]): GraphLayout {
  const symbols = downstream.map((d) => d.symbol);
  const files = Array.from(new Set(downstream.flatMap((d) => d.callers.map((c) => c.file)))).sort();
  const rows = Math.max(symbols.length, files.length, 1);

  const width = Math.max(MIN_WIDTH, COLUMN_MARGIN * 2 + 200);
  const height = ROW_MARGIN * 2 + (rows - 1) * ROW_HEIGHT;

  const symbolIndex = new Map(symbols.map((sym, i) => [sym, i]));
  const fileIndex = new Map(files.map((file, i) => [file, i]));

  const symbolNodes: GraphNode[] = symbols.map((sym, i) => ({
    id: sym,
    label: sym,
    x: COLUMN_MARGIN,
    y: ROW_MARGIN + i * ROW_HEIGHT,
  }));
  const fileNodes: GraphNode[] = files.map((file, i) => ({
    id: file,
    label: file,
    x: width - COLUMN_MARGIN,
    y: ROW_MARGIN + i * ROW_HEIGHT,
  }));

  const edges: GraphEdge[] = [];
  for (const group of downstream) {
    const si = symbolIndex.get(group.symbol);
    if (si == null) continue;
    group.callers.forEach((caller, ci) => {
      const fi = fileIndex.get(caller.file);
      if (fi == null) return;
      edges.push({
        key: `${group.symbol}->${caller.file}:${caller.line}-${ci}`,
        x1: COLUMN_MARGIN,
        y1: ROW_MARGIN + si * ROW_HEIGHT,
        x2: width - COLUMN_MARGIN,
        y2: ROW_MARGIN + fi * ROW_HEIGHT,
      });
    });
  }

  return { symbolNodes, fileNodes, edges, width, height };
}
