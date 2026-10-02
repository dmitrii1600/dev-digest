import { wrapProjectDoc, wrapUntrusted } from '@devdigest/reviewer-core';
import type {
  BlastRadius,
  BriefDraft,
  BriefMissingFact,
  BriefReviewFocusItem,
  ChatMessage,
  SmartDiff,
  StoredRisk,
} from '@devdigest/shared';
import {
  MAX_EXPLANATION_CHARS,
  MAX_FOCUS,
  MAX_REASON_CHARS,
  MAX_RISKS,
  MAX_SUMMARY_CHARS,
  MAX_TITLE_CHARS,
  SYSTEM_PROMPT,
} from './constants.js';

/**
 * Pure helpers for the PR brief: the prompt, the token budget, the grounding
 * gate and the missing-facts bookkeeping. Nothing here touches the database,
 * the filesystem or the container, so all of it is covered by the hermetic
 * `brief-helpers.test.ts`.
 */

const ELLIPSIS = '…';
const MINUS = '−';

// ---- Input shapes ------------------------------------------------------------

export interface BriefFileStat {
  path: string;
  role: string;
  additions: number;
  deletions: number;
}

export interface BriefCaller {
  file: string;
  line: number;
  name: string;
  endpoints: string[];
  crons: string[];
}

/** Everything the model is shown. There is deliberately no field for a patch. */
export interface BriefPromptInput {
  title: string;
  body: string | null;
  issue: { number: number; title: string; body: string } | null;
  intent: { intent: string; in_scope: string[]; out_of_scope: string[] } | null;
  blast: { summary: string; symbols: { name: string; kind: string; file: string }[] } | null;
  callers: BriefCaller[];
  files: BriefFileStat[];
  /** Set by `fitToBudget` when the lowest-churn files were folded into one line. */
  fold?: { count: number; additions: number; deletions: number };
  docs: { path: string; content: string }[];
}

// ---- Small parsers -------------------------------------------------------------

/**
 * The first `#<n>` (n >= 1) in the PR description that is not part of a
 * `owner/repo#n` cross-repo reference or a `&#n;` HTML entity.
 */
export function firstIssueRef(body: string | null): number | null {
  if (!body) return null;
  for (const m of body.matchAll(/(?<![\w/&])#(\d+)/g)) {
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n >= 1) return n;
  }
  return null;
}

/** Strip one leading `./` and one trailing `:<line>` / `:<start>-<end>`. No case folding, no slash rewriting. */
export function normalizeRefPath(ref: string): string {
  const noDot = ref.startsWith('./') ? ref.slice(2) : ref;
  return noDot.replace(/:\d+(?:-\d+)?$/, '');
}

/**
 * Cap `s` at `cap` UTF-16 units (the measure Zod's `.max()` uses). A cut string
 * is `cap - 1` units plus an ellipsis, and never ends in half a surrogate pair.
 */
export function cut(s: string, cap: number): string {
  if (s.length <= cap) return s;
  let head = s.slice(0, cap - 1);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + ELLIPSIS;
}

/** `prefix` of `s` that does not end in half a surrogate pair. */
function safePrefix(s: string, length: number): string {
  let head = s.slice(0, length);
  const last = head.charCodeAt(head.length - 1);
  if (head.length > 0 && last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head;
}

// ---- Facts -> prompt input -----------------------------------------------------

export function flattenSmartDiff(sd: SmartDiff): BriefFileStat[] {
  return sd.groups.flatMap((g) =>
    g.files.map((f) => ({
      path: f.path,
      role: g.role,
      additions: f.additions,
      deletions: f.deletions,
    })),
  );
}

/** The blast summary + changed symbols, and the caller list (one line per distinct caller). */
export function blastPromptInput(blast: BlastRadius | null): {
  blast: BriefPromptInput['blast'];
  callers: BriefCaller[];
} {
  if (!blast) return { blast: null, callers: [] };
  const seen = new Set<string>();
  const callers: BriefCaller[] = [];
  for (const d of blast.downstream) {
    for (const c of d.callers) {
      const key = `${c.file}:${c.line}:${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      callers.push({
        file: c.file,
        line: c.line,
        name: c.name,
        endpoints: c.endpoints ?? [],
        crons: c.crons ?? [],
      });
    }
  }
  return {
    blast: {
      summary: blast.summary,
      symbols: blast.changed_symbols.map((s) => ({ name: s.name, kind: s.kind, file: s.file })),
    },
    callers,
  };
}

/** The file paths a model reference may point at: changed files, plus (when known) blast-map files. */
export function allowedPaths(
  changedFiles: ReadonlyArray<{ path: string }>,
  blast: BlastRadius | null,
): Set<string> {
  const out = new Set<string>(changedFiles.map((f) => f.path));
  if (blast) {
    for (const s of blast.changed_symbols) out.add(s.file);
    for (const d of blast.downstream) for (const c of d.callers) out.add(c.file);
  }
  return out;
}

export function isStale(record: { head_sha: string }, prHeadSha: string): boolean {
  return record.head_sha !== prHeadSha;
}

// ---- Prompt ------------------------------------------------------------------------

function foldLine(f: NonNullable<BriefPromptInput['fold']>): string {
  return `${f.count} more files, +${f.additions} ${MINUS}${f.deletions}`;
}

/**
 * The user message. Every section built from repository or author text goes
 * through `wrapUntrusted`; documents go through `wrapProjectDoc`. Headings are
 * static trusted text.
 */
export function buildPrompt(input: BriefPromptInput): { messages: ChatMessage[] } {
  const sections: string[] = [];

  sections.push('## Pull request title\n' + wrapUntrusted('pr_title', input.title));
  if (input.body && input.body.trim() !== '') {
    sections.push('## Pull request description\n' + wrapUntrusted('pr_description', input.body));
  }
  if (input.issue) {
    const text = `#${input.issue.number} ${input.issue.title}` + (input.issue.body ? `\n\n${input.issue.body}` : '');
    sections.push('## Linked issue\n' + wrapUntrusted('linked_issue', text));
  }
  if (input.intent) {
    const lines = [`Intent: ${input.intent.intent}`];
    if (input.intent.in_scope.length > 0) {
      lines.push('In scope:', ...input.intent.in_scope.map((s) => `- ${s}`));
    }
    if (input.intent.out_of_scope.length > 0) {
      lines.push('Out of scope:', ...input.intent.out_of_scope.map((s) => `- ${s}`));
    }
    sections.push('## Intent\n' + wrapUntrusted('intent', lines.join('\n')));
  }
  if (input.blast) {
    const lines = [`Summary: ${input.blast.summary}`];
    if (input.blast.symbols.length > 0) {
      lines.push('Changed symbols:', ...input.blast.symbols.map((s) => `- ${s.name} ${s.kind} ${s.file}`));
    }
    sections.push('## Blast radius\n' + wrapUntrusted('blast_summary', lines.join('\n')));
  }
  if (input.callers.length > 0) {
    const lines = input.callers.map((c) => {
      const facts = [
        c.endpoints.length > 0 ? `endpoints: ${c.endpoints.join(', ')}` : '',
        c.crons.length > 0 ? `crons: ${c.crons.join(', ')}` : '',
      ].filter(Boolean);
      return `${c.file}:${c.line} ${c.name}` + (facts.length > 0 ? ` (${facts.join('; ')})` : '');
    });
    sections.push('## Callers of the changed symbols\n' + wrapUntrusted('callers', lines.join('\n')));
  }
  {
    const lines = input.files.map((f) => `${f.role} ${f.path} +${f.additions} ${MINUS}${f.deletions}`);
    if (input.fold) lines.push(foldLine(input.fold));
    sections.push('## Changed files\n' + wrapUntrusted('changed_files', lines.join('\n')));
  }
  if (input.docs.length > 0) {
    sections.push('## Project context\n' + input.docs.map((d) => wrapProjectDoc(d.path, d.content)).join('\n\n'));
  }

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: sections.join('\n\n') },
    ],
  };
}

/** Tokens across every message (NFR-2). */
export function countInput(messages: ChatMessage[], count: (text: string) => number): number {
  return messages.reduce((sum, m) => sum + count(m.content), 0);
}

// ---- Budget ----------------------------------------------------------------------------

/**
 * Trim the input to `max` tokens, one step at a time, stopping as soon as it
 * fits (EC-9): documents (from the end) -> description -> issue body -> caller
 * list -> file statistics (lowest churn first). Intent and the blast summary are
 * never trimmed. Returns `overBudget` when nothing more can go.
 */
export function fitToBudget(
  input: BriefPromptInput,
  count: (text: string) => number,
  max: number,
): { input: BriefPromptInput; missing: BriefMissingFact[] } | { overBudget: true } {
  const fits = (i: BriefPromptInput) => countInput(buildPrompt(i).messages, count) <= max;
  const missing: BriefMissingFact[] = [];
  let cur: BriefPromptInput = input;
  if (fits(cur)) return { input: cur, missing };

  // 1. documents, from the end
  while (cur.docs.length > 0 && !fits(cur)) {
    const dropped = cur.docs[cur.docs.length - 1]!;
    cur = { ...cur, docs: cur.docs.slice(0, -1) };
    missing.push({ fact: 'project_context', status: 'dropped', detail: dropped.path });
  }

  // 2. the description: the longest prefix that fits
  if (!fits(cur) && cur.body && cur.body.length > 0) {
    const body = cur.body;
    const k = longestFit(body.length - 1, (n) => fits({ ...cur, body: safePrefix(body, n) }));
    cur = { ...cur, body: safePrefix(body, k) };
    missing.push({ fact: 'description', status: 'truncated', detail: null });
  }

  // 3. the issue body (the title stays)
  if (!fits(cur) && cur.issue && cur.issue.body.length > 0) {
    const issue = cur.issue;
    const k = longestFit(issue.body.length - 1, (n) =>
      fits({ ...cur, issue: { ...issue, body: safePrefix(issue.body, n) } }),
    );
    cur = { ...cur, issue: { ...issue, body: safePrefix(issue.body, k) } };
    missing.push({ fact: 'linked_issue', status: 'cut', detail: String(issue.number) });
  }

  // 4. the caller list
  if (!fits(cur) && cur.callers.length > 0) {
    cur = { ...cur, callers: [] };
    missing.push({ fact: 'callers', status: 'dropped', detail: null });
  }

  // 5. file statistics, lowest churn first, folded into one line
  if (!fits(cur) && cur.files.length > 0) {
    const order = cur.files
      .map((f, i) => ({ f, i, churn: f.additions + f.deletions }))
      .sort((a, b) => a.churn - b.churn || (a.f.path < b.f.path ? -1 : a.f.path > b.f.path ? 1 : 0));
    const folded = new Set<number>();
    let additions = 0;
    let deletions = 0;
    for (const o of order) {
      folded.add(o.i);
      additions += o.f.additions;
      deletions += o.f.deletions;
      cur = {
        ...cur,
        files: input.files.filter((_, i) => !folded.has(i)),
        fold: { count: folded.size, additions, deletions },
      };
      if (fits(cur)) break;
    }
    missing.push({ fact: 'file_stats', status: 'folded', detail: String(folded.size) });
  }

  if (!fits(cur)) return { overBudget: true };
  return { input: cur, missing };
}

/** Largest n in [0, hi] for which `ok(n)` holds, assuming monotonic; 0 when none does. */
function longestFit(hi: number, ok: (n: number) => boolean): number {
  let lo = 0;
  let top = Math.max(0, hi);
  while (lo < top) {
    const mid = Math.ceil((lo + top) / 2);
    if (ok(mid)) lo = mid;
    else top = mid - 1;
  }
  return lo;
}

// ---- Grounding -----------------------------------------------------------------------------

export interface GroundedBrief {
  summary: string;
  risks: StoredRisk[];
  review_focus: BriefReviewFocusItem[];
  /** Items the grounding gate removed (before the caps); the caps do not count here. */
  removed: { risks: number; refs: number; focus: number };
}

/**
 * Keep only what points at a real file, then cap (filter first, so a
 * hallucinated item never costs a slot). A risk ref survives iff its
 * normalised path is allowed; a risk left with no refs is removed; a focus item
 * survives iff its normalised file is allowed and its line is an integer >= 1,
 * and is stored with a bare path.
 */
export function groundAndCap(draft: BriefDraft, allowed: ReadonlySet<string>): GroundedBrief {
  const removed = { risks: 0, refs: 0, focus: 0 };

  const risks: StoredRisk[] = [];
  for (const r of draft.risks) {
    const kept = r.file_refs.filter((ref) => allowed.has(normalizeRefPath(ref)));
    removed.refs += r.file_refs.length - kept.length;
    if (kept.length === 0) {
      removed.risks += 1;
      continue;
    }
    risks.push({
      kind: r.kind,
      severity: r.severity,
      title: cut(r.title, MAX_TITLE_CHARS),
      explanation: cut(r.explanation, MAX_EXPLANATION_CHARS),
      file_refs: kept.map((ref) => (ref.startsWith('./') ? ref.slice(2) : ref)),
    });
  }

  const focus: BriefReviewFocusItem[] = [];
  for (const f of draft.review_focus) {
    const file = normalizeRefPath(f.file);
    if (!allowed.has(file) || !(Number.isInteger(f.line) && f.line >= 1)) {
      removed.focus += 1;
      continue;
    }
    focus.push({ file, line: f.line, reason: cut(f.reason, MAX_REASON_CHARS) });
  }

  return {
    summary: cut(draft.summary, MAX_SUMMARY_CHARS),
    risks: risks.slice(0, MAX_RISKS),
    review_focus: focus.slice(0, MAX_FOCUS),
    removed,
  };
}

// ---- Missing facts ---------------------------------------------------------------------------

export interface BaseFactsInput {
  /** `null` = no stored intent. */
  intent: { stale: boolean } | null;
  /** `'unavailable'` = the blast port threw; `null` = no blast data to speak of. */
  blast: { degraded: boolean; reason: string | null } | 'unavailable' | null;
  /** `ref` is the first `#n` in the description (or null); `outcome` is how the fetch went. */
  issue: { ref: number | null; outcome: 'ok' | 'missing_token' | 'fetch_failed' };
  docs: { count: number; skipped: string[]; truncated: string[] };
  body: string | null;
}

/** The facts known before any trimming: what was absent, stale, degraded or unreadable. */
export function baseMissingFacts(i: BaseFactsInput): BriefMissingFact[] {
  const out: BriefMissingFact[] = [];

  if (!i.intent) out.push({ fact: 'intent', status: 'absent', detail: null });
  else if (i.intent.stale) out.push({ fact: 'intent', status: 'stale', detail: null });

  if (i.blast === 'unavailable') out.push({ fact: 'blast', status: 'unavailable', detail: null });
  else if (i.blast?.degraded) out.push({ fact: 'blast', status: 'degraded', detail: i.blast.reason });

  if (i.issue.ref === null) out.push({ fact: 'linked_issue', status: 'absent', detail: null });
  else if (i.issue.outcome === 'missing_token') {
    out.push({ fact: 'linked_issue', status: 'missing_token', detail: String(i.issue.ref) });
  } else if (i.issue.outcome === 'fetch_failed') {
    out.push({ fact: 'linked_issue', status: 'fetch_failed', detail: String(i.issue.ref) });
  }

  if (i.docs.count === 0 && i.docs.skipped.length === 0) {
    out.push({ fact: 'project_context', status: 'absent', detail: null });
  }
  for (const p of i.docs.skipped) out.push({ fact: 'project_context', status: 'skipped', detail: p });
  for (const p of i.docs.truncated) out.push({ fact: 'project_context', status: 'truncated', detail: p });

  if (!i.body || i.body.trim() === '') out.push({ fact: 'description', status: 'absent', detail: null });

  return out;
}
