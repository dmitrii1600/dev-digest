/**
 * "Prior PRs touching these files" caps (spec 09, P3-d). No LLM — plain
 * GitHub commit/PR history reads — but the fan-out (one `listCommitsForPath`
 * per candidate file, one `listPullsForCommit` per unique commit) is capped
 * on both axes to keep one request cheap.
 */

/** At most this many of the PR's changed files are considered. */
export const MAX_HISTORY_FILES = 12;
/** At most this many commits are read per considered file. */
export const MAX_HISTORY_COMMITS_PER_FILE = 5;
/** Commits are deduped across files; at most this many unique shas are
 *  resolved to their PR(s). */
export const MAX_HISTORY_UNIQUE_COMMITS = 40;
/** At most this many prior PRs are returned, most recently merged first. */
export const MAX_HISTORY_PRS = 5;

/** `index_stale` self-healing: at most one queued resync per repo per this
    interval, so page refreshes while the rebuild runs do not pile up jobs. */
export const REINDEX_NUDGE_INTERVAL_MS = 10 * 60 * 1000;
