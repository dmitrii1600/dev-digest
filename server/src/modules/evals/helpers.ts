import { createHash } from 'node:crypto';
import type { EvalExpectation, EvalMetrics, EvalRegression, EvalTarget } from '@devdigest/shared';
import { REVIEW_TASK_RULES } from '../_shared/review-inputs.js';
import { MAX_FROZEN_DIFF_BYTES } from './constants.js';

/**
 * Pure eval logic: freezing a diff, matching a finding to a target, scoring,
 * run aggregation, deltas and comparison. No I/O; the same inputs always give
 * the same output (NFR-2).
 */

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

// ---------------------------------------------------------------------------
// Diff freezing
// ---------------------------------------------------------------------------

/**
 * The block of one file out of a multi-file unified diff, from its
 * `diff --git` header up to the next header. The `b/` path must EQUAL `path`:
 * a substring match (what `sliceDiff` does) would let `src/a.ts` also capture
 * `src/a.tsx`.
 */
export function extractFileDiff(raw: string, path: string): string | null {
  const lines = raw.split('\n');
  const suffix = ` b/${path}`;
  const out: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (capture) break;
      capture = line.endsWith(suffix);
    }
    if (capture) out.push(line);
  }
  return out.length > 0 ? out.join('\n') : null;
}

/** A single-file diff from a persisted `pr_files.patch` (the `diffFromPrFiles` shape). */
export function patchToFileDiff(path: string, patch: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
}

export type FreezeResult =
  | { ok: true; diff: string; trimmed: boolean }
  | { ok: false; reason: 'diff_too_large' | 'target_outside_diff' };

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Freeze one file's diff for a case. Within the cap it is kept as is. Over the
 * cap only the hunks whose new-side range overlaps `[start, end]` are kept; if
 * none does the target is not in the diff, and if those still exceed the cap the
 * diff is too large.
 */
export function freezeDiff(
  fileDiff: string,
  start: number,
  end: number,
  maxBytes: number = MAX_FROZEN_DIFF_BYTES,
): FreezeResult {
  if (utf8Bytes(fileDiff) <= maxBytes) return { ok: true, diff: fileDiff, trimmed: false };

  const lines = fileDiff.split('\n');
  const header: string[] = [];
  const hunks: { from: number; to: number; lines: string[] }[] = [];
  for (const line of lines) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      const from = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      hunks.push({ from, to: from + Math.max(len, 1) - 1, lines: [line] });
    } else if (hunks.length > 0) {
      hunks[hunks.length - 1]!.lines.push(line);
    } else {
      header.push(line);
    }
  }

  const kept = hunks.filter((h) => h.from <= end && start <= h.to);
  if (kept.length === 0) return { ok: false, reason: 'target_outside_diff' };

  const diff = [...header, ...kept.flatMap((h) => h.lines)].join('\n');
  if (utf8Bytes(diff) > maxBytes) return { ok: false, reason: 'diff_too_large' };
  return { ok: true, diff, trimmed: true };
}

// ---------------------------------------------------------------------------
// Manual cases: a pasted diff
// ---------------------------------------------------------------------------

export interface PastedFile {
  path: string;
  /** Maximal runs of consecutive new-side line numbers of `+` lines, inclusive. */
  ranges: [number, number][];
}

export type PastedDiffResult =
  | { ok: true; files: PastedFile[] }
  | { ok: false; reason: 'diff_unparseable' | 'diff_needs_git_headers' };

const HUNK_START = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The files of a pasted unified diff and the line runs each one changes (the `+` lines).
 * File rules follow `parseUnifiedDiff` exactly: a file starts at `diff --git` or, without
 * one, at the first `+++ `; the `b/` prefix is stripped and the path trimmed; a
 * `+++ /dev/null` file is dropped. That parser merges a header-less multi-file diff into one
 * file, so such a diff is rejected here instead (`diff_needs_git_headers`).
 */
export function pastedDiffFiles(raw: string): PastedDiffResult {
  const files: PastedFile[] = [];
  let current: PastedFile | null = null;
  let sawGit = false;
  let sawHunk = false;
  let inHunk = false;
  let cursor = 0;
  let run: [number, number] | null = null;
  let prevWasOld = false;
  let headerPairs = 0;

  const flushRun = () => {
    if (current && run) current.ranges.push(run);
    run = null;
  };
  const flushFile = () => {
    flushRun();
    if (current) files.push(current);
    current = null;
    inHunk = false;
  };

  for (const line of raw.split('\n')) {
    const isNewHeader = line.startsWith('+++ ');
    if (isNewHeader && prevWasOld) headerPairs++;
    prevWasOld = line.startsWith('--- ');

    if (line.startsWith('diff --git')) {
      flushFile();
      sawGit = true;
      current = { path: '', ranges: [] };
      continue;
    }
    if (isNewHeader) {
      if (!current) current = { path: '', ranges: [] };
      const p = line.slice(4).replace(/^b\//, '').trim();
      current.path = p === '/dev/null' ? current.path : p;
      continue;
    }
    if (prevWasOld) continue;
    const hh = HUNK_START.exec(line);
    if (hh) {
      flushRun();
      sawHunk = true;
      inHunk = true;
      cursor = Number(hh[1]);
      continue;
    }
    if (!current || !inHunk) continue;
    if (line.startsWith('+')) {
      if (run && run[1] === cursor - 1) run[1] = cursor;
      else {
        flushRun();
        run = [cursor, cursor];
      }
      cursor++;
    } else if (line.startsWith('-') || line.startsWith('\\')) {
      // a deletion consumes no new-side line; a "\ No newline" marker is not a line
    } else {
      flushRun();
      cursor++;
    }
  }
  flushFile();

  if (!sawGit && headerPairs > 1) return { ok: false, reason: 'diff_needs_git_headers' };
  const named = files.filter((f) => f.path);
  if (named.length === 0 || !sawHunk) return { ok: false, reason: 'diff_unparseable' };
  return { ok: true, files: named };
}

export type TargetCheck =
  | null
  | { reason: 'target_file_not_in_diff'; field: 'target.file' }
  | { reason: 'target_outside_changes'; field: 'target' };

/**
 * Is the target a file of the pasted diff, and does its range overlap a changed line?
 * The path is compared exactly and case-sensitively, like `findingMatches`; overlap is inclusive.
 */
export function checkManualTarget(files: readonly PastedFile[], target: EvalTarget): TargetCheck {
  const file = files.find((f) => f.path === target.file);
  if (!file) return { reason: 'target_file_not_in_diff', field: 'target.file' };
  const overlaps = file.ranges.some(([a, b]) => a <= target.end_line && target.start_line <= b);
  return overlaps ? null : { reason: 'target_outside_changes', field: 'target' };
}

/** The key two case names are compared by: trimmed and case-insensitive (Q3). */
export function caseNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** First `n` characters (code points, so a surrogate pair is never split). */
export function truncateChars(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n).join('');
}

/** At most `maxBytes` UTF-8 bytes, never cutting a code point in half. */
export function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  let cut = maxBytes;
  // Step back off a continuation byte (10xxxxxx) so the last code point is whole.
  while (cut > 0 && (buf[cut]! & 0xc0) === 0x80) cut--;
  return buf.subarray(0, cut).toString('utf8');
}

/** sha256 over the frozen inputs, expectation and target, in a fixed order. */
export function caseFingerprint(c: {
  input_diff: string;
  pr_title: string;
  pr_body: string;
  expectation: EvalExpectation;
  file: string;
  start_line: number;
  end_line: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        c.input_diff,
        c.pr_title,
        c.pr_body,
        c.expectation,
        c.file,
        c.start_line,
        c.end_line,
      ]),
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Matching and scoring
// ---------------------------------------------------------------------------

export interface FindingSpan {
  file: string;
  start_line: number;
  end_line: number;
}

/** Exact, case-sensitive file equality and inclusive line-range overlap. */
export function findingMatches(f: FindingSpan, t: EvalTarget): boolean {
  return f.file === t.file && f.start_line <= t.end_line && t.start_line <= f.end_line;
}

export interface CaseScore {
  status: 'passed' | 'failed';
  /** Findings the model produced after the engine merged them: kept + grounding-dropped. */
  produced: number;
  kept: number;
  matched: number;
  /** Kept findings that matched a `must_not_flag` target. */
  nmf_hits: number;
}

/**
 * `must_find` passes iff a kept finding overlaps the target; `must_not_flag`
 * passes iff none does.
 */
export function scoreCase(
  expectation: EvalExpectation,
  target: EvalTarget,
  kept: readonly FindingSpan[],
  droppedCount: number,
): CaseScore {
  const matched = kept.filter((f) => findingMatches(f, target)).length;
  const passed = expectation === 'must_find' ? matched >= 1 : matched === 0;
  return {
    status: passed ? 'passed' : 'failed',
    produced: kept.length + droppedCount,
    kept: kept.length,
    matched,
    nmf_hits: expectation === 'must_not_flag' ? matched : 0,
  };
}

/** The compact shape stored per result. */
export function compactFindings(
  kept: readonly (FindingSpan & { title: string; severity: string })[],
): { file: string; start_line: number; end_line: number; title: string; severity: string }[] {
  return kept.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    title: f.title,
    severity: f.severity,
  }));
}

export interface CaseOutcome {
  expectation: EvalExpectation;
  status: 'passed' | 'failed' | 'errored';
  produced: number;
  kept: number;
  nmf_hits: number;
  cost_usd: number | null;
}

export interface RunAggregate {
  metrics: EvalMetrics;
  cases_total: number;
  cases_passed: number;
  cases_errored: number;
  status: 'completed' | 'partial' | 'failed';
  cost_usd: number | null;
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/**
 * Run-level numbers from per-case outcomes. Errored cases are out of every
 * denominator. A metric whose denominator is empty is `null`, never 0 or 1.
 */
export function aggregateRun(results: readonly CaseOutcome[]): RunAggregate {
  const ok = results.filter((r) => r.status !== 'errored');
  const mustFind = ok.filter((r) => r.expectation === 'must_find');
  const kept = ok.reduce((n, r) => n + r.kept, 0);
  const produced = ok.reduce((n, r) => n + r.produced, 0);
  const nmfHits = ok.reduce((n, r) => n + r.nmf_hits, 0);

  const precisionLoss = ratio(nmfHits, kept);
  const errored = results.length - ok.length;

  return {
    metrics: {
      recall: ratio(mustFind.filter((r) => r.status === 'passed').length, mustFind.length),
      precision: precisionLoss === null ? null : 1 - precisionLoss,
      citation_accuracy: ratio(kept, produced),
    },
    cases_total: results.length,
    cases_passed: results.filter((r) => r.status === 'passed').length,
    cases_errored: errored,
    status: errored === 0 ? 'completed' : ok.length === 0 ? 'failed' : 'partial',
    // Unknown cost poisons the sum (the engine's rule): never coerce it to 0.
    cost_usd:
      ok.length === 0 || ok.some((r) => r.cost_usd === null)
        ? null
        : ok.reduce((n, r) => n + (r.cost_usd ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Deltas and comparison
// ---------------------------------------------------------------------------

const round1 = (n: number): number => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r; // never "-0"
};

/** Signed percentage points, one decimal; `null` when either side is not available. */
export function metricDelta(newer: number | null, older: number | null): number | null {
  if (newer === null || older === null) return null;
  return round1((newer - older) * 100);
}

/** Signed change in the number of passing cases; `null` when either run is missing. */
export function passDelta(
  newer: { cases_passed: number } | null | undefined,
  older: { cases_passed: number } | null | undefined,
): number | null {
  if (!newer || !older) return null;
  return newer.cases_passed - older.cases_passed;
}

const METRIC_KEYS = ['recall', 'precision', 'citation_accuracy'] as const;

/** Each metric that dropped from `previous` to `latest`, with the drop in points. */
export function regressions(latest: EvalMetrics, previous: EvalMetrics): EvalRegression[] {
  const out: EvalRegression[] = [];
  for (const metric of METRIC_KEYS) {
    const now = latest[metric];
    const before = previous[metric];
    if (now === null || before === null || now >= before) continue;
    const drop = round1((before - now) * 100);
    if (drop > 0) out.push({ metric, drop_points: drop });
  }
  return out;
}

const METRIC_LABEL: Record<EvalRegression['metric'], string> = {
  recall: 'Recall',
  precision: 'Precision',
  citation_accuracy: 'Citation accuracy',
};

/** One English sentence naming each dropped metric, or `null` when none dropped. */
export function alertLine(regs: readonly EvalRegression[]): string | null {
  if (regs.length === 0) return null;
  const parts = regs.map((r) => `${METRIC_LABEL[r.metric]} dropped ${r.drop_points.toFixed(1)} points`);
  return `${parts.join('; ')} since the previous run.`;
}

export interface CaseSetComparison {
  same: boolean;
  older_count: number;
  newer_count: number;
  edited_count: number;
}

/** Did the two runs cover the same case ids with the same content fingerprints? */
export function compareCaseSets(
  older: readonly { case_id: string; fingerprint: string }[],
  newer: readonly { case_id: string; fingerprint: string }[],
): CaseSetComparison {
  const olderById = new Map(older.map((r) => [r.case_id, r.fingerprint]));
  const newerById = new Map(newer.map((r) => [r.case_id, r.fingerprint]));
  let edited = 0;
  for (const [id, fp] of olderById) {
    const other = newerById.get(id);
    if (other !== undefined && other !== fp) edited++;
  }
  const sameIds = olderById.size === newerById.size && [...olderById.keys()].every((id) => newerById.has(id));
  return {
    same: sameIds && edited === 0,
    older_count: older.length,
    newer_count: newer.length,
    edited_count: edited,
  };
}

/** Did the ordered `(skill_id, version)` list change between two runs? */
export function skillsChanged(
  a: readonly { skill_id: string; version: number }[],
  b: readonly { skill_id: string; version: number }[],
): boolean {
  return a.length !== b.length || a.some((s, i) => s.skill_id !== b[i]!.skill_id || s.version !== b[i]!.version);
}

/** Task line for an eval case: only the frozen PR title, no number or author. */
export function evalTaskLine(meta: { pr_title: string }): string {
  return `Review pull request "${meta.pr_title}". ` + REVIEW_TASK_RULES;
}
