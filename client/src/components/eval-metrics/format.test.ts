import { describe, it, expect } from "vitest";
import { formatCost, formatCostDelta, formatDeltaCases, formatDeltaPoints, formatMetric } from "./format";

describe("eval metric formatters", () => {
  it("renders a null metric, delta and cost as an em dash — never 0", () => {
    expect(formatMetric(null)).toBe("—");
    expect(formatDeltaPoints(null)).toBe("—");
    expect(formatDeltaCases(null)).toBe("—");
    expect(formatCost(null)).toBe("—");
    expect(formatCostDelta(null)).toBe("—");
  });

  it("keeps a genuine zero distinct from not available", () => {
    expect(formatMetric(0)).toBe("0.0%");
    expect(formatMetric(1)).toBe("100.0%");
    expect(formatMetric(0.825)).toBe("82.5%");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("signs deltas with one decimal for points and whole numbers for cases", () => {
    expect(formatDeltaPoints(3)).toBe("+3.0");
    expect(formatDeltaPoints(-2.5)).toBe("−2.5");
    expect(formatDeltaPoints(0)).toBe("0.0");
    expect(formatDeltaPoints(-0.04)).toBe("0.0");
    expect(formatDeltaCases(2)).toBe("+2");
    expect(formatDeltaCases(-2)).toBe("−2");
    expect(formatDeltaCases(0)).toBe("0");
    expect(formatCostDelta(0.5)).toBe("+$0.5");
    expect(formatCostDelta(-0.5)).toBe("−$0.5");
  });
});
