import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import { formatRunDate } from "@/components/eval-metrics";
import messages from "../../../../../../messages/en/eval.json";

vi.mock("../CompareRunsModal", () => ({
  CompareRunsModal: ({ runIds }: { runIds: [string, string] }) => (
    <div role="dialog">{`comparing ${runIds[0]} and ${runIds[1]}`}</div>
  ),
}));

import { EvalRunsTable } from "./EvalRunsTable";

afterEach(cleanup);

function run(id: string, day: number, over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id,
    kind: "suite",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_id: "ag1",
    agent_version: 1,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    error: null,
    skills: [],
    cases: [],
    cases_total: 4,
    cases_passed: 3,
    cases_errored: 0,
    metrics: { recall: 0.75, precision: null, citation_accuracy: 1 },
    duration_ms: 1000,
    cost_usd: null,
    started_at: `2026-10-0${day}T10:00:00Z`,
    finished_at: `2026-10-0${day}T10:00:01Z`,
    ...over,
  };
}

const RUNS = [run("r1", 1), run("r2", 2), run("r3", 3), run("r4", 4, { status: "failed" })];

function renderTable(runs = RUNS) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalRunsTable agentId="ag1" runs={runs} />
    </NextIntlClientProvider>,
  );
}

const boxFor = (r: EvalSuiteRun) =>
  screen.getByRole("checkbox", { name: `Select run from ${formatRunDate(r.started_at)}` });

describe("EvalRunsTable", () => {
  it("enables Compare only at exactly two selected runs, then opens the comparison", () => {
    renderTable();
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    expect(screen.getByText("Select exactly two runs to compare.")).toBeInTheDocument();

    fireEvent.click(boxFor(RUNS[0]!));
    expect(compare).toBeDisabled();
    fireEvent.click(boxFor(RUNS[1]!));
    expect(compare).toBeEnabled();
    fireEvent.click(boxFor(RUNS[2]!));
    expect(compare).toBeDisabled();
    fireEvent.click(boxFor(RUNS[2]!));
    expect(compare).toBeEnabled();

    fireEvent.click(compare);
    expect(screen.getByRole("dialog")).toHaveTextContent("comparing r1 and r2");
  });

  it("shows null metrics and cost as a dash and gives a failed run no checkbox", () => {
    renderTable();
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
    // precision and cost are null in every row: "—", never 0
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2 * RUNS.length);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
