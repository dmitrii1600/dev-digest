import type { ContextDocKind, SpecFile } from "@devdigest/shared";
import { SOFT_CAP_TOKENS } from "./constants";

/** One row in the picker: a listed file, or an attached path the clone lost. */
export interface DocRow {
  path: string;
  kind: ContextDocKind;
  /** `null` when the listing carries no count; rendered "—", never 0. */
  tokens: number | null;
  /** Agents using this document, from the listing. */
  usedBy: number;
  attached: boolean;
  missing: boolean;
}

/** Attached rows first, in attach order (including attached paths absent from
    the listing, flagged `missing`); then the unattached rows by path. */
export function mergeDocRows(files: readonly SpecFile[], attached: readonly string[]): DocRow[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const attachedSet = new Set(attached);
  const head = attached.map((path): DocRow => {
    const f = byPath.get(path);
    return {
      path,
      kind: f?.kind ?? "other",
      tokens: f?.tokens ?? null,
      usedBy: f?.used_by ?? 0,
      attached: true,
      missing: !f,
    };
  });
  const tail = files
    .filter((f) => !attachedSet.has(f.path))
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(
      (f): DocRow => ({
        path: f.path,
        kind: f.kind ?? "other",
        tokens: f.tokens ?? null,
        usedBy: f.used_by ?? 0,
        attached: false,
        missing: false,
      }),
    );
  return [...head, ...tail];
}

/** Case-insensitive path substring filter. Never changes the order. */
export function filterDocs(rows: readonly DocRow[], query: string): DocRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.path.toLowerCase().includes(q));
}

/** Moves the item at `from` to `to`, returning a new array. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

/** Sum of tokens over attached rows that still exist in the clone. A row with
    an unknown (`null`) count is left out of the total. */
export function estimateTokens(rows: readonly DocRow[]): number {
  return rows.reduce((sum, r) => (r.attached && !r.missing && r.tokens !== null ? sum + r.tokens : sum), 0);
}

/** True when the attached total passes the 4K soft cap. Exactly 4,000 does not. */
export function isOverSoftCap(total: number): boolean {
  return total > SOFT_CAP_TOKENS;
}
