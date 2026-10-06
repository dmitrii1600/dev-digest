import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalSuiteRun, EvalTrendPoint } from "@devdigest/shared";
import { formatRunDate } from "@/components/eval-metrics";
import messages from "../../../../../../messages/en/eval.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
// recharts needs layout jsdom does not have; the chart's null handling is pinned in its own tests.
vi.mock("@/components/eval-metrics", async (orig) => ({
  ...(await orig<typeof import("@/components/eval-metrics")>()),
  MetricTrendChart: (p: { trend: { run_id: string }[] }) => (
    <div data-testid="trend" data-ids={p.trend.map((x) => x.run_id).join(",")} />
  ),
}));
vi.mock("../CompareRunsModal", () => ({ CompareRunsModal: () => null }));
vi.mock("../AgentSwitcher", () => ({ AgentSwitcher: () => <div data-testid="switcher" /> }));

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  runs: undefined as unknown,
  workspace: undefined as unknown,
  agent: { version: 5 } as { version: number } | undefined,
  search: "",
  runsHook: vi.fn(),
  start: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace, push: state.push }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgent: () => ({ data: state.agent }) }));
vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentEvalRuns: (id: string, opts?: { since?: string }) => {
    state.runsHook(id, opts);
    return { data: state.runs };
  },
  useEvalDashboard: () => ({ data: state.workspace, isFetching: false }),
  useStartEvalRun: () => ({ mutate: state.start, isPending: false, isError: false, error: null }),
}));

import { AgentEvalView } from "./AgentEvalView";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const DAY = 24 * 3600 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.search = "";
  state.agent = { version: 5 };
  state.runs = [];
  state.workspace = { agents: [{ agent_id: "ag1", agent_name: "Security Reviewer" }] };
  state.runsHook.mockReset();
  state.start.mockReset();
  state.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const RUN: EvalSuiteRun = {
  id: "r2",
  kind: "suite",
  owner_kind: "agent",
  owner_id: "ag1",
  agent_id: "ag1",
  agent_version: 4,
  provider: "openai",
  model: "gpt-4.1",
  status: "completed",
  error: null,
  skills: [],
  cases: [],
  cases_total: 5,
  cases_passed: 3,
  cases_errored: 0,
  metrics: { recall: 0.6, precision: 0.5, citation_accuracy: null },
  duration_ms: 1000,
  cost_usd: 0.02,
  started_at: "2026-10-05T10:00:00Z",
  finished_at: "2026-10-05T10:00:01Z",
};

const point = (id: string, ranAt: string): EvalTrendPoint => ({
  run_id: id,
  ran_at: ranAt,
  agent_version: 4,
  recall: 0.5,
  precision: 0.5,
  citation_accuracy: 1,
  pass_rate: 0.5,
  cases_passed: 1,
  cases_total: 2,
  cost_usd: null,
});

function dashboard(over: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "ag1",
    owner_name: "Security Reviewer",
    cases_total: 4,
    current: { recall: 0.6, precision: 0.5, citation_accuracy: null, cases_passed: 3, cases_total: 5, cost_usd: 0.02 },
    delta: { recall: 10, precision: -30, citation_accuracy: null, cases_passed: -2 },
    trend: [],
    recent_runs: [RUN],
    agents: [],
    running: null,
    regressions: [{ metric: "precision", drop_points: 30 }],
    alert: null,
    ...over,
  };
}

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <AgentEvalView agentId="ag1" />
    </NextIntlClientProvider>,
  );

describe("AgentEvalView", () => {
  it("renders the tiles with signed changes, the banner, the version and the runs table; the runs hook gets a 30-day since by default", () => {
    state.data = dashboard();
    state.runs = [RUN];
    renderView();

    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("Current version v5")).toBeInTheDocument();
    expect(screen.getAllByText("60.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
    expect(screen.getByText("▼ −30.0 pts")).toBeInTheDocument();
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Precision dropped 30.0 pts since the previous run");
    expect(screen.getByText("v4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Time window" })).toHaveValue("30d");
    expect(state.runsHook).toHaveBeenLastCalledWith("ag1", {
      since: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    });
  });

  it("AC-10/AC-11: the trend follows the window (the bound is inside, 1 ms earlier is out); the tiles keep the unfiltered dashboard", () => {
    state.search = "window=7d";
    const bound = new Date(NOW.getTime() - 7 * DAY);
    state.data = dashboard({
      trend: [
        point("old", new Date(bound.getTime() - 1).toISOString()),
        point("edge", bound.toISOString()),
        point("new", "2026-10-05T10:00:00Z"),
      ],
    });
    state.runs = [RUN];
    renderView();

    expect(screen.getByTestId("trend")).toHaveAttribute("data-ids", "edge,new");
    expect(state.runsHook).toHaveBeenLastCalledWith("ag1", { since: bound.toISOString() });
    // tiles still show the latest runs, not a windowed subset
    expect(screen.getAllByText("60.0%").length).toBeGreaterThan(0);
    expect(screen.getByRole("combobox", { name: "Time window" })).toHaveValue("7d");
  });

  it("EC-10: an empty window says so, keeps the tiles, and Show all runs switches to window=all", () => {
    state.search = "window=7d";
    state.data = dashboard({ trend: [point("old", "2026-01-01T00:00:00Z")] });
    state.runs = [];
    renderView();

    expect(screen.getByText("No runs in this time window.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend")).not.toBeInTheDocument();
    expect(screen.getAllByText("60.0%").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Show all runs" }));
    expect(state.replace).toHaveBeenCalledWith("/eval/ag1?window=all");
  });

  it("changing the window replaces the URL, keeping the agent", () => {
    state.data = dashboard();
    state.runs = [RUN];
    renderView();
    fireEvent.change(screen.getByRole("combobox", { name: "Time window" }), { target: { value: "90d" } });
    expect(state.replace).toHaveBeenCalledWith("/eval/ag1?window=90d");
  });

  it("EC-11: an agent that is not in the workspace's eval agents goes back to the landing with a notice", () => {
    state.data = dashboard();
    state.workspace = { agents: [{ agent_id: "other", agent_name: "Other" }] };
    renderView();
    expect(state.replace).toHaveBeenCalledWith("/eval?notice=agent_not_found");
    cleanup();

    state.replace.mockReset();
    state.workspace = { agents: [{ agent_id: "ag1", agent_name: "Security Reviewer" }] };
    renderView();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("AC-6: Run eval (4) starts a suite run", () => {
    state.data = dashboard();
    state.runs = [RUN];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Run eval (4)" }));
    expect(state.start).toHaveBeenCalledTimes(1);
    cleanup();

    state.data = dashboard({ running: { ...RUN, status: "running" } });
    renderView();
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
  });

  it("AC-12: switching to another agent clears the run selection and keeps the window", () => {
    state.search = "window=7d";
    state.data = dashboard();
    state.workspace = {
      agents: [
        { agent_id: "ag1", agent_name: "Security Reviewer" },
        { agent_id: "ag2", agent_name: "General Reviewer" },
      ],
    };
    const second: EvalSuiteRun = { ...RUN, id: "r1", started_at: "2026-10-04T10:00:00Z" };
    state.runs = [RUN, second];
    const ui = (id: string) => (
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <AgentEvalView agentId={id} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui("ag1"));
    const box = (r: EvalSuiteRun) =>
      screen.getByRole("checkbox", { name: `Select run from ${formatRunDate(r.started_at)}` });

    fireEvent.click(box(RUN));
    fireEvent.click(box(second));
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();

    // The route re-renders the same view with the new id (the switcher pushes /eval/<id>?window=7d).
    rerender(ui("ag2"));
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    expect(box(RUN)).not.toBeChecked();
    expect(box(second)).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Time window" })).toHaveValue("7d");
    expect(state.runsHook).toHaveBeenLastCalledWith("ag2", { since: expect.any(String) });
  });
});
