import { ERROR_COPY, REASON_ERROR_COPY, UNKNOWN_ERROR_KEY } from "./constants";

/** Coarse age of the tour. Returns a unit + count, never copy — the view formats
 *  it through `ago.<unit>` in `onboarding.json`. */
export interface TimeAgo {
  unit: "now" | "minutes" | "hours" | "days";
  count: number;
}

export function timeAgo(iso: string, now: number = Date.now()): TimeAgo {
  const diff = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(diff / 60_000);
  if (m < 1) return { unit: "now", count: 0 };
  if (m < 60) return { unit: "minutes", count: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { unit: "hours", count: h };
  return { unit: "days", count: Math.floor(h / 24) };
}

/** `https://github.com/<owner/repo>/blob/<default branch>/<path>` — each segment encoded. */
export function githubFileUrl(fullName: string, branch: string, path: string): string {
  const file = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${fullName}/blob/${encodeURIComponent(branch)}/${file}`;
}

/** The i18n key (under `onboarding`) for a generate error. Unknown codes and
 *  reasons fall back to the generic message. */
export function errorCopyKey(code: string | undefined, details?: unknown): string {
  if (!code) return UNKNOWN_ERROR_KEY;
  const reasoned = REASON_ERROR_COPY[code];
  if (reasoned) {
    const reason = (details as { reason?: unknown } | null | undefined)?.reason;
    return typeof reason === "string" && reasoned.reasons.includes(reason)
      ? `${reasoned.base}.${reason}`
      : UNKNOWN_ERROR_KEY;
  }
  return ERROR_COPY[code] ?? UNKNOWN_ERROR_KEY;
}

/** Node kinds the architecture diagram colours: a store (DB, cache, queue), an
 *  edge layer (middleware, auth, gateway), an entry point (server, API, routes)
 *  and a client or third party. The mermaid class is `tour_<kind>`. */
export type DiagramKind = "store" | "edge" | "entry" | "client";

/** First match wins, in this order: "api client" is a client, "auth middleware" an edge. */
const KIND_RULES: [DiagramKind, RegExp][] = [
  ["store", /\b(redis|postgres(ql)?|pg(vector)?|mysql|maria(db)?|mongo(db)?|sqlite|db|database|datastore|cache|s3|bucket|storage|blob|queue|kafka|rabbit(mq)?|sqs|elastic(search)?|vector)\b/i],
  ["edge", /\b(middleware|auth\w*|guard|rate[\s-]?limit\w*|interceptor|proxy|gateway|hook|plugin|cors|validator)s?\b/i],
  ["client", /\b(client|browser|user|users|ui|web|frontend|cli|external|stripe|github|openai|anthropic|openrouter|llm|third[\s-]?party|webhook)s?\b/i],
  ["entry", /\b(server|app|api|route|router|routes|handler|controller|service|endpoint|worker|main|index|indexer|entry|engine|core|pipeline|processor|job|cron)s?\b/i],
];

const KEYWORDS = new Set([
  "graph", "flowchart", "subgraph", "end", "direction", "class", "classDef", "style",
  "linkStyle", "click", "LR", "RL", "TD", "TB", "BT",
]);

/** `A[label]`, `A(label)`, `A([label])`, `A[(label)]`, `A((label))`, `A{label}`, `A>label]`. */
const DECLARED = /([A-Za-z_][\w-]*)\s*(?:\(\[|\[\(|\(\(|\[\[|\{\{|\[\/|\[\\|\[|\(|\{|>)\s*"?([^\])}"|]*)/g;
/** Bare endpoints of an arrow: `A --> B`, `A ==> B`, `A -.-> B`, `A --- B`, `A -->|x| B`. */
const ARROW = String.raw`(?:<?-{2,}>|-{3,}|<?={2,}>|<?-\.+->|~~~)`;
const LEFT = new RegExp(String.raw`(?:^|[\s;&])([A-Za-z_][\w-]*)\s*(?=${ARROW})`, "g");
const RIGHT = new RegExp(String.raw`${ARROW}\s*(?:\|[^|]*\|\s*)?([A-Za-z_][\w-]*)`, "g");

export function diagramKind(text: string): DiagramKind | undefined {
  return KIND_RULES.find(([, re]) => re.test(text))?.[0];
}

/** A node's kind from its head (id + first two label words) first, then its whole
 *  text: "ENGINE: reviewer-core … → LLM" is an engine that calls an LLM, not an LLM. */
function nodeKind(id: string, label: string): DiagramKind | undefined {
  const head = `${id} ${label.split(/\s+/).slice(0, 2).join(" ")}`;
  return diagramKind(head) ?? diagramKind(`${id} ${label}`);
}

/**
 * Tags each node of a flowchart with a `tour_<kind>` mermaid class from its id
 * and label, so the diagram can colour stores, edge layers, entry points and
 * clients apart (the design's green / amber / blue / grey borders). Only
 * `class` lines are appended; the model's text is untouched, and a diagram
 * that is not a flowchart comes back as it was.
 */
export function decorateDiagram(src: string): string {
  const lines = src.split("\n");
  if (!/^\s*(flowchart|graph)\b/.test(lines[0] ?? "")) return src;

  const labels = new Map<string, string>();
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b/.test(line)) continue;
    // an edge's inline text (`A -- text --> B`) is not a node
    const body = line.replace(/--\s[^-|>]*?\s-->/g, "-->").replace(/-\.\s[^.]*?\s\.->/g, "-.->");
    for (const m of body.matchAll(DECLARED)) {
      const [, id = "", label = ""] = m;
      if (!KEYWORDS.has(id)) labels.set(id, label);
    }
    for (const re of [LEFT, RIGHT]) {
      for (const m of body.matchAll(re)) {
        const id = m[1] ?? "";
        if (id && !KEYWORDS.has(id) && !labels.has(id)) labels.set(id, "");
      }
    }
  }

  const byKind = new Map<DiagramKind, string[]>();
  for (const [id, label] of labels) {
    const kind = nodeKind(id, label);
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  if (byKind.size === 0) return src;
  const classLines = [...byKind].map(([kind, ids]) => `  class ${ids.join(",")} tour_${kind}`);
  return [src.trimEnd(), ...classLines].join("\n");
}

const MERMAID_FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/g;

/**
 * Splits the model's architecture prose from any ```mermaid block it put there.
 * The diagram has its own field, so a fenced copy in the prose would show the
 * same chart twice, once as raw source. The first fenced chart stands in only
 * when the diagram field is empty.
 */
export function splitArchitecture(prose: string, diagram: string | null): { prose: string; diagram: string | null } {
  const fenced = [...prose.matchAll(MERMAID_FENCE)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
  if (fenced.length === 0) return { prose, diagram };
  return {
    prose: prose.replace(MERMAID_FENCE, "").replace(/\n{3,}/g, "\n\n").trim(),
    diagram: diagram ?? fenced[0] ?? null,
  };
}

/** The studio URL of the tour page (AC-14). */
export function tourUrl(origin: string, repoId: string): string {
  return `${origin}/repos/${repoId}/tour`;
}
