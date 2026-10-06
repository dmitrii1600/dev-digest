/* eval-cases — the eval case editor and case list shared by the agent Evals tab and the skill
   Evals tab, plus the pure helpers behind them (pasted-diff parsing, the expectation JSON,
   labels). Two features use these, so they live here rather than under either route. */
export { EvalCaseEditor } from "./EvalCaseEditor";
export type { EvalCaseEditorProps } from "./EvalCaseEditor";
export { EvalCaseList } from "./EvalCaseList";
export { EXPECTATION_KEY, ORIGIN_KEY, RESULT_COLOR, RESULT_KEY, targetLabel } from "./helpers";
