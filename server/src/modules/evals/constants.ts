import { EVAL_CASE_LIMITS } from '@devdigest/shared';

// The caps have one source, the contract, so the case editor and the API cannot drift.

/** Frozen diff of one file: 64 KB as UTF-8 bytes. */
export const MAX_FROZEN_DIFF_BYTES: number = EVAL_CASE_LIMITS.diffBytes;
/** PR title kept on a case, in characters. */
export const MAX_PR_TITLE_CHARS: number = EVAL_CASE_LIMITS.prTitleChars;
/** PR body kept on a case: 16 KB as UTF-8 bytes. */
export const MAX_PR_BODY_BYTES: number = EVAL_CASE_LIMITS.prBodyBytes;
/** Case name, in characters. */
export const MAX_CASE_NAME_CHARS: number = EVAL_CASE_LIMITS.nameChars;

/** Cases one owner (an agent or a skill) may have. */
export const MAX_CASES_PER_AGENT = 200;
/** Review calls in flight at once within one run. */
export const EVAL_CONCURRENCY = 3;
/** A case whose review has not returned in this long is recorded as errored. */
export const EVAL_CASE_TIMEOUT_MS = 120_000;
/**
 * Provider-side timeout stamped on every request. Longer than the service timer
 * so the service timer always wins and the SDK never gives up first (the brief
 * module's 120 s service / 125 s adapter precedent).
 */
export const EVAL_ADAPTER_TIMEOUT_MS = EVAL_CASE_TIMEOUT_MS + 5_000;

/** Default page size of the run list and the "recent runs" tables. */
export const RUNS_PAGE_SIZE = 20;

/** Recorded on a `running` row whose process is gone (the API restarted mid-run). */
export const INTERRUPTED_REASON = 'interrupted: the API restarted while the run was in progress';
