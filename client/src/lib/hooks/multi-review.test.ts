import { describe, it, expect } from "vitest";
import type { MultiReviewDetail } from "@devdigest/shared";
import { multiReviewRefetchInterval } from "./multi-review";

const detail = (statuses: Array<string | null>): MultiReviewDetail =>
  ({
    id: "m1",
    pr: { id: "p1", number: 1, title: "t" },
    ran_at: "2026-10-11T00:00:00Z",
    agents: statuses.map((status, i) => ({
      run: { run_id: `r${i}`, status },
      summary: null,
      findings: [],
    })),
  }) as unknown as MultiReviewDetail;

describe("multiReviewRefetchInterval", () => {
  it("polls every 2s while a run is running or its status is unknown", () => {
    expect(multiReviewRefetchInterval(detail(["done", "running", "done"]))).toBe(2000);
    expect(multiReviewRefetchInterval(detail(["done", null]))).toBe(2000);
  });
  it("stops once every run has ended, or without data", () => {
    expect(multiReviewRefetchInterval(detail(["done", "failed", "cancelled"]))).toBe(false);
    expect(multiReviewRefetchInterval(undefined)).toBe(false);
  });
});
