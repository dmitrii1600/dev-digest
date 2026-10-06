import { describe, it, expect } from "vitest";
import type { EvalAgentCard, EvalSuiteRun } from "@devdigest/shared";
import { runAllSummary } from "./helpers";

const latest = (cost: number | null) => ({ cost_usd: cost }) as EvalSuiteRun;

function card(id: string, over: Partial<EvalAgentCard> = {}): EvalAgentCard {
  return {
    agent_id: id,
    agent_name: id,
    provider: "openai",
    model: "gpt-4.1",
    enabled: true,
    running: false,
    cases_total: 3,
    latest: latest(0.01),
    ...over,
  } as EvalAgentCard;
}

describe("runAllSummary", () => {
  it("excludes a disabled agent and an agent with no cases", () => {
    const s = runAllSummary([card("a"), card("off", { enabled: false }), card("empty", { cases_total: 0 })]);
    expect(s.eligible.map((c) => c.agent_id)).toEqual(["a"]);
    expect(s.calls).toBe(3);
  });

  it("sums the known costs and counts an unknown one as unknown, not as 0", () => {
    const s = runAllSummary([
      card("a", { cases_total: 2, latest: latest(0.01) }),
      card("b", { cases_total: 4, latest: latest(null) }),
      card("c", { cases_total: 1, latest: null }),
    ]);
    expect(s.calls).toBe(7);
    expect(s.estimate).toBeCloseTo(0.01);
    expect(s.unknownCount).toBe(2);
  });

  it("has no estimate at all when every cost is unknown (and for no eligible agent)", () => {
    expect(runAllSummary([card("a", { latest: latest(null) }), card("b", { latest: null })]).estimate).toBeNull();
    const none = runAllSummary([card("off", { enabled: false })]);
    expect(none.eligible).toEqual([]);
    expect(none.estimate).toBeNull();
    expect(none.calls).toBe(0);
  });
});
