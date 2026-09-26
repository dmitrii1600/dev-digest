import type {
  BlastDegradedReason,
  BlastRadius,
  ChangedSymbol,
  DownstreamImpact,
  PrHistoryItem,
} from '@devdigest/shared';
import type { BlastCallerRow, BlastResult, IndexState } from '../repo-intel/types.js';

/**
 * Pure mapper: `BlastResult` (repo-intel's flat facade shape) → `BlastRadius`
 * (the contract), plus the degraded resolution and the plain-English summary.
 * No Drizzle, no Fastify, no runtime `zod` — see *Contract → Mapping rules*
 * in `specs/09-blast-radius.md`.
 */

/** Pluralise a count word: `n === 1 ? word : word + 's'`. */
function pl(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/**
 * Rule 6 — degraded table. First match wins. The facade by itself only ever
 * emits `no_data` or nothing; without this table `flag_off`, `index_failed`
 * and `index_partial` could never reach the UI.
 */
export function resolveDegraded(
  result: BlastResult,
  state: IndexState,
  repoIntelEnabled: boolean,
  currentIndexerVersion: number,
): { degraded: boolean; reason: BlastDegradedReason | null } {
  if (!repoIntelEnabled) return { degraded: true, reason: 'flag_off' };
  if (state.degraded) return { degraded: true, reason: state.degradedReason ?? 'index_failed' };
  // An index built by an older indexer is still served (it may be useful) but
  // flagged: the service queues a rebuild and the UI says why the map may be
  // incomplete instead of presenting it as complete.
  if (state.indexerVersion !== currentIndexerVersion) return { degraded: true, reason: 'index_stale' };
  if (state.status === 'partial') return { degraded: true, reason: 'index_partial' };
  if (result.degraded) return { degraded: true, reason: result.reason ?? 'no_data' };
  return { degraded: false, reason: null };
}

/** Rule 7 — the plain-English summary. No model; MCP-only (the UI does not render it). */
export function buildSummary(args: {
  changedFilesCount: number;
  changedSymbolsCount: number;
  downstream: DownstreamImpact[];
  degraded: boolean;
  reason: BlastDegradedReason | null;
}): string {
  const { changedFilesCount, changedSymbolsCount: S, downstream, degraded, reason } = args;

  let base: string;
  if (S === 0) {
    base = `No indexed symbols in the ${changedFilesCount} changed ${pl(changedFilesCount, 'file')}.`;
  } else if (downstream.length === 0) {
    base = `${S} changed ${pl(S, 'symbol')}; no downstream callers found.`;
  } else {
    const C = downstream.reduce((sum, d) => sum + d.callers.length, 0);
    const F = new Set(downstream.flatMap((d) => d.callers.map((c) => c.file))).size;
    const E = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
    const J = new Set(downstream.flatMap((d) => d.crons_affected)).size;
    base = `${S} changed ${pl(S, 'symbol')}; ${C} ${pl(C, 'caller')} in ${F} ${pl(F, 'file')}; ${E} ${pl(E, 'endpoint')}; ${J} ${pl(J, 'cron')}.`;
  }
  return degraded ? `${base} Index degraded: ${reason}.` : base;
}

/** Rule 8 — `pr_files` is empty, so the service skips the facade entirely. */
export function emptyBlastRadius(): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary: 'No changed files recorded for this PR.',
    degraded: false,
    reason: null,
  };
}

/**
 * Rules 1-5 and 7 — group callers by `viaSymbol`, apply the declaring-file
 * guard, cap and order, attribute endpoints/crons, then order `changed_symbols`
 * and build the summary.
 */
export function toBlastRadius(args: {
  result: BlastResult;
  changedFilesCount: number;
  degraded: boolean;
  reason: BlastDegradedReason | null;
  maxCallersPerSymbol: number;
}): BlastRadius {
  const { result, changedFilesCount, degraded, reason, maxCallersPerSymbol } = args;

  // Rule 2 — the set of files that declare a changed symbol of a given name.
  const declFilesByName = new Map<string, Set<string>>();
  for (const s of result.changedSymbols) {
    const set = declFilesByName.get(s.name) ?? new Set<string>();
    set.add(s.file);
    declFilesByName.set(s.name, set);
  }

  // Rule 1 + 2 — group by viaSymbol, dropping declaring-file self-callers.
  const callersByVia = new Map<string, BlastCallerRow[]>();
  for (const c of result.callers) {
    if (declFilesByName.get(c.viaSymbol)?.has(c.file)) continue;
    const arr = callersByVia.get(c.viaSymbol) ?? [];
    arr.push(c);
    callersByVia.set(c.viaSymbol, arr);
  }

  // Rule 3 + 4 (callers) — cap after ordering rank desc, file asc, line asc.
  const groups: Array<{ via: string; callers: BlastCallerRow[] }> = [];
  for (const [via, callers] of callersByVia) {
    if (callers.length === 0) continue;
    const ordered = [...callers].sort(
      (a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line,
    );
    groups.push({ via, callers: ordered.slice(0, maxCallersPerSymbol) });
  }

  // Rule 4 (groups) — max caller rank desc, then caller count desc, then symbol asc.
  groups.sort((a, b) => {
    const rankA = a.callers[0]?.rank ?? 0;
    const rankB = b.callers[0]?.rank ?? 0;
    if (rankA !== rankB) return rankB - rankA;
    if (a.callers.length !== b.callers.length) return b.callers.length - a.callers.length;
    return a.via.localeCompare(b.via);
  });

  // Rule 5 — endpoints/crons per group, from the (post-cap) callers' files.
  const downstream: DownstreamImpact[] = groups.map((g) => {
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of g.callers) {
      const facts = result.factsByFile?.[c.file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const j of facts.crons) crons.add(j);
    }
    return {
      symbol: g.via,
      callers: g.callers.map((c) => {
        const facts = result.factsByFile?.[c.file];
        return {
          name: c.symbol,
          file: c.file,
          line: c.line,
          ...(facts && facts.endpoints.length > 0 ? { endpoints: [...facts.endpoints].sort() } : {}),
          ...(facts && facts.crons.length > 0 ? { crons: [...facts.crons].sort() } : {}),
        };
      }),
      endpoints_affected: [...endpoints].sort(),
      crons_affected: [...crons].sort(),
    };
  });

  // Rule 4 (changed_symbols) — symbols with downstream first (in downstream
  // order), then the rest by file, name.
  const seen = new Set<string>();
  const withDownstream: ChangedSymbol[] = [];
  for (const g of groups) {
    const matches = result.changedSymbols
      .filter((s) => s.name === g.via)
      .sort((a, b) => a.file.localeCompare(b.file));
    for (const s of matches) {
      const key = `${s.name}:${s.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      withDownstream.push({ name: s.name, file: s.file, kind: s.kind });
    }
  }
  const rest: ChangedSymbol[] = result.changedSymbols
    .filter((s) => !seen.has(`${s.name}:${s.file}`))
    .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
    .map((s) => ({ name: s.name, file: s.file, kind: s.kind }));

  const changed_symbols = [...withDownstream, ...rest];

  const summary = buildSummary({
    changedFilesCount,
    changedSymbolsCount: changed_symbols.length,
    downstream,
    degraded,
    reason,
  });

  return { changed_symbols, downstream, summary, degraded, reason };
}

// ---------------------------------------------------------------------------
// "Prior PRs touching these files" (spec 09, P3-d) — pure GitHub-history
// composition. No LLM; the two GitHub calls are primitives on `GitHubClient`
// (`listCommitsForPath`, `listPullsForCommit`); everything below is grouping,
// capping and ordering only.

const DOC_OR_LOCK_RE =
  /(\.(md|mdx|txt)$)|((^|\/)(package-lock\.json|pnpm-lock\.yaml|npm-shrinkwrap\.json|yarn\.lock)$)|(\.lock$)/i;
const TEST_FILE_RE = /(\.(test|spec)\.[jt]sx?$)|((^|\/)(__tests__|tests?)\/)/i;

/**
 * Pick which of the PR's changed files to look up history for: skip docs and
 * lockfiles entirely (their "history" is noise, not code review context),
 * then order non-test source files ahead of test files, capped at `cap`.
 */
export function selectHistoryFiles(files: string[], cap: number): string[] {
  const candidates = files.filter((f) => !DOC_OR_LOCK_RE.test(f));
  const source = candidates.filter((f) => !TEST_FILE_RE.test(f));
  const tests = candidates.filter((f) => TEST_FILE_RE.test(f));
  return [...source, ...tests].slice(0, cap);
}

export interface GhCommitRef {
  sha: string;
}

/**
 * Dedupe the commits discovered across the selected files into at most
 * `maxUnique` shas, keeping — for each sha — the set of candidate files whose
 * commit history surfaced it. That per-sha file set is later reused to derive
 * `files_overlap`, so a prior PR's overlap never needs a third GitHub call.
 */
export function collectUniqueCommits(
  commitsByFile: ReadonlyMap<string, readonly GhCommitRef[]>,
  maxUnique: number,
): Map<string, Set<string>> {
  const bySha = new Map<string, Set<string>>();
  for (const [file, commits] of commitsByFile) {
    for (const c of commits) {
      let files = bySha.get(c.sha);
      if (!files) {
        if (bySha.size >= maxUnique) continue;
        files = new Set<string>();
        bySha.set(c.sha, files);
      }
      files.add(file);
    }
  }
  return bySha;
}

/** A plain, non-LLM sentence: `Touched {n} of this PR's files; merged {date}.` */
export function buildHistoryNote(overlapCount: number, mergedAt: string): string {
  return `Touched ${overlapCount} of this PR's files; merged ${mergedAt.slice(0, 10)}.`;
}

export interface GhPrRef {
  number: number;
  title: string;
  merged_at: string | null;
  author: string;
}

/**
 * Group the commits' associated PRs by PR number — excluding the PR being
 * viewed and anything not merged (`PrHistoryItem.merged_at` is required) —
 * then keep the `maxPrs` most recently merged. `files_overlap` is the union
 * of the (already-fetched) candidate files whose commits led to that PR.
 */
export function buildPrHistory(args: {
  commitFiles: ReadonlyMap<string, ReadonlySet<string>>;
  pullsByCommit: ReadonlyMap<string, readonly GhPrRef[]>;
  excludeNumber: number;
  maxPrs: number;
}): PrHistoryItem[] {
  const byNumber = new Map<number, { pr: GhPrRef; files: Set<string> }>();
  for (const [sha, files] of args.commitFiles) {
    const prs = args.pullsByCommit.get(sha) ?? [];
    for (const pr of prs) {
      if (pr.number === args.excludeNumber || !pr.merged_at) continue;
      const entry = byNumber.get(pr.number) ?? { pr, files: new Set<string>() };
      for (const f of files) entry.files.add(f);
      byNumber.set(pr.number, entry);
    }
  }

  return [...byNumber.values()]
    .sort((a, b) => {
      const at = a.pr.merged_at as string;
      const bt = b.pr.merged_at as string;
      if (at !== bt) return at < bt ? 1 : -1;
      return b.pr.number - a.pr.number;
    })
    .slice(0, args.maxPrs)
    .map(({ pr, files }) => ({
      pr_number: pr.number,
      title: pr.title,
      merged_at: pr.merged_at as string,
      author: pr.author,
      files_overlap: [...files].sort(),
      notes: buildHistoryNote(files.size, pr.merged_at as string),
    }));
}
