import type { BlastRadius, DownstreamImpact, FindingRecord, ReviewRecord, RunSummary } from '@devdigest/shared';
import { clip } from './errors.js';

export { clip };

/** Findings shown per review at once, before the global cap kicks in. */
export const MAX_FINDINGS_CONCISE = 50;
export const MAX_FINDINGS_DETAILED = 20;
/** Convention candidates shown at once (`get_conventions`). */
export const MAX_LIST = 50;
/** Changed symbols / downstream groups shown at once (`get_blast_radius`). Per-symbol
 *  caller counts are NOT re-capped here — the server already applied `MAX_CALLERS_PER_SYMBOL`. */
export const MAX_BLAST_SYMBOLS = 50;
export const MAX_BLAST_DOWNSTREAM = 30;
/**
 * ~10k tokens, far below Claude Code's 25k `MAX_MCP_OUTPUT_TOKENS` — a hard
 * ceiling on any single tool result, findings included.
 */
export const MAX_OUTPUT_CHARS = 40_000;

export type ResponseFormat = 'concise' | 'detailed';

export interface TruncationInfo {
  shown: number;
  total: number;
  hint: string;
}

export interface SeverityCountsShape {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
}

const SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

interface SortableFinding {
  severity: string;
  confidence: number;
  file: string;
  start_line: number;
}

/**
 * Severity first (CRITICAL > WARNING > SUGGESTION), then confidence
 * descending, then file, then start_line — a stable, deterministic order so
 * "the top N" always means the same N findings for the same input.
 */
export function sortFindings<T extends SortableFinding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const sev = (SEVERITY_WEIGHT[a.severity] ?? 99) - (SEVERITY_WEIGHT[b.severity] ?? 99);
    if (sev !== 0) return sev;
    const conf = b.confidence - a.confidence;
    if (conf !== 0) return conf;
    const file = a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
    if (file !== 0) return file;
    return a.start_line - b.start_line;
  });
}

function countSeverities(findings: { severity: string }[]): SeverityCountsShape {
  const counts: SeverityCountsShape = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.CRITICAL++;
    else if (f.severity === 'WARNING') counts.WARNING++;
    else if (f.severity === 'SUGGESTION') counts.SUGGESTION++;
  }
  return counts;
}

/** Shallow-drops null/undefined keys — the concise shape's "omit what isn't there" rule. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function shapeFinding(f: FindingRecord, format: ResponseFormat): Record<string, unknown> {
  if (format === 'concise') {
    return compact({
      severity: f.severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      suggestion: f.suggestion ? clip(f.suggestion, 200) : undefined,
    });
  }
  const detailed: Record<string, unknown> = {
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    id: f.id,
    rationale: clip(f.rationale, 2_000),
    suggestion: f.suggestion ? clip(f.suggestion, 1_000) : null,
    confidence: f.confidence,
    kind: f.kind ?? null,
    accepted_at: f.accepted_at,
    dismissed_at: f.dismissed_at,
    review_id: f.review_id,
  };
  // Trifecta fields only when this is a lethal_trifecta finding — never
  // present as empty/null noise on an ordinary finding.
  if (f.trifecta_components) detailed.trifecta_components = f.trifecta_components;
  if (f.evidence) detailed.evidence = f.evidence;
  return detailed;
}

interface FlatFinding {
  reviewIndex: number;
  shaped: Record<string, unknown>;
  sortKey: SortableFinding;
}

/** Caps findings GLOBALLY across every review (not per-review), keeping the
 *  most severe N overall, then regroups them back onto their review. */
function capAcrossReviews(
  flat: FlatFinding[],
  limit: number,
): { kept: FlatFinding[]; total: number } {
  const total = flat.length;
  const sorted = sortFindings(flat.map((f) => ({ ...f, ...f.sortKey })) as (FlatFinding & SortableFinding)[]);
  return { kept: sorted.slice(0, limit), total };
}

function groupByReview(reviewCount: number, flat: FlatFinding[]): Record<string, unknown>[][] {
  const groups: Record<string, unknown>[][] = Array.from({ length: reviewCount }, () => []);
  for (const f of flat) groups[f.reviewIndex]!.push(f.shaped);
  return groups;
}

export interface ShapeReviewsResult {
  reviews: Record<string, unknown>[];
  truncated?: TruncationInfo;
}

/**
 * Shapes persisted reviews (+ their runs, for `run_status`/`cost_usd`) into
 * the `AgentReview[]` the tools return — one entry per review (= per agent),
 * with a single cap applied across ALL of them combined.
 */
export function shapeReviews(
  reviews: ReviewRecord[],
  runs: RunSummary[],
  format: ResponseFormat,
): ShapeReviewsResult {
  const runById = new Map(runs.map((r) => [r.run_id, r]));
  const maxFindings = format === 'detailed' ? MAX_FINDINGS_DETAILED : MAX_FINDINGS_CONCISE;

  const flat: FlatFinding[] = [];
  reviews.forEach((review, reviewIndex) => {
    for (const finding of review.findings) {
      flat.push({
        reviewIndex,
        shaped: shapeFinding(finding, format),
        sortKey: {
          severity: finding.severity,
          confidence: finding.confidence,
          file: finding.file,
          start_line: finding.start_line,
        },
      });
    }
  });

  const { kept, total } = capAcrossReviews(flat, maxFindings);
  const grouped = groupByReview(reviews.length, kept);

  const shapedReviews = reviews.map((review, reviewIndex) => {
    const run = review.run_id ? runById.get(review.run_id) : undefined;
    const base: Record<string, unknown> = {
      agent_name: review.agent_name ?? null,
      run_id: review.run_id,
      run_status: run?.status ?? null,
      verdict: review.verdict,
      score: review.score,
      counts: countSeverities(review.findings),
      findings: grouped[reviewIndex] ?? [],
    };
    if (format === 'detailed') {
      return {
        ...base,
        summary: review.summary ? clip(review.summary, 1_000) : review.summary,
        model: review.model,
        created_at: review.created_at,
        pr_id: review.pr_id,
        // Unknown cost is null, never 0 — never coerce a missing run cost.
        cost_usd: run?.cost_usd ?? null,
      };
    }
    return compact(base);
  });

  const result: ShapeReviewsResult = { reviews: shapedReviews };
  if (kept.length < total) {
    result.truncated = {
      shown: kept.length,
      total,
      hint: 'Showing the most severe findings. Narrow with agent or run_id.',
    };
  }
  return result;
}

/** Every finding across every review, tagged with which review it came from — used to re-cap after the char guard. */
function flattenShapedReviews(reviews: Record<string, unknown>[]): FlatFinding[] {
  const flat: FlatFinding[] = [];
  reviews.forEach((review, reviewIndex) => {
    const findings = Array.isArray(review.findings) ? (review.findings as Record<string, unknown>[]) : [];
    for (const shaped of findings) {
      flat.push({
        reviewIndex,
        shaped,
        sortKey: {
          severity: String(shaped.severity ?? ''),
          confidence: typeof shaped.confidence === 'number' ? shaped.confidence : 0,
          file: String(shaped.file ?? ''),
          start_line: typeof shaped.start_line === 'number' ? shaped.start_line : 0,
        },
      });
    }
  });
  return flat;
}

/** Index signature required to structurally satisfy the SDK's `CallToolResult`. */
export interface ToolTextResult {
  [key: string]: unknown;
  content: [{ type: 'text'; text: string }];
}

/**
 * Compact `JSON.stringify`s a tool payload. If the result exceeds
 * {@link MAX_OUTPUT_CHARS}, halves the shown findings (re-capped globally,
 * most severe first) until it fits, updating/creating `truncated` each pass.
 * A payload with no `reviews` array (nothing safe to trim) is returned as-is.
 */
export function toTextResult(payload: Record<string, unknown>): ToolTextResult {
  const working: Record<string, unknown> = { ...payload };
  let text = JSON.stringify(working);
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { content: [{ type: 'text', text }] };
  }
  if (!Array.isArray(working.reviews)) {
    return { content: [{ type: 'text', text }] };
  }

  const reviews = working.reviews as Record<string, unknown>[];
  const existing = working.truncated as TruncationInfo | undefined;
  let flat = flattenShapedReviews(reviews);
  const total = existing?.total ?? flat.length;
  let limit = flat.length;

  while (text.length > MAX_OUTPUT_CHARS && limit > 1) {
    limit = Math.floor(limit / 2);
    const { kept } = capAcrossReviews(flat, limit);
    const grouped = groupByReview(reviews.length, kept);
    working.reviews = reviews.map((review, i) => ({ ...review, findings: grouped[i] ?? [] }));
    working.truncated = {
      shown: kept.length,
      total,
      hint: `Showing the ${kept.length} most severe findings. Narrow with agent or run_id.`,
    } satisfies TruncationInfo;
    text = JSON.stringify(working);
    flat = kept;
  }

  return { content: [{ type: 'text', text }] };
}

export interface BlastTruncationInfo {
  symbols_shown: number;
  symbols_total: number;
  downstream_shown: number;
  downstream_total: number;
  hint: string;
}

const BLAST_TRUNCATED_HINT =
  "Showing the highest-ranked symbols first. Open the PR's Overview tab in the DevDigest studio for the full map.";

function shapeDownstream(d: DownstreamImpact): Record<string, unknown> {
  const out: Record<string, unknown> = {
    symbol: d.symbol,
    callers: d.callers.map((c) => `${c.file}:${c.line} ${c.name}`),
  };
  if (d.endpoints_affected.length > 0) out.endpoints = d.endpoints_affected;
  if (d.crons_affected.length > 0) out.crons = d.crons_affected;
  return out;
}

/**
 * Shapes a `BlastRadius` (from `GET /pulls/:id/blast-radius`) into the
 * concise map `get_blast_radius` returns: symbols and callers as compact
 * strings, caps on both arrays, and a degraded `hint` whose only
 * interpolated value is the `reason` enum. Degraded/empty is a normal
 * result, never an error.
 */
export function shapeBlastRadius(
  blast: BlastRadius,
  opts: { label: string; headSha: string },
): Record<string, unknown> {
  const symbolsTotal = blast.changed_symbols.length;
  const downstreamTotal = blast.downstream.length;

  const shownSymbols = blast.changed_symbols.slice(0, MAX_BLAST_SYMBOLS);
  let shownDownstream = blast.downstream.slice(0, MAX_BLAST_DOWNSTREAM);

  const payload: Record<string, unknown> = {
    pr: opts.label,
    head_sha: opts.headSha,
    summary: blast.summary,
  };

  if (blast.degraded) {
    payload.degraded = true;
    if (blast.reason) {
      payload.reason = blast.reason;
      payload.hint = `Index ${blast.reason}: callers may be missing. Re-index the repo from the DevDigest studio.`;
    }
  }

  payload.changed_symbols = shownSymbols.map((s) => `${s.name} (${s.kind}) ${s.file}`);
  payload.downstream = shownDownstream.map(shapeDownstream);

  if (shownSymbols.length < symbolsTotal || shownDownstream.length < downstreamTotal) {
    payload.truncated = {
      symbols_shown: shownSymbols.length,
      symbols_total: symbolsTotal,
      downstream_shown: shownDownstream.length,
      downstream_total: downstreamTotal,
      hint: BLAST_TRUNCATED_HINT,
    } satisfies BlastTruncationInfo;
  }

  // Char guard: this payload never carries a `reviews` array, so
  // `toTextResult`'s own guard passes it through untouched — halve the
  // shown downstream groups here instead until it fits.
  let text = JSON.stringify(payload);
  while (text.length > MAX_OUTPUT_CHARS && shownDownstream.length > 1) {
    shownDownstream = shownDownstream.slice(0, Math.floor(shownDownstream.length / 2));
    payload.downstream = shownDownstream.map(shapeDownstream);
    payload.truncated = {
      symbols_shown: shownSymbols.length,
      symbols_total: symbolsTotal,
      downstream_shown: shownDownstream.length,
      downstream_total: downstreamTotal,
      hint: BLAST_TRUNCATED_HINT,
    } satisfies BlastTruncationInfo;
    text = JSON.stringify(payload);
  }

  return payload;
}
