/* diff-target.ts — the Files changed navigation target carried in the URL:
   `?tab=diff&file=<path>&line=<n>`. Pure helpers shared by the page (reads the
   target), the brief jump hook (builds it) and DiffTab (acts on it). */

export interface DiffTarget {
  file: string;
  line: number | null;
}

function positiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** `"./src/a.ts:12-30"` → `{ file: "src/a.ts", line: 12 }`. A missing, zero or
    malformed line gives `line: null`. */
export function parseFileRef(ref: string): DiffTarget {
  const bare = ref.startsWith("./") ? ref.slice(2) : ref;
  const m = /^(.*):(\d+)(?:-\d+)?$/.exec(bare);
  if (!m) return { file: bare, line: null };
  return { file: m[1]!, line: positiveInt(m[2]!) };
}

/** Reads `file` (non-empty) and `line` (integer ≥ 1, else null); no file → no target. */
export function readDiffTarget(searchParams: { get(name: string): string | null }): DiffTarget | null {
  const file = searchParams.get("file");
  if (!file) return null;
  const rawLine = searchParams.get("line");
  return { file, line: rawLine == null ? null : positiveInt(rawLine) };
}

/** Sets `tab=diff`, `file` and `line` (omitted when null) on the current query;
    every other param (e.g. `trace`) is kept. */
export function diffTargetHref(base: string, currentSearch: string, target: DiffTarget): string {
  const params = new URLSearchParams(currentSearch);
  params.set("tab", "diff");
  params.set("file", target.file);
  if (target.line != null) params.set("line", String(target.line));
  else params.delete("line");
  return `${base}?${params.toString()}`;
}

/** Exact, case-sensitive membership — a near miss is not in the diff. */
export function isInDiff(file: string, diffPaths: string[]): boolean {
  return diffPaths.includes(file);
}
