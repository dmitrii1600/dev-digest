import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentCard, EvalRunAllResult, EvalSuiteRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../messages/en/eval.json";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  data: undefined as EvalRunAllResult | undefined,
  error: null as Error | null,
}));
vi.mock("@/lib/hooks/evals", () => ({
  useRunAllAgents: () => ({
    mutate: state.mutate,
    isPending: false,
    data: state.data,
    isError: state.error !== null,
    error: state.error,
  }),
}));

import { RunAllAgentsModal } from "./RunAllAgentsModal";

beforeEach(() => {
  state.mutate.mockReset();
  state.data = undefined;
  state.error = null;
});
afterEach(cleanup);

const card = (id: string, name: string, cases: number, cost: number | null | "never"): EvalAgentCard =>
  ({
    agent_id: id,
    agent_name: name,
    provider: "openai",
    model: "gpt-4.1",
    enabled: true,
    running: false,
    cases_total: cases,
    latest: cost === "never" ? null : ({ cost_usd: cost } as EvalSuiteRun),
  }) as EvalAgentCard;

const CARDS = [card("a", "Security Reviewer", 4, 0.02), card("b", "Style Reviewer", 2, "never")];

function renderModal(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <RunAllAgentsModal cards={CARDS} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("RunAllAgentsModal", () => {
  it("confirmation lists each agent with its case count and cost (a dash when never run), the paid calls and the estimate", () => {
    renderModal();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("4 cases")).toBeInTheDocument();
    expect(screen.getByText("2 cases")).toBeInTheDocument();
    expect(screen.getByText("$0.02")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("6 paid review calls · estimated $0.02")).toBeInTheDocument();
    expect(screen.getByText("1 agents have no cost estimate")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start runs" }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });

  it("after confirming, states each agent's outcome as text — started, or skipped with its reason", () => {
    state.data = {
      outcomes: [
        { agent_id: "a", agent_name: "Security Reviewer", status: "started", reason: null, run_id: "r1" },
        { agent_id: "b", agent_name: "Style Reviewer", status: "skipped", reason: "already_running", run_id: null },
        { agent_id: "c", agent_name: "Docs Reviewer", status: "skipped", reason: "no_cases", run_id: null },
        { agent_id: "d", agent_name: "Old Reviewer", status: "skipped", reason: "disabled", run_id: null },
      ],
    };
    renderModal();

    expect(screen.getByText("Security Reviewer: started")).toBeInTheDocument();
    expect(screen.getByText("Style Reviewer: skipped — already running")).toBeInTheDocument();
    expect(screen.getByText("Docs Reviewer: skipped — no cases")).toBeInTheDocument();
    expect(screen.getByText("Old Reviewer: skipped — disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start runs" })).not.toBeInTheDocument();
  });

  it("a second batch while one is starting (409) says so", () => {
    state.error = new ApiError("busy", 409, "eval_run_all_in_progress");
    renderModal();
    expect(screen.getByRole("alert")).toHaveTextContent("Another run of all agents is still starting.");
  });

  it("Escape, Cancel and the X close without calling the mutation", () => {
    const onClose = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
