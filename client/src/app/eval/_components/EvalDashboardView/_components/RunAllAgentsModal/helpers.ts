import type { EvalAgentCard, EvalRunAllOutcome } from "@devdigest/shared";

export interface RunAllSummary {
  /** Enabled agents with at least one case — the ones "Run all agents" would start. */
  eligible: EvalAgentCard[];
  /** One paid review call per case of each eligible agent. */
  calls: number;
  /** Sum of the eligible agents' known latest costs; `null` when none is known (never 0). */
  estimate: number | null;
  /** Eligible agents with no known latest cost (never run, or the run's cost is unknown). */
  unknownCount: number;
}

export function runAllSummary(cards: EvalAgentCard[]): RunAllSummary {
  const eligible = cards.filter((c) => c.enabled && c.cases_total > 0);
  const known = eligible.map((c) => c.latest?.cost_usd).filter((v): v is number => v != null);
  return {
    eligible,
    calls: eligible.reduce((sum, c) => sum + c.cases_total, 0),
    estimate: known.length > 0 ? known.reduce((sum, v) => sum + v, 0) : null,
    unknownCount: eligible.length - known.length,
  };
}

/** The `dashboard` message key of each skip reason. */
export const REASON_KEY = {
  already_running: "reasonAlreadyRunning",
  no_cases: "reasonNoCases",
  disabled: "reasonDisabled",
} as const satisfies Record<NonNullable<EvalRunAllOutcome["reason"]>, string>;
