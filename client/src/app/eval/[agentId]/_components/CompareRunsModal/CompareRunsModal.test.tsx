import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRunComparison, EvalSuiteRun } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

const state = vi.hoisted(() => ({
  comparison: undefined as unknown,
  versions: {} as Record<number, { data?: unknown; isError?: boolean }>,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalRunComparison: () => ({ data: state.comparison, isLoading: false, isError: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentVersion: (_agentId: string, version: number) => {
    const v = state.versions[version] ?? {};
    return { data: v.data, isError: !!v.isError };
  },
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(cleanup);

function run(id: string, version: number, over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id,
    kind: "suite",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_id: "ag1",
    agent_version: version,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    error: null,
    skills: [],
    cases: [],
    cases_total: 4,
    cases_passed: 3,
    cases_errored: 0,
    metrics: { recall: 0.5, precision: 0.8, citation_accuracy: null },
    duration_ms: 1000,
    cost_usd: 0.01,
    started_at: "2026-10-05T10:00:00Z",
    finished_at: "2026-10-05T10:00:01Z",
    ...over,
  };
}

function comparison(over: Partial<EvalRunComparison> = {}): EvalRunComparison {
  return {
    older: run("a", 1),
    newer: run("b", 2, { metrics: { recall: 0.6, precision: 0.5, citation_accuracy: null }, cost_usd: 0.02 }),
    deltas: { recall: 10, precision: -30, citation_accuracy: null, cost_usd: 0.01 },
    case_sets: { same: true, older_count: 4, newer_count: 4, edited_count: 0 },
    model_changed: false,
    skills_changed: false,
    ...over,
  };
}

function version(n: number, prompt: string) {
  return {
    agent_id: "ag1",
    version: n,
    created_at: "2026-10-05T10:00:00Z",
    config: { system_prompt: prompt },
  };
}

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <CompareRunsModal agentId="ag1" runIds={["a", "b"]} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.comparison = comparison();
  state.versions = {
    1: { data: version(1, "Be strict.\nReport bugs.") },
    2: { data: version(2, "Be strict.\nReport everything.") },
  };
});

describe("CompareRunsModal", () => {
  it("shows older → newer values with signed deltas as text, a dash for an unavailable metric", () => {
    renderModal();
    expect(screen.getByText("50.0% → 60.0%")).toBeInTheDocument();
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
    expect(screen.getByText("80.0% → 50.0%")).toBeInTheDocument();
    expect(screen.getByText("▼ −30.0 pts")).toBeInTheDocument();
    // citation is null on both sides: no value, no delta — never 0 %
    expect(screen.getByText("— → —")).toBeInTheDocument();
    expect(screen.getByText("+$0.01")).toBeInTheDocument();
    expect(screen.queryByText(/case sets differ/)).not.toBeInTheDocument();
  });

  it("warns when the case sets differ, and names a model or skill-set change", () => {
    state.comparison = comparison({
      case_sets: { same: false, older_count: 8, newer_count: 9, edited_count: 2 },
      model_changed: true,
      skills_changed: true,
    });
    renderModal();
    expect(
      screen.getByText("The case sets differ: older run 8 cases, newer run 9 cases, 2 edited."),
    ).toBeInTheDocument();
    expect(screen.getByText("Model changed between these runs.")).toBeInTheDocument();
    expect(screen.getByText("Skill set changed between these runs.")).toBeInTheDocument();
  });

  it("renders the system-prompt line diff from the two version snapshots", () => {
    renderModal();
    expect(screen.getByText("System prompt diff")).toBeInTheDocument();
    expect(screen.getByText("Report bugs.")).toBeInTheDocument();
    expect(screen.getByText("Report everything.")).toBeInTheDocument();
    expect(screen.getAllByText("Be strict.")).toHaveLength(1);
  });

  it("says so when the prompts are identical", () => {
    state.versions = { 1: { data: version(1, "Same") }, 2: { data: version(2, "Same") } };
    renderModal();
    expect(screen.getByText("System prompt unchanged.")).toBeInTheDocument();
  });

  it("keeps the deltas and says the diff is unavailable when a version snapshot cannot be read (EC-11)", () => {
    state.versions = { 1: { isError: true }, 2: { data: version(2, "x") } };
    renderModal();
    expect(
      screen.getByText("The system-prompt diff is unavailable: an agent-version snapshot could not be read."),
    ).toBeInTheDocument();
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
  });
});
