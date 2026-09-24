import { describe, it, expect } from "vitest";
import { SmartDiffRole } from "@devdigest/shared";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import { findingsByPath, groupFiles, latestFindingsPerAgent } from "./helpers";
import { ROLE_ORDER } from "./constants";

// The client's `ROLE_ORDER` is a hand-kept mirror of the contract's enum
// (client/INSIGHTS.md: importing the runtime value in *source* breaks the
// webpack build) — a test file is exactly where importing the runtime value
// is allowed, so drift (an added/reordered role) fails loudly here instead of
// silently at runtime.
it("ROLE_ORDER deep-equals SmartDiffRole.options", () => {
  expect([...ROLE_ORDER]).toEqual(SmartDiffRole.options);
});

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: overrides.id ?? "f1",
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "src/app.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    confidence: 0.9,
    kind: "finding",
    review_id: "review-1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: overrides.id ?? "r1",
    pr_id: "pr-1",
    agent_id: null,
    run_id: null,
    agent_name: null,
    kind: "review",
    verdict: "comment",
    summary: "s",
    score: 70,
    model: "gpt-4.1",
    created_at: "2026-01-01T00:00:00Z",
    findings: [],
    ...overrides,
  };
}

describe("latestFindingsPerAgent", () => {
  it("keeps only the newest review per agent, drops kind='summary', and excludes dismissed findings", () => {
    const agentA = "agent-a";
    const agentB = "agent-b";
    const reviews: ReviewRecord[] = [
      review({
        id: "r-a-old",
        agent_id: agentA,
        created_at: "2026-01-01T00:00:00Z",
        findings: [finding({ id: "f-a-old", start_line: 5 })],
      }),
      review({
        id: "r-a-new",
        agent_id: agentA,
        created_at: "2026-01-02T00:00:00Z",
        findings: [finding({ id: "f-a-new", start_line: 9 })],
      }),
      review({
        id: "r-b",
        agent_id: agentB,
        created_at: "2026-01-01T12:00:00Z",
        findings: [finding({ id: "f-b", start_line: 3 })],
      }),
      review({
        id: "r-summary",
        agent_id: "agent-c",
        kind: "summary",
        created_at: "2026-01-03T00:00:00Z",
        findings: [finding({ id: "f-summary", start_line: 42 })],
      }),
      review({
        id: "r-dismissed",
        agent_id: "agent-d",
        created_at: "2026-01-01T00:00:00Z",
        findings: [finding({ id: "f-dismissed", start_line: 77, dismissed_at: "2026-01-04T00:00:00Z" })],
      }),
    ];

    const result = latestFindingsPerAgent(reviews);
    const ids = result.map((f) => f.id).sort();
    expect(ids).toEqual(["f-a-new", "f-b"]);
  });

  it("the null agent is its own bucket, independent from a named agent", () => {
    const reviews: ReviewRecord[] = [
      review({ id: "r-named", agent_id: "agent-a", findings: [finding({ id: "f-named" })] }),
      review({ id: "r-null", agent_id: null, findings: [finding({ id: "f-null" })] }),
    ];
    const ids = latestFindingsPerAgent(reviews).map((f) => f.id).sort();
    expect(ids).toEqual(["f-named", "f-null"]);
  });

  it("returns [] for undefined reviews", () => {
    expect(latestFindingsPerAgent(undefined)).toEqual([]);
  });
});

describe("findingsByPath", () => {
  it("groups findings under their file path", () => {
    const findings = [
      finding({ id: "f1", file: "a.ts" }),
      finding({ id: "f2", file: "a.ts" }),
      finding({ id: "f3", file: "b.ts" }),
    ];
    const map = findingsByPath(findings);
    expect(map.get("a.ts")?.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(map.get("b.ts")?.map((f) => f.id)).toEqual(["f3"]);
  });
});

describe("groupFiles", () => {
  const files: PrFile[] = [
    { path: "src/app.ts", additions: 1, deletions: 0 },
    { path: "pnpm-lock.yaml", additions: 1, deletions: 0 },
    { path: "src/app.test.ts", additions: 1, deletions: 0 },
    { path: "docs/x.md", additions: 1, deletions: 0 },
  ];

  const smartDiff: SmartDiff = {
    groups: [
      { role: "core", files: [{ path: "src/app.ts", additions: 1, deletions: 0, finding_lines: [] }] },
      { role: "tests", files: [{ path: "src/app.test.ts", additions: 1, deletions: 0, finding_lines: [] }] },
      { role: "docs", files: [{ path: "docs/x.md", additions: 1, deletions: 0, finding_lines: [] }] },
      { role: "boilerplate", files: [{ path: "pnpm-lock.yaml", additions: 1, deletions: 0, finding_lines: [] }] },
    ],
    split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
  };

  it("always returns five groups, in ROLE_ORDER, with the response's roles applied", () => {
    const groups = groupFiles(files, smartDiff);
    expect(groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);
    expect(groups.find((g) => g.role === "boilerplate")?.files.map((f) => f.path)).toEqual(["pnpm-lock.yaml"]);
    expect(groups.find((g) => g.role === "wiring")?.files).toEqual([]);
  });

  it("a path missing from the response (or smartDiff undefined entirely) goes to core", () => {
    const withMissing = groupFiles(files, { ...smartDiff, groups: smartDiff.groups.slice(1) });
    expect(withMissing.find((g) => g.role === "core")?.files.map((f) => f.path)).toEqual(["src/app.ts"]);

    const withUndefined = groupFiles(files, undefined);
    expect(withUndefined.find((g) => g.role === "core")?.files.map((f) => f.path)).toEqual(
      files.map((f) => f.path),
    );
  });
});
