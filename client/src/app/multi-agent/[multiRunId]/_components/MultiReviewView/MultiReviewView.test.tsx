import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, MultiReviewAgent, MultiReviewDetail, RunSummary } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../messages/en/multiReview.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/run-trace-drawer", () => ({
  default: (p: { runId: string; running: boolean }) => (
    <div data-testid="drawer" data-run={p.runId} data-running={String(p.running)} />
  ),
}));
vi.mock("@/components/findings-panel", () => ({
  FindingsPanel: (p: { findings: { id: string }[] }) => (
    <div data-testid="panel" data-ids={p.findings.map((f) => f.id).join(",")} />
  ),
}));
const state = vi.hoisted(() => ({ data: undefined as unknown, error: null as unknown }));
vi.mock("@/lib/hooks/multi-review", () => ({
  useMultiReview: () => ({ data: state.data, error: state.error, isLoading: false, refetch: vi.fn() }),
}));

import { MultiReviewView } from "./MultiReviewView";

afterEach(cleanup);
beforeEach(() => {
  state.data = undefined;
  state.error = null;
});

function finding(id: string, file: string, line: number): FindingRecord {
  return {
    id, severity: "WARNING", category: "bug", title: `title ${id}`, file, start_line: line, end_line: line,
    rationale: "why", suggestion: null, confidence: 0.9, kind: "finding", trifecta_components: null,
    evidence: null, review_id: "r", accepted_at: null, dismissed_at: null,
  } as FindingRecord;
}
function agent(id: string, name: string, run: Partial<RunSummary>, findings: FindingRecord[] = []): MultiReviewAgent {
  return {
    run: {
      run_id: id, agent_id: `ag-${id}`, agent_name: name, provider: null, model: null, status: "done",
      error: null, duration_ms: 2000, tokens_in: 1, tokens_out: 1, cost_usd: 0.01,
      findings_count: findings.length, findings_counts: null, grounding: null,
      ran_at: "2026-10-11T10:00:00.000Z", score: 80, blockers: 0, multi_run_id: "m", ...run,
    } as RunSummary,
    summary: `summary of ${name}`,
    findings,
  };
}
function detail(agents: MultiReviewAgent[]): MultiReviewDetail {
  return { id: "m", pr: { id: "pr1", number: 482, title: "Fix the thing" }, ran_at: "2026-10-11T10:00:00.000Z", agents };
}
const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ multiReview: messages }}>
      <MultiReviewView id="m" />
    </NextIntlClientProvider>,
  );

describe("MultiReviewView", () => {
  it("shows header, meta, a failed column, and opens the trace drawer", () => {
    state.data = detail([
      agent("r1", "Security Reviewer", { duration_ms: 3000, cost_usd: 0.01 }, [finding("f1", "a.ts", 1)]),
      agent("r2", "Performance Reviewer", { duration_ms: 1000, cost_usd: 0.02 }),
      agent("r3", "General Reviewer", { status: "failed", error: "provider down", cost_usd: null, score: null }),
    ]);
    renderView();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute("href", "/multi-agent");
    expect(screen.getByRole("heading", { name: "Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByText("3 selected agents · parallel")).toBeInTheDocument();
    expect(screen.getByText("#482")).toBeInTheDocument();
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    expect(screen.getByText("3 agents · parallel fan-out · 3.0s total · $0.03")).toBeInTheDocument();
    expect(screen.getByText("provider down")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View trace" })).toHaveLength(3);

    fireEvent.click(screen.getAllByRole("button", { name: "View trace" })[2]!);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-run", "r3");
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-running", "false");
  });

  it("shows unknown cost as a dash and a running column as Running…", () => {
    state.data = detail([
      agent("r1", "Security Reviewer", { cost_usd: null }),
      agent("r2", "Performance Reviewer", { status: "running", duration_ms: null, cost_usd: null, score: null }),
    ]);
    renderView();
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.getByText(/2 agents · parallel fan-out · — total · —/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "View trace" })[1]!);
    expect(screen.getByTestId("drawer")).toHaveAttribute("data-running", "true");
  });

  it("switches to Tabs and shows the selected agent's findings", () => {
    state.data = detail([
      agent("r1", "Security Reviewer", {}, [finding("f1", "a.ts", 1)]),
      agent("r2", "Performance Reviewer", {}, [finding("f2", "b.ts", 1)]),
      agent("r3", "General Reviewer", {}),
    ]);
    renderView();
    const columns = screen.getByRole("button", { name: "Columns" });
    const tabsBtn = screen.getByRole("button", { name: "Tabs" });
    expect(columns).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tabsBtn);
    expect(tabsBtn).toHaveAttribute("aria-pressed", "true");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    fireEvent.click(tabs[1]!);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("summary of Performance Reviewer")).toBeInTheDocument();
    expect(within(panel).getByTestId("panel")).toHaveAttribute("data-ids", "f2");
  });

  it("shows the not-found state for a 404", () => {
    state.error = new ApiError("nope", 404);
    renderView();
    expect(screen.getByText("Multi-agent run not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute("href", "/multi-agent");
  });
});
