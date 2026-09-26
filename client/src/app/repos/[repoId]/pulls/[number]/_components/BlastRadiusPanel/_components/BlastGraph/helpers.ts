/* Pure layout for the P3-b graph view — two columns (changed symbols on the
   left, caller files on the right), one edge per caller. No DOM, no hooks;
   unit-tested directly.

   Column widths follow the longest label in each column (capped), file labels
   are shortened to their last two path segments (the full path travels as a
   tooltip), so 20+ symbols and deep Next.js paths stay legible instead of
   overlapping in a fixed-width box. */
import type { DownstreamImpact } from "@devdigest/shared";

/** Approximate advance of one glyph at the 12px monospace the SVG uses. */
const CHAR_WIDTH = 7.2;
const NODE_PAD_X = 10;
const NODE_HEIGHT = 22;
const ROW_HEIGHT = 30;
const ROW_MARGIN = 12;
const COLUMN_GAP = 120;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 320;
const MAX_LABEL_CHARS = 40;

export interface GraphNode {
  id: string;
  /** What is drawn inside the node — possibly shortened. */
  label: string;
  /** The untruncated name/path, for the tooltip. */
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

/** `a/b/c/d.ts` → `…/c/d.ts`; anything already ≤ 2 segments is unchanged. */
export function shortenPath(file: string): string {
  const parts = file.split("/");
  const short = parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : file;
  return truncate(short, MAX_LABEL_CHARS);
}

/** Cuts the head of an over-long label, keeping the tail (file names are
    distinguishing at the end, not the start). */
export function truncate(label: string, max: number): string {
  return label.length > max ? `…${label.slice(label.length - max + 1)}` : label;
}

function columnWidth(labels: string[]): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest * CHAR_WIDTH + NODE_PAD_X * 2));
}

function rowY(i: number): number {
  return ROW_MARGIN + NODE_HEIGHT / 2 + i * ROW_HEIGHT;
}

/** Lays out changed symbols (left column) against the distinct caller files
    that reference them (right column), with one line per caller edge. */
export function layoutBlastGraph(downstream: DownstreamImpact[]): GraphLayout {
  const symbols = downstream.map((d) => d.symbol);
  const files = Array.from(new Set(downstream.flatMap((d) => d.callers.map((c) => c.file)))).sort();
  const rows = Math.max(symbols.length, files.length, 1);

  const symbolLabels = symbols.map((s) => truncate(s, MAX_LABEL_CHARS));
  const fileLabels = files.map(shortenPath);
  const leftWidth = columnWidth(symbolLabels);
  const rightWidth = columnWidth(fileLabels);
  const rightX = leftWidth + COLUMN_GAP;

  const width = rightX + rightWidth;
  const height = ROW_MARGIN * 2 + NODE_HEIGHT + (rows - 1) * ROW_HEIGHT;

  const symbolNodes: GraphNode[] = symbols.map((sym, i) => ({
    id: sym,
    label: symbolLabels[i]!,
    title: sym,
    x: 0,
    y: rowY(i),
    width: leftWidth,
    height: NODE_HEIGHT,
  }));
  const fileNodes: GraphNode[] = files.map((file, i) => ({
    id: file,
    label: fileLabels[i]!,
    title: file,
    x: rightX,
    y: rowY(i),
    width: rightWidth,
    height: NODE_HEIGHT,
  }));

  const symbolIndex = new Map(symbols.map((sym, i) => [sym, i]));
  const fileIndex = new Map(files.map((file, i) => [file, i]));
  const edges: GraphEdge[] = [];
  for (const group of downstream) {
    const si = symbolIndex.get(group.symbol);
    if (si == null) continue;
    group.callers.forEach((caller, ci) => {
      const fi = fileIndex.get(caller.file);
      if (fi == null) return;
      edges.push({
        key: `${group.symbol}->${caller.file}:${caller.line}-${ci}`,
        x1: leftWidth,
        y1: rowY(si),
        x2: rightX,
        y2: rowY(fi),
      });
    });
  }

  return { symbolNodes, fileNodes, edges, width, height };
}
