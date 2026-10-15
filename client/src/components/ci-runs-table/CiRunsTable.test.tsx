import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import messages from "../../../messages/en/ci.json";
import { CiRunsTable } from "./CiRunsTable";

afterEach(cleanup);

const base: CiRun = {
  id: "c1",
  ci_installation_id: "i1",
  pr_number: 7,
  ran_at: new Date().toISOString(),
  status: "succeeded",
  findings_count: 3,
  cost_usd: 0.01,
  github_url: "https://github.com/o/r/actions/runs/1",
  source: "ci",
  agent: "Sec",
  duration_s: 4.2,
  repo: "o/r",
  pr_title: "Fix things",
  critical: 1,
  warning: 2,
  suggestion: 0,
};

function renderTable(runs: CiRun[], showAgent: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiRunsTable runs={runs} showAgent={showAgent} />
    </NextIntlClientProvider>,
  );
}

describe("CiRunsTable", () => {
  it("shows all nine columns with the agent column", () => {
    renderTable([base], true);
    for (const h of ["Timestamp", "Repository", "Pull request", "Agent", "Status", "Findings", "Cost", "Duration", "Job"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText("1 critical · 2 warning · 0 suggestion")).toBeInTheDocument();
  });

  it("omits the Agent column when showAgent is false", () => {
    renderTable([base], false);
    expect(screen.queryByRole("columnheader", { name: "Agent" })).toBeNull();
  });

  it("renders null cost as an em dash", () => {
    renderTable([{ ...base, cost_usd: null }], true);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("states a rejected result as text", () => {
    renderTable(
      [{ ...base, status: "failed", failure_reason: "result_rejected", critical: null, warning: null, suggestion: null, cost_usd: null }],
      true,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("result rejected")).toBeInTheDocument();
  });

  it("links the job safely", () => {
    renderTable([base], true);
    const a = screen.getByRole("link", { name: "View job" });
    expect(a).toHaveAttribute("href", "https://github.com/o/r/actions/runs/1");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });
});
