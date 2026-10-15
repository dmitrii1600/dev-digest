import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, MultiReviewAgent, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiReview.json";
import { DisagreementBlock } from "./DisagreementBlock";

afterEach(cleanup);

function finding(id: string, file: string, line: number, end = line): FindingRecord {
  return {
    id, severity: "WARNING", category: "bug", title: `title ${id}`, file, start_line: line, end_line: end,
    rationale: `rationale ${id}`, suggestion: null, confidence: 0.9, kind: "finding",
    trifecta_components: null, evidence: null, review_id: "r", accepted_at: null, dismissed_at: null,
  } as FindingRecord;
}
function agent(name: string, findings: FindingRecord[], status = "done"): MultiReviewAgent {
  return {
    run: { run_id: name, agent_id: name, agent_name: name, status } as RunSummary,
    summary: null,
    findings,
  };
}
const renderBlock = (agents: MultiReviewAgent[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ multiReview: messages }}>
      <DisagreementBlock agents={agents} />
    </NextIntlClientProvider>,
  );

describe("DisagreementBlock", () => {
  it("renders a cell per selected agent, notes failures, expands, and filters conflicts", () => {
    renderBlock([
      agent("Alpha", [finding("a1", "x.ts", 10, 12), finding("a2", "y.ts", 5)]),
      agent("Beta", [finding("b1", "x.ts", 11), finding("b2", "y.ts", 5)]),
      agent("Gamma", [], "failed"),
    ]);
    // two locations (x.ts group, y.ts group), each with a cell for all three agents
    expect(screen.getAllByText("no result")).toHaveLength(2);
    expect(screen.queryByText("did not flag")).not.toBeInTheDocument();
    expect(screen.getAllByText("Alpha")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /title a1/ }));
    expect(screen.getByText("rationale a1")).toBeInTheDocument();
    expect(screen.getByText("lines 10–12")).toBeInTheDocument();

    // everyone completed agrees (WARNING) -> no conflict -> hidden when filtering
    fireEvent.click(screen.getByRole("switch", { name: /Show only conflicts/ }));
    expect(screen.queryByText("x.ts:10")).not.toBeInTheDocument();
  });

  it("keeps a flagged-vs-did-not-flag row and a group of one", () => {
    renderBlock([agent("Alpha", [finding("a1", "x.ts", 10)]), agent("Beta", [])]);
    expect(screen.getByText("did not flag")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /Show only conflicts/ }));
    expect(screen.getByText("x.ts:10")).toBeInTheDocument();
  });
});
