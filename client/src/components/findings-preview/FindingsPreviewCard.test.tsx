/**
 * FindingsPreviewCard — the PR-list hover preview.
 *
 * Two things are load-bearing and both are asserted here: the header wording
 * (it names the run the counts came from) and the fact that the card is
 * strictly read-only. Accept/Reject belong on the PR page, where a finding can
 * be read in full before it is acted on; a stray button in a hover card is a
 * mis-click waiting to happen.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsPreviewCard, clampLeft } from "./FindingsPreviewCard";
import { CARD_WIDTH } from "./styles";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal string starting with sk_live_.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function renderCard(findings: FindingRecord[], loading = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <div data-theme="dark">
        <FindingsPreviewCard findings={findings} top={10} left={10} loading={loading} />
      </div>
    </NextIntlClientProvider>,
  );
}

describe("FindingsPreviewCard", () => {
  it("names the run in the header and pluralises the count", () => {
    renderCard([finding({ id: "a" }), finding({ id: "b" })]);
    expect(screen.getByText("2 FINDINGS IN THIS RUN")).toBeInTheDocument();
  });

  it("uses the singular for exactly one finding", () => {
    renderCard([finding({ id: "a" })]);
    expect(screen.getByText("1 FINDING IN THIS RUN")).toBeInTheDocument();
  });

  it("shows title, category, file:line and confidence for each finding", () => {
    renderCard([finding({ id: "a" })]);
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
  });

  it("renders a line RANGE when the finding spans more than one line", () => {
    renderCard([
      finding({ id: "a", file: "src/api/public/webhooks.ts", start_line: 61, end_line: 74 }),
    ]);
    expect(screen.getByText("src/api/public/webhooks.ts:61-74")).toBeInTheDocument();
  });

  it("is strictly read-only — no buttons, no links anywhere in the card", () => {
    renderCard([finding({ id: "a" }), finding({ id: "b", severity: "WARNING" })]);
    const card = screen.getByRole("tooltip");
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
    expect(card.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("says so rather than rendering an empty card when a run found nothing", () => {
    renderCard([]);
    expect(screen.getByText("No findings in this run.")).toBeInTheDocument();
  });
});

describe("clampLeft", () => {
  it("keeps the card on screen when the column sits near the right edge", () => {
    expect(clampLeft(1200, 1280)).toBe(1280 - CARD_WIDTH - 8);
  });

  it("never runs off the left edge either", () => {
    expect(clampLeft(-50, 1280)).toBe(8);
  });

  it("leaves a comfortable anchor untouched", () => {
    expect(clampLeft(300, 1280)).toBe(300);
  });
});
