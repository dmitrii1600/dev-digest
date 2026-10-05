import { describe, it, expect } from "vitest";
import type { EvalTrendPoint } from "@devdigest/shared";
import { TREND_MAX_POINTS, toChartRows } from "./helpers";

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
  it("keeps an unavailable metric as null — never 0 (EC-8)", () => {
    const rows = toChartRows([point({ recall: null, precision: 0, citation_accuracy: null })]);
    expect(rows[0]).toEqual({ i: 0, recall: null, precision: 0, citation: null });
    expect(rows[0]!.recall).toBeNull();
  });

  it("converts ratios to one-decimal percent, oldest first", () => {
    const rows = toChartRows([point({ recall: 0.825 }), point({ recall: 1 })]);
    expect(rows.map((r) => r.recall)).toEqual([82.5, 100]);
    expect(rows.map((r) => r.i)).toEqual([0, 1]);
  });

  it("keeps only the newest 20 runs", () => {
    const trend = Array.from({ length: 25 }, (_, n) => point({ recall: n / 100 }));
    const rows = toChartRows(trend);
    expect(rows).toHaveLength(TREND_MAX_POINTS);
    expect(rows[0]!.recall).toBe(5);
    expect(rows[19]!.recall).toBe(24);
  });
});
