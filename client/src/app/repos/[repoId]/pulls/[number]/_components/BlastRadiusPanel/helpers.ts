/* Pure helpers for BlastRadiusPanel — no hooks, no JSX, unit-tested directly.
   Stats and the "declared in" lookup read the same arrays the panel renders
   (`changed_symbols` / `downstream`), never `summary` — a server-side string
   meant for MCP, not for counting (client/INSIGHTS.md:97). */
import type { BlastRadius } from "@devdigest/shared";

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

/** The `kind` (`function`, `interface`, …) of the changed symbol named
    `symbol`, read from `changed_symbols`. Drives the tree/graph `()` suffix
    for callable kinds — a data lookup, not a heuristic on the name. */
export function changedSymbolKind(blast: BlastRadius, symbol: string): string | undefined {
  return blast.changed_symbols.find((s) => s.name === symbol)?.kind;
}

/** Only the first downstream group starts expanded, per the tree-view
    design; every other group starts collapsed regardless of how many there
    are (a per-symbol override in the panel's state can still open them). */
export function defaultExpandedIndexes(groupCount: number): boolean[] {
  return Array.from({ length: groupCount }, (_, i) => i === 0);
}
