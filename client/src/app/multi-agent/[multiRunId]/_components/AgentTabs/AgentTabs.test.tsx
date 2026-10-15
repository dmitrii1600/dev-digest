import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, MultiReviewAgent, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiReview.json";
import prReview from "../../../../../../messages/en/prReview.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartCaseRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { AgentTabs } from "./AgentTabs";

afterEach(cleanup);

const finding = (id: string, title: string): FindingRecord => ({
  id,
  severity: "WARNING",
  category: "security",
  title,
  file: "src/a.ts",
  start_line: 1,
  end_line: 1,
  rationale: "why",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rv",
  accepted_at: null,
  dismissed_at: null,
});

const mk = (
  id: string,
  name: string,
  run: Partial<RunSummary> = {},
  findings: FindingRecord[] = [],
): MultiReviewAgent => ({
  run: { run_id: id, agent_id: id, agent_name: name, status: "done", score: 90, duration_ms: 1000, cost_usd: 0.01, ...run } as RunSummary,
  summary: `sum ${name}`,
  findings,
});

describe("AgentTabs", () => {
  it("switches tabs and hands the selected agent's findings to FindingsPanel", () => {
    const onViewTrace = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ multiReview: messages, prReview }}>
        <AgentTabs
          prId="pr1"
          onViewTrace={onViewTrace}
          agents={[
            mk("r1", "Alpha", {}, [finding("f1", "Alpha issue")]),
            mk("r2", "Beta", { status: "failed", error: "bad" }, [finding("f2", "Beta issue")]),
          ]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText("sum Alpha")).toBeInTheDocument();
    expect(screen.getByText("Alpha issue")).toBeInTheDocument();
    expect(screen.queryByText("Beta issue")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Beta/ }));
    expect(screen.getByText("sum Beta")).toBeInTheDocument();
    expect(screen.getByText("bad")).toBeInTheDocument();
    expect(screen.getByText("Beta issue")).toBeInTheDocument();
    expect(screen.queryByText("Alpha issue")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View trace" }));
    expect(onViewTrace).toHaveBeenCalledWith("r2");
  });
});
