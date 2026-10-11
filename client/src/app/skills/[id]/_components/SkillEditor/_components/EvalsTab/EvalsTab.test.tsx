import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseList, EvalCaseListItem, EvalDashboard, EvalSuiteRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import shell from "../../../../../../../../messages/en/shell.json";
import skillMessages from "../../../../../../../../messages/en/skills.json";

const state = vi.hoisted(() => ({
  cases: undefined as unknown,
  dashboard: undefined as unknown,
  linked: [] as { agent_id: string; agent_name: string; order: number; enabled: boolean }[],
  agents: [] as { id: string; name: string }[],
  startSuite: vi.fn(),
  startSuiteError: null as Error | null,
  caseRun: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useSkillEvalCases: () => ({ data: state.cases, isLoading: false, isError: false }),
  useSkillEvalDashboard: () => ({ data: state.dashboard }),
  useStartSkillEvalRun: () => ({
    mutate: state.startSuite,
    isPending: false,
    isError: state.startSuiteError !== null,
    error: state.startSuiteError,
  }),
  useStartCaseRun: () => ({ mutate: state.caseRun, isPending: false, variables: undefined, isError: false, error: null }),
  useDeleteEvalCase: () => ({ mutate: state.del, isPending: false }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useEvalCaseRunState: () => ({ data: undefined }),
}));
vi.mock("@/lib/hooks/skills", () => ({ useSkillAgents: () => ({ data: state.linked }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: state.agents }) }));

import { EvalsTab } from "./EvalsTab";

afterEach(cleanup);

function caseItem(id: string, name: string, over: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id,
    owner_kind: "skill",
    owner_id: "sk1",
    name,
    expectation: "must_find",
    target: { file: "src/config.ts", start_line: 11, end_line: 11 },
    source: "manual",
    source_finding_id: null,
    fingerprint: `fp-${id}`,
    input_diff: "",
    input_files: null,
    input_meta: { pr_title: "t", pr_body: "" },
    expected_output: { title: null, severity: null, category: null },
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
    owner_kind: "skill",
    owner_id: "sk1",
    agent_id: "ag2",
    agent_version: 4,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    error: null,
    skills: [{ skill_id: "sk1", name: "Rubric", version: 3 }],
    cases: [],
    cases_total: 2,
    cases_passed: 1,
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
    owner_kind: "skill",
    owner_id: "sk1",
    owner_name: "Rubric",
    cases_total: 2,
    current: { recall: 0.8, precision: null, citation_accuracy: 1, cases_passed: 1, cases_total: 2, cost_usd: 0.01 },
    delta: { recall: 3, precision: null, citation_accuracy: -2.5, cases_passed: -1 },
    trend: [],
    recent_runs: [run()],
    agents: [],
    running: null,
    regressions: [],
    alert: null,
    ...over,
  };
}

const LINKED = [
  { agent_id: "ag1", agent_name: "Security Reviewer", order: 0, enabled: true },
  { agent_id: "ag2", agent_name: "Style Reviewer", order: 1, enabled: true },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, skills: skillMessages, shell }}>
      <EvalsTab skillId="sk1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.startSuite.mockReset();
  state.startSuiteError = null;
  state.caseRun.mockReset();
  state.del.mockReset();
  state.linked = LINKED;
  state.agents = [
    { id: "ag1", name: "Security Reviewer" },
    { id: "ag2", name: "Style Reviewer" },
  ];
  state.cases = caseList([caseItem("c1", "Hand written"), caseItem("c2", "Other", { last_result: "failed" })], 1);
  state.dashboard = dashboard();
});

describe("skill EvalsTab", () => {
  it("AC-14/AC-16: same row content as the agent tab, and tiles with deltas and a latest-run line from the dashboard", () => {
    state.cases = caseList(
      [
        caseItem("c1", "Hand written", {
          latest_single: { run_id: "r9", status: "failed", started_at: "2026-10-06T10:00:00Z" },
        }),
        caseItem("c2", "From a finding", { source: "finding", last_result: "failed" }),
      ],
      1,
    );
    renderTab();
    expect(screen.getByText("1 / 2 passing")).toBeInTheDocument();
    expect(screen.getByText("Hand written")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByText("from finding")).toBeInTheDocument();
    expect(screen.getAllByText("must find · src/config.ts:11")).toHaveLength(2);
    expect(screen.getByText("single run: failed")).toBeInTheDocument();

    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("▲ +3.0 pts")).toBeInTheDocument();
    expect(screen.getByText("▼ −2.5 pts")).toBeInTheDocument();
    expect(screen.getByText("Latest run on Style Reviewer v4 · skill v3")).toBeInTheDocument();
  });

  it("a past host that is no longer an agent is named as such", () => {
    state.agents = [];
    renderTab();
    expect(screen.getByText("Latest run on an agent no longer linked v4 · skill v3")).toBeInTheDocument();
  });

  it("AC-15: Run all evals asks for a host (defaulting to the latest run's host) and starts the run on the chosen one", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(screen.getByText("Run on which agent?")).toBeInTheDocument();
    expect(screen.getByLabelText("Host agent")).toHaveValue("ag2");
    expect(state.startSuite).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Host agent"), { target: { value: "ag1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(state.startSuite).toHaveBeenCalledTimes(1);
    expect(state.startSuite).toHaveBeenCalledWith("ag1");
    expect(screen.queryByText("Run on which agent?")).not.toBeInTheDocument();
  });

  it("Q2: a row's Run opens the same picker and starts a single-case run on the chosen host", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run eval case Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(state.caseRun).toHaveBeenCalledTimes(1);
    expect(state.caseRun).toHaveBeenCalledWith({ caseId: "c2", hostAgentId: "ag2" });
    expect(state.startSuite).not.toHaveBeenCalled();
  });

  it("EC-10: with no linked agent Run all and every row Run are blocked and the reason is visible", () => {
    state.linked = [];
    renderTab();
    expect(screen.getByText("Link this skill to an agent first: running its evals needs a host agent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run eval case Other" }));
    expect(screen.queryByText("Run on which agent?")).not.toBeInTheDocument();
  });

  it("New eval case and Edit open the shared editor for a skill-owned case", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "New eval case" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("New eval case");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit eval case Hand written" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Hand written");
  });

  it("disables Run all with no cases or while a run is live; a 409 says the skill's evals are already running", () => {
    state.cases = caseList([], 0);
    renderTab();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
    cleanup();

    state.cases = caseList([caseItem("c1", "One")], 1);
    state.dashboard = dashboard({ running: run({ status: "running" }) });
    renderTab();
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    cleanup();

    state.dashboard = dashboard();
    state.startSuiteError = new ApiError("already running", 409, "eval_run_in_progress");
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("This skill’s evals are already running.");
  });

  it("confirms before deleting a case", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete eval case Other" }));
    expect(state.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(state.del).toHaveBeenCalledWith("c2", expect.anything());
  });
});
