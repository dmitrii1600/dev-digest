/**
 * PrBrief helpers — the pure decisions behind the section: which review feeds
 * the banner (AC-13), what counts as a blocker, which body shows when several
 * states overlap (AC-12 / EC-3 / EC-5) and which `error.*` copy a failure maps
 * to (EC-3, EC-4, EC-10). Pure functions, so no render: `PrBrief.test.tsx`
 * covers the component, this file covers the branches it would never reach
 * with a single-review fixture.
 */
import { describe, it, expect } from "vitest";
import type { PrBriefResponse, ReviewRecord } from "@devdigest/shared";
import brief from "../../../../../../../../../../messages/en/brief.json";
import { blockersOf, briefView, costLine, errorCopyKey, latestReviewOf, shownBrief } from "./helpers";

type Severity = ReviewRecord["findings"][number]["severity"];

const finding = (id: string, severity: Severity, dismissed: boolean): ReviewRecord["findings"][number] => ({
  id,
  severity,
  category: "bug",
  title: "t",
  file: "src/a.ts",
  start_line: 1,
  end_line: 1,
  rationale: "r",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  review_id: "r",
  accepted_at: null,
  dismissed_at: dismissed ? "2026-10-02T09:00:00Z" : null,
});

const record = (id: string, kind: ReviewRecord["kind"], findings: ReviewRecord["findings"] = []): ReviewRecord => ({
  id,
  pr_id: "p1",
  agent_id: "a",
  run_id: "run",
  agent_name: "Sec",
  kind,
  verdict: "approve",
  summary: id,
  score: 90,
  model: "gpt-4.1",
  created_at: "2026-10-02T09:00:00Z",
  findings,
});

describe("latestReviewOf (AC-13)", () => {
  it("takes the first `review` record, skipping a newer `summary` row", () => {
    const reviews = [record("newest-summary", "summary"), record("newest-review", "review"), record("older-review", "review")];
    expect(latestReviewOf(reviews)?.id).toBe("newest-review");
  });

  it("is null when there is no review record at all", () => {
    expect(latestReviewOf(undefined)).toBeNull();
    expect(latestReviewOf([])).toBeNull();
    expect(latestReviewOf([record("only-summary", "summary")])).toBeNull();
  });
});

describe("blockersOf (AC-13)", () => {
  it("counts undismissed CRITICAL findings only", () => {
    const review = record("r", "review", [
      finding("a", "CRITICAL", false),
      finding("b", "CRITICAL", false),
      finding("c", "CRITICAL", true),
      finding("d", "WARNING", false),
      finding("e", "SUGGESTION", false),
    ]);
    expect(blockersOf(review)).toBe(2);
  });
});

describe("costLine", () => {
  it("shows a dash for each unknown half and never a zero", () => {
    expect(costLine({ cost_usd: null, tokens_in: 3120, tokens_out: 410 })).toBe("— 3.1K→410");
    expect(costLine({ cost_usd: 0.0094, tokens_in: null, tokens_out: 410 })).toBe("$0.0094 —");
    expect(costLine({ cost_usd: null, tokens_in: null, tokens_out: null })).toBe("— —");
  });
});

describe("briefView precedence (AC-12, EC-3, EC-5)", () => {
  const stored = { brief: {} as NonNullable<PrBriefResponse["brief"]>, stale: false, head_sha: "x", generating: false };
  const idle = { isPending: false, isError: false };

  it.each([
    ["a pending POST beats an error and a stored brief", stored, { isPending: true, isError: true }, "generating"],
    ["the server reporting generating beats an error", { ...stored, generating: true }, { ...idle, isError: true }, "generating"],
    ["an error beats a stored brief, which stays rendered below it", stored, { ...idle, isError: true }, "error"],
    ["a stored brief is ready", stored, idle, "ready"],
    ["no stored brief is empty", { ...stored, brief: null }, idle, "empty"],
    ["no data yet is empty", undefined, idle, "empty"],
  ] as const)("%s", (_label, data, mutation, expected) => {
    expect(briefView({ data, mutation })).toBe(expected);
  });
});

describe("shownBrief (AC-12, EC-3)", () => {
  const body = {} as NonNullable<PrBriefResponse["brief"]>;
  const stored = { brief: body, stale: false, head_sha: "x", generating: false };

  it("returns the stored brief when nothing is in flight", () => {
    expect(shownBrief({ data: stored, mutation: { isPending: false } })).toBe(body);
  });

  it("hides it while a POST is pending or the server reports generating", () => {
    expect(shownBrief({ data: stored, mutation: { isPending: true } })).toBeNull();
    expect(shownBrief({ data: { ...stored, generating: true }, mutation: { isPending: false } })).toBeNull();
  });

  it("is null without a stored brief", () => {
    expect(shownBrief({ data: { ...stored, brief: null }, mutation: { isPending: false } })).toBeNull();
    expect(shownBrief({ data: undefined, mutation: { isPending: false } })).toBeNull();
  });
});

describe("errorCopyKey (EC-3, EC-4, EC-10)", () => {
  it.each([
    ["brief_failed", { reason: "timeout" }, "timeout"],
    ["brief_failed", { reason: "invalid_output" }, "invalid_output"],
    ["brief_failed", { reason: "llm_error" }, "llm_error"],
    ["brief_failed", { reason: "something_new" }, "llm_error"],
    ["brief_failed", undefined, "llm_error"],
    ["brief_running", undefined, "brief_running"],
    ["no_changed_files", undefined, "no_changed_files"],
    ["provider_key_missing", { provider: "openai" }, "provider_key_missing"],
    ["brief_input_too_large", undefined, "brief_input_too_large"],
    ["some_other_code", undefined, "llm_error"],
    [undefined, undefined, "llm_error"],
  ])("code %s with %j reads %s", (code, details, expected) => {
    expect(errorCopyKey(code, details)).toBe(expected);
  });

  it("every key it can return has copy under error.* in brief.json", () => {
    const keys = ["timeout", "invalid_output", "llm_error", "brief_running", "no_changed_files", "provider_key_missing", "brief_input_too_large"];
    for (const key of keys) {
      expect(errorCopyKey(key === "timeout" || key === "invalid_output" || key === "llm_error" ? "brief_failed" : key, { reason: key })).toBe(key);
      expect((brief.error as Record<string, string>)[key], `error.${key}`).toBeTruthy();
    }
  });
});
