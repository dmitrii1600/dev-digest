/* Pure layout for the graph view — three columns: changed symbols (left),
   the distinct callers that reference them (middle, one node per caller
   function), and the endpoints/crons those callers reach (right). Edges are
   cubic-bezier SVG paths so several edges landing on the same node stay
   legible. No DOM, no hooks; unit-tested directly.

   Column widths follow the longest label in each column (capped); every
   node carries the untruncated name/path as its `title` tooltip, so labels
   can be shortened to fit without losing information. */
import type { ChangedSymbol, DownstreamImpact } from "@devdigest/shared";

/** Approximate advance of one glyph at the 12px monospace the SVG uses. */
const CHAR_WIDTH = 7.2;
const NODE_PAD_X = 10;
const NODE_HEIGHT = 22;
const ROW_HEIGHT = 34;
const ROW_MARGIN = 12;
const COLUMN_GAP = 90;
const MIN_COLUMN_WIDTH = 110;
const MAX_COLUMN_WIDTH = 260;
const MAX_LABEL_CHARS = 28;

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  /** What is drawn inside the node — possibly shortened. */
  label: string;
  /** The untruncated name/path (plus line, for callers), for the tooltip. */
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: GraphNodeKind;
}

export interface GraphEdge {
  key: string;
  /** Cubic-bezier path: `M x1 y1 C cx1 y1, cx2 y2, x2 y2`. */
  d: string;
}

export interface GraphLayout {
  symbolNodes: GraphNode[];
  callerNodes: GraphNode[];
  endpointNodes: GraphNode[];
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

/** Cuts the head of an over-long label, keeping the tail (file names and
    routes are distinguishing at the end, not the start). */
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

/** A smooth "S" curve between two columns: control points sit at the
    midpoint x, each level with its own endpoint's y. */
function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

/** Symbol kinds that read naturally with a trailing `()`. */
function isCallable(kind: string | undefined): boolean {
  return kind === "function" || kind === "method";
}

type Fact = { value: string; kind: "endpoint" | "cron" };

/** The facts (endpoints/crons) attributed to one caller: its own per-caller
    facts when it or any sibling caller in the group has them, otherwise the
    group-level `endpoints_affected`/`crons_affected` as a stand-in — the
    group's downstream facts came from *some* caller in it, we just cannot
    tell which. */
function factsFor(group: DownstreamImpact, caller: DownstreamImpact["callers"][number], groupHasCallerFacts: boolean): Fact[] {
  if (groupHasCallerFacts) {
    return [
      ...(caller.endpoints ?? []).map((value): Fact => ({ value, kind: "endpoint" })),
      ...(caller.crons ?? []).map((value): Fact => ({ value, kind: "cron" })),
    ];
  }
  return [
    ...group.endpoints_affected.map((value): Fact => ({ value, kind: "endpoint" })),
    ...group.crons_affected.map((value): Fact => ({ value, kind: "cron" })),
  ];
}

/** Lays out changed symbols (left) against their distinct callers (middle)
    against the endpoints/crons those callers reach (right), with one bezier
    edge per caller and one per attributed endpoint/cron fact. */
export function layoutBlastGraph(changedSymbols: ChangedSymbol[], downstream: DownstreamImpact[]): GraphLayout {
  const kindBySymbol = new Map(changedSymbols.map((sym) => [sym.name, sym.kind]));

  // --- Symbol column (left): one per downstream group, in downstream order.
  const symbolIds = downstream.map((d) => d.symbol);
  const symbolLabels = symbolIds.map((sym) =>
    truncate(isCallable(kindBySymbol.get(sym)) ? `${sym}()` : sym, MAX_LABEL_CHARS),
  );

  // --- Caller column (middle): dedupe by name+file, first-seen order.
  const callerOrder: string[] = [];
  const callerMeta = new Map<string, { name: string; file: string; line: number }>();
  for (const group of downstream) {
    for (const caller of group.callers) {
      const id = `${caller.name}::${caller.file}`;
      if (!callerMeta.has(id)) {
        callerOrder.push(id);
        callerMeta.set(id, caller);
      }
    }
  }
  const callerLabels = callerOrder.map((id) => truncate(callerMeta.get(id)!.name, MAX_LABEL_CHARS));

  // --- Endpoint/cron column (right): dedupe by kind+value, first-seen order.
  const endpointOrder: string[] = [];
  const endpointMeta = new Map<string, Fact>();
  const groupHasCallerFacts = new Map<string, boolean>();
  for (const group of downstream) {
    const hasFacts = group.callers.some((c) => (c.endpoints?.length ?? 0) > 0 || (c.crons?.length ?? 0) > 0);
    groupHasCallerFacts.set(group.symbol, hasFacts);
    for (const caller of group.callers) {
      for (const fact of factsFor(group, caller, hasFacts)) {
        const id = `${fact.kind}:${fact.value}`;
        if (!endpointMeta.has(id)) {
          endpointOrder.push(id);
          endpointMeta.set(id, fact);
        }
      }
    }
  }
  const endpointLabels = endpointOrder.map((id) => truncate(endpointMeta.get(id)!.value, MAX_LABEL_CHARS));

  const rows = Math.max(symbolIds.length, callerOrder.length, endpointOrder.length, 1);

  const leftWidth = columnWidth(symbolLabels);
  const midWidth = columnWidth(callerLabels);
  const rightWidth = columnWidth(endpointLabels);
  const midX = leftWidth + COLUMN_GAP;
  const rightX = midX + midWidth + COLUMN_GAP;

  const width = rightX + rightWidth;
  const height = ROW_MARGIN * 2 + NODE_HEIGHT + (rows - 1) * ROW_HEIGHT;

  const symbolNodes: GraphNode[] = symbolIds.map((sym, i) => ({
    id: sym,
    label: symbolLabels[i]!,
    title: sym,
    x: 0,
    y: rowY(i),
    width: leftWidth,
    height: NODE_HEIGHT,
    kind: "symbol",
  }));

  const callerNodes: GraphNode[] = callerOrder.map((id, i) => {
    const meta = callerMeta.get(id)!;
    return {
      id,
      label: callerLabels[i]!,
      title: `${meta.file}:${meta.line}`,
      x: midX,
      y: rowY(i),
      width: midWidth,
      height: NODE_HEIGHT,
      kind: "caller",
    };
  });

  const endpointNodes: GraphNode[] = endpointOrder.map((id, i) => {
    const meta = endpointMeta.get(id)!;
    return {
      id,
      label: endpointLabels[i]!,
      title: meta.value,
      x: rightX,
      y: rowY(i),
      width: rightWidth,
      height: NODE_HEIGHT,
      kind: meta.kind,
    };
  });

  const symbolIndex = new Map(symbolNodes.map((n, i) => [n.id, i]));
  const callerIndex = new Map(callerNodes.map((n, i) => [n.id, i]));
  const endpointIndex = new Map(endpointNodes.map((n, i) => [n.id, i]));

  // Edges are one per (node, node) pair, keyed by the two node indexes, so
  // the key is unique by construction. Without the dedupe a caller that
  // references a symbol from two lines, or reaches the same endpoint through
  // two symbol groups, produced identical overlapping curves with identical
  // React keys ("two children with the same key").
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const addEdge = (key: string, d: string) => {
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ key, d });
  };

  // Symbol -> caller: a caller shared by two symbols draws two edges into the
  // same caller node (one per symbol).
  for (const group of downstream) {
    const si = symbolIndex.get(group.symbol);
    if (si == null) continue;
    for (const caller of group.callers) {
      const callerIdx = callerIndex.get(`${caller.name}::${caller.file}`);
      if (callerIdx == null) continue;
      addEdge(`sym-${si}-${callerIdx}`, bezier(leftWidth, rowY(si), midX, rowY(callerIdx)));
    }
  }

  // Caller -> endpoint/cron: the same per-group fallback as the node list.
  for (const group of downstream) {
    const hasFacts = groupHasCallerFacts.get(group.symbol) ?? false;
    for (const caller of group.callers) {
      const callerIdx = callerIndex.get(`${caller.name}::${caller.file}`);
      if (callerIdx == null) continue;
      for (const fact of factsFor(group, caller, hasFacts)) {
        const endpointIdx = endpointIndex.get(`${fact.kind}:${fact.value}`);
        if (endpointIdx == null) continue;
        addEdge(
          `fact-${callerIdx}-${endpointIdx}`,
          bezier(midX + midWidth, rowY(callerIdx), rightX, rowY(endpointIdx)),
        );
      }
    }
  }

  return { symbolNodes, callerNodes, endpointNodes, edges, width, height };
}
