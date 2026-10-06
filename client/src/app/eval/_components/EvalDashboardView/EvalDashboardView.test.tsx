import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalSuiteRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

const state = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useRunAllAgents: () => ({ mutate: vi.fn(), isPending: false, data: undefined, isError: false, error: null }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(cleanup);

function run(id: string, agentId: string, over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id,
    kind: "suite",
    owner_kind: "agent",
    owner_id: agentId,
    agent_id: agentId,
    agent_version: 3,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    error: null,
    skills: [],
    cases: [],
    cases_total: 4,
    cases_passed: 3,
    cases_errored: 0,
    metrics: { recall: 0.75, precision: 0.5, citation_accuracy: 1 },
    duration_ms: 1000,
    cost_usd: 0.0123,
    started_at: "2026-10-05T10:00:00Z",
    finished_at: "2026-10-05T10:00:01Z",
    ...over,
  };
}

function dashboard(over: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: null,
    owner_id: null,
    owner_name: null,
    cases_total: 0,
    current: null,
    delta: { recall: null, precision: null, citation_accuracy: null, cases_passed: null },
    trend: [],
    recent_runs: [],
    agents: [],
    running: null,
    regressions: [],
    alert: null,
    ...over,
  };
}

function renderView(notice?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView notice={notice} />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("shows one card per agent with model, version and a dash for an unavailable metric, then the recent runs", () => {
    const a1 = run("r1", "ag1", { agent_version: 3, metrics: { recall: 0.75, precision: null, citation_accuracy: 1 } });
    const a2 = run("r2", "ag2", { agent_version: 5, status: "partial", cases_passed: 1, cases_total: 2 });
    state.data = dashboard({
      cases_total: 6,
      agents: [
        { agent_id: "ag1", agent_name: "Security Reviewer", provider: "openai", model: "gpt-4.1", enabled: true, running: false, cases_total: 4, latest: a1 },
        { agent_id: "ag2", agent_name: "Style Reviewer", provider: "anthropic", model: "claude-x", enabled: true, running: false, cases_total: 2, latest: a2 },
      ],
      recent_runs: [a1, a2],
    });
    renderView();

    const link = screen.getByRole("link", { name: /Security Reviewer/ });
    expect(link).toHaveAttribute("href", "/eval/ag1");
    expect(within(link).getByText("gpt-4.1")).toBeInTheDocument();
    expect(within(link).getByText(/^v3 · /)).toBeInTheDocument();
    expect(within(link).getByText("75.0%")).toBeInTheDocument();
    expect(within(link).getByText("—")).toBeInTheDocument();
    expect(within(link).getByText("3/4 passed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Style Reviewer/ })).toHaveAttribute("href", "/eval/ag2");

    const rows = screen.getAllByRole("row");
    // header + two runs
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("completed")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Style Reviewer")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("partial")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("1/2")).toBeInTheDocument();
  });

  it("EC-11: shows the not-found notice for notice=agent_not_found, and ignores any other value", () => {
    state.data = dashboard();
    renderView("agent_not_found");
    expect(screen.getByRole("status")).toHaveTextContent("That agent was not found or has no eval cases.");
    cleanup();

    renderView("other");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("That agent was not found or has no eval cases.")).not.toBeInTheDocument();
  });

  it("EC-8: with no enabled agent that has cases, Run all agents is disabled and says why", () => {
    const a1 = run("r1", "ag1");
    state.data = dashboard({
      cases_total: 4,
      agents: [
        { agent_id: "ag1", agent_name: "Security Reviewer", provider: "openai", model: "gpt-4.1", enabled: false, running: false, cases_total: 4, latest: a1 },
      ],
      recent_runs: [a1],
    });
    renderView();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeDisabled();
    expect(screen.getByText("No enabled agent has eval cases.")).toBeInTheDocument();
  });

  it("AC-7: Run all agents opens the confirmation for the eligible agents", () => {
    const a1 = run("r1", "ag1");
    state.data = dashboard({
      cases_total: 4,
      agents: [
        { agent_id: "ag1", agent_name: "Security Reviewer", provider: "openai", model: "gpt-4.1", enabled: true, running: false, cases_total: 4, latest: a1 },
      ],
      recent_runs: [a1],
    });
    renderView();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("4 cases")).toBeInTheDocument();
    expect(within(dialog).getByText("4 paid review calls · estimated $0.012")).toBeInTheDocument();
  });

  it("explains where eval cases come from when no agent has one", () => {
    state.data = dashboard();
    renderView();
    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Eval cases are made from findings you accepted or dismissed. Open a pull request review and use “Turn into eval case”.",
      ),
    ).toBeInTheDocument();
  });
});
