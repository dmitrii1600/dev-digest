import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
const evalMutate = vi.hoisted(() => vi.fn());
vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutate: evalMutate, isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — Turn into eval case", () => {
  const ACCEPTED: FindingRecord[] = [{ ...FINDINGS[0]!, accepted_at: "2026-10-05T10:00:00Z" }];
  const button = () => screen.getByRole("button", { name: "Turn into eval case" });

  /** Make the mocked mutation answer the next click the way the API would. */
  const answer = (settle: (opts: { onSuccess: (r: unknown) => void; onError: (e: unknown) => void }) => void) =>
    evalMutate.mockImplementation((_id, opts) => act(() => settle(opts)));

  it("EC-3: offers the action only when the review's agent still exists", () => {
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" />);
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
    cleanup();
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" evalAgentAvailable />);
    expect(button()).toBeEnabled();
  });

  it("AC-2 / EC-2: sends the finding id, then confirms a new case and an already existing one", () => {
    evalMutate.mockReset();
    answer((o) => o.onSuccess({ case: {}, created: true }));
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" evalAgentAvailable />);
    fireEvent.click(button());
    expect(evalMutate).toHaveBeenCalledWith("f1", expect.anything());
    expect(screen.getByRole("status")).toHaveTextContent("Eval case created.");

    answer((o) => o.onSuccess({ case: {}, created: false }));
    fireEvent.click(button());
    expect(screen.getByRole("status")).toHaveTextContent("This finding is already an eval case.");
  });

  it("EC-12: a 422 diff_too_large says the diff is too large; any other failure is generic", () => {
    evalMutate.mockReset();
    answer((o) => o.onError(new ApiError("big", 422, "eval_case_rejected", { reason: "diff_too_large" })));
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" evalAgentAvailable />);
    fireEvent.click(button());
    expect(screen.getByRole("status")).toHaveTextContent("The diff is too large to freeze as an eval case.");

    answer((o) => o.onError(new ApiError("boom", 500, "internal")));
    fireEvent.click(button());
    expect(screen.getByRole("status")).toHaveTextContent("Could not create the eval case.");
  });
});
