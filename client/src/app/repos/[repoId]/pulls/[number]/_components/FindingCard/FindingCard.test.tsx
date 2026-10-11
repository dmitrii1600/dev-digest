import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/reject actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    // The button reads "Reject" but the action stays `dismiss` — the label was
    // renamed, the API (`POST /findings/:id/dismiss`) and `dismissed_at` were not.
    fireEvent.click(screen.getByText("Reject"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case", () => {
  const NEEDS_DECISION = "Accept or dismiss this finding first to turn it into an eval case.";

  it("is enabled for an accepted finding and for a dismissed one, and fires the callback", () => {
    const onTurnIntoEval = vi.fn();
    renderWithIntl(
      <FindingCard
        f={{ ...FINDING, accepted_at: "2026-10-05T10:00:00Z" }}
        defaultExpanded
        evalAvailable
        onTurnIntoEval={onTurnIntoEval}
      />,
    );
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onTurnIntoEval).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NEEDS_DECISION)).not.toBeInTheDocument();
    cleanup();

    renderWithIntl(
      <FindingCard f={{ ...FINDING, dismissed_at: "2026-10-05T10:00:00Z" }} defaultExpanded evalAvailable />,
    );
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeEnabled();
  });

  it("is disabled with the accept-or-dismiss-first text for an undecided finding", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded evalAvailable />);
    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", NEEDS_DECISION);
    expect(screen.getByText(NEEDS_DECISION)).toBeInTheDocument();
  });

  it("is absent when evalAvailable is false or omitted", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, accepted_at: "2026-10-05T10:00:00Z" }} defaultExpanded />);
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
    cleanup();
    renderWithIntl(
      <FindingCard f={{ ...FINDING, accepted_at: "2026-10-05T10:00:00Z" }} defaultExpanded evalAvailable={false} />,
    );
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
  });

  it("confirms each outcome with its exact text", () => {
    const accepted = { ...FINDING, accepted_at: "2026-10-05T10:00:00Z" };
    const cases = [
      ["created", "Eval case created."],
      ["exists", "This finding is already an eval case."],
      ["too_large", "The diff is too large to freeze as an eval case."],
      ["error", "Could not create the eval case."],
    ] as const;
    for (const [status, text] of cases) {
      renderWithIntl(<FindingCard f={accepted} defaultExpanded evalAvailable evalStatus={status} />);
      expect(screen.getByRole("status")).toHaveTextContent(text);
      cleanup();
    }
  });
});
