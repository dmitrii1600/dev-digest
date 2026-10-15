import { describe, it, expect } from "vitest";
import type { AgentRunEstimate } from "@devdigest/shared";
import { aggregateParts, estimateParts, hintSeconds } from "./run-estimates";

const est = (ms: number | null, cost: number | null): AgentRunEstimate => ({
  agent_id: "a",
  sample_runs: 3,
  avg_duration_ms: ms,
  avg_cost_usd: cost,
});

describe("estimateParts / hintSeconds", () => {
  it("formats known, missing and half-known estimates", () => {
    expect(estimateParts(est(6200, 0.012))).toEqual({ time: "6.2s", cost: "$0.012" });
    expect(estimateParts(undefined)).toEqual({ time: "—", cost: "—" });
    expect(estimateParts(est(6200, null))).toEqual({ time: "6.2s", cost: "—" });
    expect(hintSeconds(est(6200, null))).toBe(6);
    expect(hintSeconds(undefined)).toBeNull();
  });
});

describe("aggregateParts", () => {
  it("takes the max time and sums cost; unknowns never count as 0", () => {
    expect(aggregateParts([est(6200, 0.012), est(7400, 0.014)])).toEqual({ time: "7.4s", cost: "$0.026" });
    expect(aggregateParts([est(6200, 0.012), est(null, 0.01), est(5000, 0.01)]).time).toBe("6.2s");
    expect(aggregateParts([est(6200, 0.012), est(7400, 0.014), est(1000, null)]).cost).toBe("—");
    expect(aggregateParts([est(6200, 0.012), undefined]).cost).toBe("—");
    expect(aggregateParts([])).toEqual({ time: "—", cost: "—" });
  });
});
