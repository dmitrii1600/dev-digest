/* case-diff — the pasted diff of a manual eval case, parsed in the browser for the
   per-file preview, the Files view and the file / line-range checks. The rules are the
   server's `pastedDiffFiles` (server/src/modules/evals/helpers.ts) and share its fixtures:
   a file starts at `diff --git` or, without one, at the first `+++ `; the `b/` prefix is
   stripped and the path trimmed; a `+++ /dev/null` file is dropped; a "changed line" is the
   new-side number of a `+` line, in maximal runs. A header-less multi-file diff is rejected,
   because the shared parser would merge it into one file. */
import type { PrFile } from "@/lib/types";
import { EVAL_CASE_LIMITS } from "@devdigest/shared";

export type LineRange = [number, number];

/** A `PrFile` for `DiffViewer`, plus the changed-line runs of the new side. */
export type PastedFile = PrFile & { ranges: LineRange[] };

export type PastedDiff =
  | { ok: true; files: PastedFile[] }
  | { ok: false; reason: "empty" | "unparseable" | "needs_git_headers" };

const HUNK_START = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface Draft {
  path: string;
  ranges: LineRange[];
  additions: number;
  deletions: number;
  /** Lines from the first `@@` of the file on — what `PrFile.patch` holds. */
  patch: string[];
}

const newDraft = (): Draft => ({ path: "", ranges: [], additions: 0, deletions: 0, patch: [] });

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function parsePastedDiff(raw: string): PastedDiff {
  if (raw.trim() === "") return { ok: false, reason: "empty" };

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let sawGit = false;
  let sawHunk = false;
  let inHunk = false;
  let cursor = 0;
  let run: LineRange | null = null;
  let prevWasOld = false;
  let headerPairs = 0;

  const flushRun = () => {
    if (current && run) current.ranges.push(run);
    run = null;
  };
  const flushFile = () => {
    flushRun();
    if (current) drafts.push(current);
    current = null;
    inHunk = false;
  };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const isNewHeader = line.startsWith("+++ ");
    if (isNewHeader && prevWasOld) headerPairs++;
    prevWasOld = line.startsWith("--- ");

    if (line.startsWith("diff --git")) {
      flushFile();
      sawGit = true;
      current = newDraft();
      continue;
    }
    if (isNewHeader) {
      if (!current) current = newDraft();
      const p = line.slice(4).replace(/^b\//, "").trim();
      current.path = p === "/dev/null" ? current.path : p;
      continue;
    }
    if (prevWasOld) continue;
    const hh = HUNK_START.exec(line);
    if (hh) {
      flushRun();
      sawHunk = true;
      inHunk = true;
      cursor = Number(hh[1]);
      current?.patch.push(line);
      continue;
    }
    if (!current || !inHunk) continue;
    current.patch.push(line);
    if (line.startsWith("+")) {
      current.additions++;
      if (run && run[1] === cursor - 1) run[1] = cursor;
      else {
        flushRun();
        run = [cursor, cursor];
      }
      cursor++;
    } else if (line.startsWith("-")) {
      current.deletions++;
    } else if (line.startsWith("\\")) {
      // a "\ No newline at end of file" marker is not a line
    } else {
      flushRun();
      cursor++;
    }
  }
  flushFile();

  if (!sawGit && headerPairs > 1) return { ok: false, reason: "needs_git_headers" };
  const named = drafts.filter((d) => d.path);
  if (named.length === 0 || !sawHunk) return { ok: false, reason: "unparseable" };

  return {
    ok: true,
    files: named.map((d) => {
      const patch = [...d.patch];
      while (patch.length > 0 && patch[patch.length - 1] === "") patch.pop();
      return { path: d.path, additions: d.additions, deletions: d.deletions, patch: patch.join("\n"), ranges: d.ranges };
    }),
  };
}

/** `"12, 20–24"` — a one-line range prints as the line, a longer one as `start–end`. */
export function formatRanges(ranges: readonly LineRange[]): string {
  return ranges.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(", ");
}

/** Does `[start, end]` (inclusive) touch a changed line of the file? */
export function overlapsChanged(file: Pick<PastedFile, "ranges">, start: number, end: number): boolean {
  return file.ranges.some(([a, b]) => a <= end && start <= b);
}

/** The diff is over the 64 KB cap. */
export const diffTooLarge = (diff: string): boolean => utf8Bytes(diff) > EVAL_CASE_LIMITS.diffBytes;
