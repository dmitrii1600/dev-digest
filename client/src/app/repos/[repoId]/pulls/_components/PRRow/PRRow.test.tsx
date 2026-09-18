/**
 * PRRow — the FINDINGS column on the Pull Requests list.
 *
 * The column distinguishes three states that are easy to conflate: a PR with
 * findings (chips), a reviewed PR that came back clean (a real zero), and a PR
 * nobody has reviewed (an em dash). Collapsing the last two would claim a PR is
 * clean when in fact nothing has looked at it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const REVIEW = {
  id: "rev-1",
  kind: "review",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  findings: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key in commit",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      rationale: "A live key is committed.",
      suggestion: null,
      confidence: 0.98,
      kind: "finding",
      review_id: "rev-1",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

// The hook is lazily enabled: it is handed `null` until the row is hovered, so
// returning data only for a non-null id mirrors that contract exactly.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null) => ({
    data: prId ? [REVIEW] : undefined,
    isLoading: false,
  }),
}));

import { PRRow } from "./PRRow";

afterEach(() => {
  cleanup();
  push.mockClear();
});

/** The cell wrapping the chips is what carries the hover handlers. */
function findingsCell() {
  return chips()[0]!.parentElement!;
}

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-01T06:00:00.000Z",
    updated_at: "2026-06-01T06:00:00.000Z",
    score: 61,
    cost_usd: 0.014,
    findings_counts: null,
    ...o,
  } as PrMeta;
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <div data-theme="dark">
        <PRRow pr={meta} repoId="repo-1" />
      </div>
    </NextIntlClientProvider>,
  );
}

/** The severity chips are the buttons carrying aria-pressed. */
function chips() {
  return screen.queryAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
}

describe("FINDINGS column", () => {
  it("shows one chip per severity that occurs, with its count", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 2, WARNING: 2, SUGGESTION: 2 } }));
    expect(chips().map((c) => c.textContent)).toEqual(["2", "2", "2"]);
  });

  it("omits severities with no findings", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 1 } }));
    expect(chips()).toHaveLength(1);
  });

  it("renders a real zero for a review that found nothing", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }));
    expect(chips()).toHaveLength(0);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders an em dash — not a zero — when the PR was never reviewed", () => {
    renderRow(pr({ score: null, findings_counts: null }));
    expect(chips()).toHaveLength(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("chip interaction", () => {
  it("does not open the PR — filtering the preview is not navigation", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    fireEvent.click(chips()[0]!);
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the chip pressed once it filters the preview", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    fireEvent.click(chips()[0]!);
    expect(chips()[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("still navigates when the row itself is clicked", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    fireEvent.click(screen.getByText("Add rate limiting to public API endpoints"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });
});

describe("hover preview", () => {
  it("requests nothing and shows nothing until the cell is hovered", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens the preview on hover, headed for the run the counts came from", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    fireEvent.mouseEnter(findingsCell());
    const card = screen.getByRole("tooltip");
    expect(within(card).getByText("1 FINDING IN THIS RUN")).toBeInTheDocument();
    expect(within(card).getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
  });

  it("keeps the preview strictly read-only", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } }));
    fireEvent.mouseEnter(findingsCell());
    const card = screen.getByRole("tooltip");
    expect(card.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("narrows the preview when a chip is clicked, without navigating", () => {
    renderRow(pr({ findings_counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 0 } }));
    fireEvent.mouseEnter(findingsCell());
    // Click the WARNING chip — the mocked review holds only a CRITICAL, so the
    // filtered card must come back empty rather than ignoring the filter.
    fireEvent.click(chips()[1]!);
    expect(within(screen.getByRole("tooltip")).getByText("No findings in this run.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
