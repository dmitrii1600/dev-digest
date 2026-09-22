/** Line diff between two skill-version bodies.
 *
 *  Why a local implementation: the repo has no diff library and must not gain
 *  one for a single screen (four independent lock-files — AGENTS.md). The
 *  diff-viewer's `parsePatch` is not reusable here either: it reads a git
 *  patch, and a version history has two plain strings and no patch. Only the
 *  *rendering* vocabulary is shared — this returns the diff-viewer's own `Line`
 *  shape, so the rows look exactly like the PR diff. */
import type { Line } from "@/components/diff-viewer";

/** Classic LCS table. Skill bodies are a few dozen lines, so the O(n·m) table
 *  is cheaper than the machinery needed to avoid it. */
function lcs(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/** `before` → `after`, as add/del/ctx lines carrying 1-based line numbers.
 *  Pass `before: null` for the oldest version — the whole body is an addition. */
export function diffLines(before: string | null, after: string): Line[] {
  const a = before == null ? [] : before.split("\n");
  const b = after.split("\n");
  const table = lcs(a, b);
  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i]!, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]!, oldNo: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]!, newNo: j + 1 });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "del", text: a[i]!, oldNo: i + 1 });
  for (; j < b.length; j++) out.push({ kind: "add", text: b[j]!, newNo: j + 1 });
  return out;
}

/** True when nothing but context survived — the two bodies are identical. */
export function isUnchanged(lines: Line[]): boolean {
  return lines.every((ln) => ln.kind === "ctx");
}
