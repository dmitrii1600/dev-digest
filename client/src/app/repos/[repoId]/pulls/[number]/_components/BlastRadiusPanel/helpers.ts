/* Pure helpers for BlastRadiusPanel — no hooks, no JSX, unit-tested directly.
   Stats and the "declared in" lookup read the same arrays the panel renders
   (`changed_symbols` / `downstream`), never `summary` — a server-side string
   meant for MCP, not for counting (client/INSIGHTS.md:97). */
import type { BlastRadius } from "@devdigest/shared";

/** Groups with ≤ this many entries start fully expanded (P3-a default). */
const AUTO_EXPAND_ALL_THRESHOLD = 5;
/** Above the threshold, only the first this-many groups start expanded. */
const AUTO_EXPAND_HEAD_COUNT = 3;

export interface BlastStats {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** Stats row counts, derived from the arrays themselves:
    - `symbols` = every changed symbol, whether or not it has callers;
    - `callers` = every caller listed across all downstream groups;
    - `endpoints`/`crons` = the distinct union across groups, matching the
      server summary's E/J counts (mapping rule 7). */
export function blastStats(blast: BlastRadius): BlastStats {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const group of blast.downstream) {
    callers += group.callers.length;
    for (const e of group.endpoints_affected) endpoints.add(e);
    for (const c of group.crons_affected) crons.add(c);
  }
  return {
    symbols: blast.changed_symbols.length,
    callers,
    endpoints: endpoints.size,
    crons: crons.size,
  };
}

/** The file(s) that declare `symbol`, read from `changed_symbols` (never from
    a caller row — a caller's own file is never its declaring file). */
export function declaringFiles(blast: BlastRadius, symbol: string): string[] {
  return blast.changed_symbols.filter((s) => s.name === symbol).map((s) => s.file);
}

/** Which downstream groups (by index) start expanded, per P3-a: all of them
    when there are few, otherwise just the first few. */
export function defaultExpandedIndexes(groupCount: number): boolean[] {
  const allExpanded = groupCount <= AUTO_EXPAND_ALL_THRESHOLD;
  return Array.from({ length: groupCount }, (_, i) => allExpanded || i < AUTO_EXPAND_HEAD_COUNT);
}
