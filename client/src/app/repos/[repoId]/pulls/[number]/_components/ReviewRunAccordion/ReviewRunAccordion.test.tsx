/**
 * ReviewRunAccordion — the severity pills inside an expanded review run.
 *
 * The contract these tests pin down: a pill's number is the number of finding
 * cards it filters to. That holds because both are derived from the SAME
 * `review.findings` array, not from two computations that happen to agree — so
 * the pills cannot drift from the list the way a denormalized count would.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

function finding(id: string, severity: FindingRecord["severity"]): FindingRecord {
  return {
    id,
    severity,
    category: "bug",
    title: `${severity} finding ${id}`,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

function review(findings: FindingRecord[]): ReviewRecord {
  return {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "Two critical exposures.",
    score: 61,
    model: "gpt-4.1",
    grounding: "3/3 passed",
    created_at: "2026-06-01T09:14:02.000Z",
    findings,
  } as ReviewRecord;
}

function renderAccordion(findings: FindingRecord[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <div data-theme="dark">
        <ReviewRunAccordion review={review(findings)} prId="pr1" defaultOpen />
      </div>
    </NextIntlClientProvider>,
  );
}

/** The pills are the only buttons carrying aria-pressed; the label renders
 *  capitalised and is uppercased by CSS, so match case-insensitively. */
function pills() {
  return screen.queryAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
}
function pill(name: RegExp) {
  return pills().find((b) => name.test(b.textContent ?? ""))!;
}

/** Titles of the finding cards currently listed below the pills. */
function cardTitles() {
  return screen
    .queryAllByText(/^(CRITICAL|WARNING|SUGGESTION) finding /)
    .map((e) => e.textContent);
}

const MIXED = [
  finding("c1", "CRITICAL"),
  finding("c2", "CRITICAL"),
  finding("w1", "WARNING"),
  finding("s1", "SUGGESTION"),
];

describe("severity pills", () => {
  it("shows a pill per severity present, with its count", () => {
    renderAccordion(MIXED);
    expect(pill(/critical/i)).toHaveTextContent("2");
    expect(pill(/warning/i)).toHaveTextContent("1");
    expect(pill(/suggestion/i)).toHaveTextContent("1");
  });

  it("omits a severity that does not occur", () => {
    renderAccordion([finding("c1", "CRITICAL")]);
    expect(pill(/critical/i)).toBeTruthy();
    expect(pill(/warning/i)).toBeUndefined();
    expect(pills()).toHaveLength(1);
  });

  it("renders no pill row at all for a clean run", () => {
    renderAccordion([]);
    expect(pills()).toHaveLength(0);
  });

  it("each pill's number equals the cards it filters to", () => {
    renderAccordion(MIXED);
    fireEvent.click(pill(/critical/i));
    expect(cardTitles()).toHaveLength(2);
    expect(cardTitles().every((t) => t?.startsWith("CRITICAL"))).toBe(true);
  });

  it("clicking a second pill switches the filter rather than combining", () => {
    renderAccordion(MIXED);
    fireEvent.click(pill(/critical/i));
    fireEvent.click(pill(/warning/i));
    expect(cardTitles()).toEqual(["WARNING finding w1"]);
  });

  it("clicking the active pill again clears the filter and restores every finding", () => {
    renderAccordion(MIXED);
    expect(cardTitles()).toHaveLength(4);
    fireEvent.click(pill(/critical/i));
    expect(cardTitles()).toHaveLength(2);
    fireEvent.click(pill(/critical/i));
    expect(cardTitles()).toHaveLength(4);
  });

  it("marks the filtered pill pressed, so the state is not colour-only", () => {
    renderAccordion(MIXED);
    fireEvent.click(pill(/critical/i));
    expect(pill(/critical/i)).toHaveAttribute("aria-pressed", "true");
    expect(pill(/warning/i)).toHaveAttribute("aria-pressed", "false");
  });
});
