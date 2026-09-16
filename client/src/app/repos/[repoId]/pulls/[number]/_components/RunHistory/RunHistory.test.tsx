/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    findings_counts: null,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], reviews: ReviewRecord[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} reviews={reviews} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

function finding(id: string, severity: FindingRecord["severity"], title: string): FindingRecord {
  return {
    id,
    severity,
    category: "security",
    title,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

function review(runId: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id: `rev-${runId}`,
    pr_id: "pr1",
    agent_id: "a1",
    run_id: runId,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "comment",
    summary: "s",
    score: 61,
    model: "m",
    grounding: "1/1 passed",
    created_at: "2026-06-01T09:14:02.000Z",
    findings,
  } as ReviewRecord;
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — cost badge", () => {
  it("a settled run shows total tokens and cost", () => {
    renderRuns([
      run({ status: "done", tokens_in: 7891, tokens_out: 1228, cost_usd: 0.0013, blockers: 0 }),
    ]);
    expect(screen.getByText("9,119 tok · $0.0013")).toBeInTheDocument();
  });

  it("a settled run with no cost data shows '—', not '$0.00'", () => {
    renderRuns([run({ status: "done", tokens_in: 0, tokens_out: 0, cost_usd: null, blockers: 0 })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("a running run shows no badge at all — nothing is settled yet", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});

describe("timeline severity icons (criterion #16 — read-only)", () => {
  it("shows a count per severity that actually occurs, and omits the empty ones", () => {
    renderRuns([
      run({ findings_count: 3, findings_counts: { CRITICAL: 2, WARNING: 1, SUGGESTION: 0 } }),
    ]);
    expect(screen.getByTitle("Critical")).toHaveTextContent("2");
    expect(screen.getByTitle("Warning")).toHaveTextContent("1");
    expect(screen.queryByTitle("Suggestion")).toBeNull();
  });

  it("renders the icons as plain text, never as controls — the timeline does not filter", () => {
    renderRuns([
      run({ findings_count: 2, findings_counts: { CRITICAL: 2, WARNING: 0, SUGGESTION: 0 } }),
    ]);
    const chip = screen.getByTitle("Critical");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.closest("button")).toBeNull();
  });

  it("falls back to the plain count when the breakdown is unknown", () => {
    renderRuns([run({ findings_count: 4, findings_counts: null })]);
    expect(screen.getByText(/4 finding/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Critical")).toBeNull();
  });
});

describe("timeline hover preview", () => {
  const COUNTS = { CRITICAL: 1, WARNING: 1, SUGGESTION: 0 };
  const FINDINGS = [
    finding("f1", "CRITICAL", "Hardcoded Stripe secret key in commit"),
    finding("f2", "WARNING", "N+1 query in user list endpoint"),
  ];

  it("shows nothing until the icons are hovered", () => {
    renderRuns(
      [run({ run_id: "r1", findings_count: 2, findings_counts: COUNTS })],
      [review("r1", FINDINGS)],
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens the run's findings on hover, headed with the short title", () => {
    renderRuns(
      [run({ run_id: "r1", findings_count: 2, findings_counts: COUNTS })],
      [review("r1", FINDINGS)],
    );
    fireEvent.mouseEnter(screen.getByTitle("Critical").parentElement!);
    const card = screen.getByRole("tooltip");
    expect(within(card).getByText("2 FINDINGS")).toBeInTheDocument();
    expect(within(card).getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
  });

  it("previews only the hovered run's findings, not every review on the PR", () => {
    renderRuns(
      [run({ run_id: "r1", findings_count: 1, findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } })],
      [
        review("r1", [finding("f1", "CRITICAL", "Belongs to run one")]),
        review("r2", [finding("f2", "WARNING", "Belongs to run two")]),
      ],
    );
    fireEvent.mouseEnter(screen.getByTitle("Critical").parentElement!);
    const card = screen.getByRole("tooltip");
    expect(within(card).getByText("Belongs to run one")).toBeInTheDocument();
    expect(within(card).queryByText("Belongs to run two")).toBeNull();
  });

  it("opens nothing when the run has no review left to preview", () => {
    renderRuns([run({ run_id: "r1", findings_count: 2, findings_counts: COUNTS })], []);
    fireEvent.mouseEnter(screen.getByTitle("Critical").parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hovering does not make the icons clickable (criterion #16)", () => {
    renderRuns(
      [run({ run_id: "r1", findings_count: 2, findings_counts: COUNTS })],
      [review("r1", FINDINGS)],
    );
    const chip = screen.getByTitle("Critical");
    fireEvent.mouseEnter(chip.parentElement!);
    expect(chip.tagName).toBe("SPAN");
    expect(chip.closest("button")).toBeNull();
  });
});
