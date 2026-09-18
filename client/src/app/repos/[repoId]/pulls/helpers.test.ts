/**
 * PR-list helpers. `latestReviewFindings` mirrors the rule the API uses for
 * `PrMeta.findings_counts` — the single newest review — so the hover preview
 * and the severity chips beside it can never disagree.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { latestReviewFindings, relativeTime } from "./helpers";

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr",
    agent_id: "a",
    run_id: "run",
    agent_name: "Agent",
    kind: "review",
    verdict: "comment",
    summary: "s",
    score: 80,
    model: "m",
    grounding: "1/1 passed",
    created_at: "2026-06-01T00:00:00.000Z",
    findings: [],
    ...o,
  } as ReviewRecord;
}

describe("latestReviewFindings", () => {
  it("takes only the newest review — reviews arrive newest-first", () => {
    const out = latestReviewFindings([
      review({ id: "new", findings: [finding({ id: "f-new" })] }),
      review({ id: "old", findings: [finding({ id: "f-old" })] }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["f-new"]);
  });

  it("sorts most severe first", () => {
    const out = latestReviewFindings([
      review({
        id: "r",
        findings: [
          finding({ id: "s", severity: "SUGGESTION" }),
          finding({ id: "c", severity: "CRITICAL" }),
          finding({ id: "w", severity: "WARNING" }),
        ],
      }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["c", "w", "s"]);
  });

  it("skips summary rows — only kind='review' carries findings", () => {
    const out = latestReviewFindings([
      review({ id: "sum", kind: "summary", findings: [finding({ id: "f-sum" })] }),
      review({ id: "rev", findings: [finding({ id: "f-rev" })] }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["f-rev"]);
  });

  it("is empty, never undefined, when there is nothing to show", () => {
    expect(latestReviewFindings(undefined)).toEqual([]);
    expect(latestReviewFindings([])).toEqual([]);
  });

  it("does not mutate the review's own findings array", () => {
    const findings = [
      finding({ id: "s", severity: "SUGGESTION" }),
      finding({ id: "c", severity: "CRITICAL" }),
    ];
    latestReviewFindings([review({ id: "r", findings })]);
    expect(findings.map((f) => f.id)).toEqual(["s", "c"]);
  });
});

describe("relativeTime", () => {
  it("renders an em dash for an unknown timestamp", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime("not-a-date")).toBe("—");
  });
});
