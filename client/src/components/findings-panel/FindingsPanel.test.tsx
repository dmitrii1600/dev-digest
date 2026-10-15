import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../messages/en/prReview.json";

const actionMutate = vi.hoisted(() => vi.fn());
vi.mock("../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: actionMutate, isPending: false }),
}));
const createCase = vi.hoisted(() => vi.fn());
const runCase = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("../../lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: createCase, isPending: false }),
  useStartCaseRun: () => ({ mutateAsync: runCase, isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
  const saved = (created = true) => ({ created, case: { id: "c1", owner_id: "a1" } });
  const open = () => {
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" evalAgentAvailable />);
    fireEvent.click(button());
  };
  const click = async (name: string) => {
    fireEvent.click(screen.getByRole("button", { name }));
    await act(async () => {});
  };

  beforeEach(() => {
    for (const m of [createCase, runCase, push, actionMutate]) m.mockReset();
  });

  it("EC-3: offers the action only when the review's agent still exists", () => {
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" />);
    expect(screen.queryByRole("button", { name: "Turn into eval case" })).not.toBeInTheDocument();
    cleanup();
    renderWithIntl(<FindingsPanel findings={ACCEPTED} prId="pr1" evalAgentAvailable />);
    expect(button()).toBeEnabled();
  });

  it("AC-1 / NFR-1: opens a dialog without any request, and Cancel sends nothing", async () => {
    open();
    expect(screen.getByRole("dialog", { name: "Create eval case" })).toBeInTheDocument();
    expect(createCase).not.toHaveBeenCalled();
    await click("Cancel");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createCase).not.toHaveBeenCalled();
    expect(runCase).not.toHaveBeenCalled();
  });

  it("AC-5 / EC-6: Save only creates once, closes, stays on the page, and says created or already existing", async () => {
    createCase.mockResolvedValueOnce(saved(true));
    open();
    await click("Save only");
    expect(createCase).toHaveBeenCalledTimes(1);
    expect(createCase).toHaveBeenCalledWith("f1");
    expect(runCase).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Eval case created.");

    createCase.mockResolvedValueOnce(saved(false));
    fireEvent.click(button());
    await click("Save only");
    expect(screen.getByRole("status")).toHaveTextContent("This finding is already an eval case.");
  });

  it("AC-6 / EC-6: Run creates, runs the returned case and opens the agent's Evals tab", async () => {
    createCase.mockResolvedValueOnce(saved(false));
    runCase.mockResolvedValueOnce({});
    open();
    await click("Run");
    expect(runCase).toHaveBeenCalledWith({ caseId: "c1" });
    expect(push).toHaveBeenCalledWith("/agents/a1?tab=evals");
  });

  it("EC-1: a second click while create is pending sends one request", async () => {
    let release!: (v: unknown) => void;
    createCase.mockReturnValueOnce(new Promise((r) => (release = r)));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(createCase).toHaveBeenCalledTimes(1);
    await act(async () => release(saved()));
  });

  it("EC-2: a failed create keeps the dialog open with the card message and re-enables the actions", async () => {
    createCase.mockRejectedValueOnce(new ApiError("big", 422, "eval_case_rejected", { reason: "diff_too_large" }));
    open();
    await click("Run");
    expect(screen.getByRole("alert")).toHaveTextContent("The diff is too large to freeze as an eval case.");
    expect(screen.getByRole("button", { name: "Save only" })).toBeEnabled();
    expect(runCase).not.toHaveBeenCalled();

    createCase.mockRejectedValueOnce(new ApiError("boom", 500, "internal"));
    await click("Save only");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create the eval case.");
    expect(runCase).not.toHaveBeenCalled();
  });

  it("EC-3: a failed run closes the dialog, stays on the page and says the run did not start", async () => {
    createCase.mockResolvedValueOnce(saved());
    runCase.mockRejectedValueOnce(new ApiError("boom", 500, "internal"));
    open();
    await click("Run");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Eval case saved, but the run did not start.");
  });

  it("EC-4: a 409 on the run counts as started", async () => {
    createCase.mockResolvedValueOnce(saved());
    runCase.mockRejectedValueOnce(new ApiError("running", 409, "conflict"));
    open();
    await click("Run");
    expect(push).toHaveBeenCalledWith("/agents/a1?tab=evals");
  });

  it("EC-7: a/d do nothing while the dialog is open and work again after Cancel", async () => {
    open();
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "d" });
    expect(actionMutate).not.toHaveBeenCalled();
    await click("Cancel");
    fireEvent.keyDown(window, { key: "a" });
    expect(actionMutate).toHaveBeenCalledTimes(1);
  });
});
