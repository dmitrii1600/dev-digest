import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseList, EvalCaseListItem, EvalDashboard, EvalSuiteRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/eval.json";
import shell from "../../../../../../../../messages/en/shell.json";

const state = vi.hoisted(() => ({
  cases: undefined as unknown,
  dashboard: undefined as unknown,
  start: vi.fn(),
  startError: null as Error | null,
  del: vi.fn(),
  caseRun: vi.fn(),
  caseRunError: null as Error | null,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalCases: () => ({ data: state.cases, isLoading: false, isError: false }),
  useAgentEvalDashboard: () => ({ data: state.dashboard }),
  useStartEvalRun: () => ({
    mutate: state.start,
    isPending: false,
    isError: state.startError !== null,
    error: state.startError,
  }),
  useDeleteEvalCase: () => ({ mutate: state.del, isPending: false }),
  useStartCaseRun: () => ({
    mutate: state.caseRun,
    isPending: false,
    variables: undefined,
    isError: state.caseRunError !== null,
    error: state.caseRunError,
  }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useEvalCaseRunState: () => ({ data: undefined }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(cleanup);

function caseItem(id: string, name: string, over: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id,
    owner_kind: "agent",
    owner_id: "ag1",
    name,
    expectation: "must_find",
    target: { file: "src/config.ts", start_line: 11, end_line: 11 },
    source: "finding",
    source_finding_id: `f-${id}`,
    fingerprint: `fp-${id}`,
    input_diff: "",
    input_files: null,
    input_meta: { pr_title: "t", pr_body: "" },
    expected_output: { title: name, severity: "HIGH", category: "bug" },
    created_at: "2026-10-05T10:00:00Z",
    last_result: "passed",
    latest_single: null,
    ...over,
  };
}

function caseList(cases: EvalCaseListItem[], passing: number): EvalCaseList {
  return { cases, passing, total: cases.length, latest_run_id: "run-2" };
}

function run(over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id: "run-2",
    kind: "suite",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_id: "ag1",
    agent_version: 2,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    error: null,
    skills: [],
    cases: [],
    cases_total: 3,
    cases_passed: 2,
    cases_errored: 0,
    metrics: { recall: 0.8, precision: null, citation_accuracy: 1 },
    duration_ms: 1000,
    cost_usd: 0.01,
    started_at: "2026-10-05T10:00:00Z",
    finished_at: "2026-10-05T10:00:01Z",
    ...over,
  };
}

function dashboard(over: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "ag1",
    owner_name: "Security Reviewer",
    cases_total: 3,
    current: {
      recall: 0.8,
      precision: null,
      citation_accuracy: 1,
      cases_passed: 2,
      cases_total: 3,
      cost_usd: 0.01,
    },
    delta: { recall: 3, precision: null, citation_accuracy: -2.5, cases_passed: -1 },
    trend: [],
    recent_runs: [],
    agents: [],
    running: null,
    regressions: [],
    alert: null,
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages, shell }}>
      <EvalsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.start.mockReset();
  state.startError = null;
  state.del.mockReset();
  state.caseRun.mockReset();
  state.caseRunError = null;
});

describe("EvalsTab", () => {
  it("lists each case with its result and file:line under an N / M passing count", () => {
    state.cases = caseList(
      [
        caseItem("c1", "Leaked key", { last_result: "passed" }),
        caseItem("c2", "Range case", {
          last_result: "failed",
          expectation: "must_not_flag",
          target: { file: "src/a.ts", start_line: 4, end_line: 9 },
        }),
        caseItem("c3", "Never ran", { last_result: "never_run" }),
        caseItem("c4", "Broke", { last_result: "errored" }),
      ],
      2,
    );
    state.dashboard = dashboard();
    renderTab();

    expect(screen.getByText("2 / 4 passing")).toBeInTheDocument();
    expect(screen.getByText("Leaked key")).toBeInTheDocument();
    expect(screen.getAllByText("must find · src/config.ts:11").length).toBeGreaterThan(0);
    expect(screen.getByText("must not flag · src/a.ts:4–9")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("errored")).toBeInTheDocument();
  });

  it("shows a dash for a null metric and a signed change on every tile, the pass tile in cases", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    renderTab();

    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("▲ +3.0 pts")).toBeInTheDocument();
    expect(screen.getByText("▼ −2.5 pts")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByText("▼ −1 cases")).toBeInTheDocument();
    // precision is null: value and change both read "—", never 0 %
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("disables Run with no cases and says why", () => {
    state.cases = caseList([], 0);
    state.dashboard = dashboard({ current: null, cases_total: 0 });
    renderTab();

    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    expect(
      screen.getByText("Add a case first: turn an accepted or dismissed finding into an eval case."),
    ).toBeInTheDocument();
    expect(screen.getByText(/No eval cases yet\./)).toBeInTheDocument();
  });

  it("starts a run, and while one is running disables the button and shows the running label", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(state.start).toHaveBeenCalledTimes(1);
    cleanup();

    state.dashboard = dashboard({ running: run({ status: "running" }) });
    renderTab();
    const button = screen.getByRole("button", { name: "Running…" });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run all evals" })).not.toBeInTheDocument();
  });

  it("confirms before deleting a case, then deletes it by id", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Delete eval case Leaked key" }));
    expect(screen.getByText("Delete eval case?")).toBeInTheDocument();
    expect(screen.getByText("Past runs keep their recorded result for this case.")).toBeInTheDocument();
    expect(state.del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(state.del).toHaveBeenCalledWith("c1", expect.anything());
  });

  it("EC-6: a 409 start shows no error (the running run takes over); any other failure is shown", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    state.startError = new ApiError("already running", 409, "eval_run_in_progress");
    renderTab();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    cleanup();

    state.startError = new ApiError("Agent has no eval cases", 422, "eval_set_empty");
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("Agent has no eval cases");
  });

  it("cancelling the delete confirmation deletes nothing", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete eval case Leaked key" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete eval case?")).not.toBeInTheDocument();
    expect(state.del).not.toHaveBeenCalled();
  });

  it("AC-6/AC-7/AC-13: rows carry an origin badge and a single-run marker beside the unchanged suite result", () => {
    state.cases = caseList(
      [
        caseItem("c1", "From a finding"),
        caseItem("c2", "Hand written", {
          source: "manual",
          source_finding_id: null,
          last_result: "failed",
          latest_single: { run_id: "r9", status: "passed", started_at: "2026-10-06T10:00:00Z" },
        }),
      ],
      1,
    );
    state.dashboard = dashboard();
    renderTab();
    expect(screen.getByText("from finding")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("single run: passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("New eval case opens the shared editor; Edit opens it with the case; closing a clean editor closes it", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "New eval case" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("New eval case");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit eval case Leaked key" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Eval case · Leaked key");
    expect(screen.getByLabelText("Name")).toHaveValue("Leaked key");
  });

  it("AC-9: a row's Run starts a single-case run of that case; a 409 says the case is already running", () => {
    state.cases = caseList([caseItem("c1", "Leaked key")], 1);
    state.dashboard = dashboard();
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run eval case Leaked key" }));
    expect(state.caseRun).toHaveBeenCalledWith({ caseId: "c1" });
    expect(state.start).not.toHaveBeenCalled();
    cleanup();

    state.caseRunError = new ApiError("already running", 409, "eval_case_run_in_progress");
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("This case is already running.");
  });
});
