import { describe, it, expect } from "vitest";
import type { EvalTrendPoint } from "@devdigest/shared";
import { toChartRows } from "./helpers";

function point(over: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    run_id: "r",
    ran_at: "2026-10-05T10:00:00Z",
    agent_version: 1,
    recall: 0.5,
    precision: 0.25,
    citation_accuracy: 1,
    pass_rate: 0.5,
    cases_passed: 1,
    cases_total: 2,
    cost_usd: null,
    ...over,
  };
}

describe("toChartRows", () => {
  it("keeps an unavailable metric as null — never 0 (EC-12)", () => {
    const rows = toChartRows([point({ recall: null, precision: 0, citation_accuracy: null })]);
    expect(rows[0]).toMatchObject({ i: 0, recall: null, precision: 0, citation: null });
    expect(rows[0]!.recall).toBeNull();
  });

  it("converts ratios to one-decimal percent, oldest first", () => {
    const rows = toChartRows([point({ recall: 0.825 }), point({ recall: 1 })]);
    expect(rows.map((r) => r.recall)).toEqual([82.5, 100]);
    expect(rows.map((r) => r.i)).toEqual([0, 1]);
  });

  it("plots every run — no cap (20 and 21 were the old boundary)", () => {
    for (const n of [20, 21, 25]) {
      const rows = toChartRows(Array.from({ length: n }, (_, k) => point({ recall: k / 100 })));
      expect(rows).toHaveLength(n);
      expect(rows[0]!.recall).toBe(0);
    }
  });

  it("carries each run's version, date and cost for the tooltip, an unknown cost staying null", () => {
    const rows = toChartRows([
      point({ agent_version: 2, cost_usd: 0.5, ran_at: "2026-10-01T00:00:00Z" }),
      point({ agent_version: 3, cost_usd: null }),
    ]);
    expect(rows.map((r) => r.agent_version)).toEqual([2, 3]);
    expect(rows.map((r) => r.cost_usd)).toEqual([0.5, null]);
    expect(rows[0]!.ran_at).toBe("2026-10-01T00:00:00Z");
  });
});
