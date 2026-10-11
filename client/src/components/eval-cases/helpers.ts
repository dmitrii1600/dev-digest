import type { EvalCaseListItem, EvalCaseSource, EvalExpectation, EvalTarget } from "@devdigest/shared";

/** `file:start` for a one-line target, `file:start–end` for a range. */
export function targetLabel(target: EvalTarget): string {
  return target.end_line > target.start_line
    ? `${target.file}:${target.start_line}–${target.end_line}`
    : `${target.file}:${target.start_line}`;
}

/** `eval.json` keys for each expectation and last result. */
export const EXPECTATION_KEY: Record<EvalExpectation, string> = {
  must_find: "evalsTab.mustFind",
  must_not_flag: "evalsTab.mustNotFlag",
};

export const RESULT_KEY: Record<EvalCaseListItem["last_result"], string> = {
  passed: "evalsTab.passed",
  failed: "evalsTab.failed",
  errored: "evalsTab.errored",
  never_run: "evalsTab.neverRun",
};

export const RESULT_COLOR: Record<EvalCaseListItem["last_result"], string> = {
  passed: "var(--ok)",
  failed: "var(--crit)",
  errored: "var(--warn)",
  never_run: "var(--text-muted)",
};

/** Where a case came from (AC-7). */
export const ORIGIN_KEY: Record<EvalCaseSource, string> = {
  finding: "evalsTab.originFinding",
  manual: "evalsTab.originManual",
};
