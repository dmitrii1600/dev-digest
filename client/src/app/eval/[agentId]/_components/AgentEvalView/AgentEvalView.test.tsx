import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalSuiteRun } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
// recharts needs layout jsdom does not have; the chart's null handling is pinned in helpers.test.ts.
vi.mock("../MetricTrendChart", () => ({ MetricTrendChart: () => <div data-testid="trend" /> }));
vi.mock("../CompareRunsModal", () => ({ CompareRunsModal: () => null }));

const state = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: () => ({ data: state.data, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { AgentEvalView } from "./AgentEvalView";

afterEach(cleanup);

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

describe("AgentEvalView", () => {
  it("renders the tiles with signed changes, the regression banner and the runs table", () => {
    const dashboard: EvalDashboard = {
      owner_kind: "agent",
      owner_id: "ag1",
      owner_name: "Security Reviewer",
      cases_total: 5,
      current: { recall: 0.6, precision: 0.5, citation_accuracy: null, cases_passed: 3, cases_total: 5, cost_usd: 0.02 },
      delta: { recall: 10, precision: -30, citation_accuracy: null, cases_passed: -2 },
      trend: [],
      recent_runs: [RUN],
      agents: [],
      running: null,
      regressions: [{ metric: "precision", drop_points: 30 }],
      alert: null,
    };
    state.data = dashboard;
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <AgentEvalView agentId="ag1" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getAllByText("60.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
    expect(screen.getByText("▼ −30.0 pts")).toBeInTheDocument();
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.getByText("▼ −2 cases")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Precision dropped 30.0 pts since the previous run");
    expect(screen.getByTestId("trend")).toBeInTheDocument();
    expect(screen.getByText("v4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
  });
});
