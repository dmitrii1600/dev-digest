import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiReviewAgent, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiReview.json";
import { AgentColumn } from "./AgentColumn";

afterEach(cleanup);

function agent(run: Partial<RunSummary>): MultiReviewAgent {
  return {
    run: {
      run_id: "r1", agent_name: "Security Reviewer", status: "done", duration_ms: 6200, cost_usd: 0.012,
      score: 77, error: null, ...run,
    } as RunSummary,
    summary: null,
    findings: [
      {
        id: "f1", severity: "CRITICAL", category: "security", title: "Hardcoded secret", file: "src/config.ts",
        start_line: 11, end_line: 11, rationale: "r", suggestion: null, confidence: 0.9, kind: "finding",
        trifecta_components: null, evidence: null, review_id: "r", accepted_at: null, dismissed_at: null,
      } as MultiReviewAgent["findings"][number],
    ],
  };
}
const renderCol = (a: MultiReviewAgent, onViewTrace = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiReview: messages }}>
      <AgentColumn agent={a} onViewTrace={onViewTrace} />
    </NextIntlClientProvider>,
  );
  return onViewTrace;
};

describe("AgentColumn", () => {
  it("shows stats, severity text, location and a working View trace", () => {
    const onViewTrace = renderCol(agent({}));
    expect(screen.getByText("6.2s · $0.012")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View trace" }));
    expect(onViewTrace).toHaveBeenCalledWith("r1");
  });

  it("shows the error and keeps View trace for a failed run", () => {
    renderCol(agent({ status: "failed", error: "boom", cost_usd: null }));
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("6.2s · —")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View trace" })).toBeInTheDocument();
  });
});
