import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";

const updateAgent = vi.fn();
const refresh = vi.fn();
let installations: unknown[] = [];
const runs = [
  {
    id: "r1",
    ci_installation_id: "i1",
    pr_number: 7,
    ran_at: new Date().toISOString(),
    status: "succeeded",
    findings_count: 1,
    cost_usd: 0.02,
    github_url: "https://github.com/o/a/actions/runs/1",
    source: "ci",
    repo: "o/a",
    pr_title: "T",
    critical: 1,
    warning: 0,
    suggestion: 0,
  },
];

vi.mock("@/lib/hooks/ci", () => ({
  useAgentCi: () => ({ data: { installations, runs }, isLoading: false, isError: false, refetch: vi.fn() }),
  useRefreshCiRuns: () => ({ mutate: refresh }),
  useCiPreview: () => ({ data: undefined, isLoading: true }),
  useExportCi: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCiConfig: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useUpdateAgent: () => ({ mutate: updateAgent }) }));
vi.mock("@/lib/hooks/core", () => ({ useRepos: () => ({ data: [{ full_name: "o/a" }] }) }));

import { CiTab } from "./CiTab";

const agent = { id: "a1", name: "Sec", ci_fail_on: "warning" } as unknown as Agent;
const inst = (id: string, repo: string) => ({
  id,
  agent_id: "a1",
  repo,
  target_type: "gha",
  agent_version: 3,
  installed_at: "2026-01-01T00:00:00Z",
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  installations = [];
  updateAgent.mockClear();
  refresh.mockClear();
});

describe("CiTab", () => {
  it("lists installations with status, version and actions", () => {
    installations = [inst("i1", "o/a"), inst("i2", "o/b")];
    renderTab();
    expect(screen.getByText("CI deployment")).toBeInTheDocument();
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update CI config/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to CI/ })).toBeInTheDocument();
    expect(screen.getAllByText("GitHub Actions")).toHaveLength(2);
    expect(screen.getAllByText("Workflow v3")).toHaveLength(2);
    expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
    expect(screen.getByText(/Add repository/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledWith({ agent_id: "a1" });
  });

  it("binds Fail CI on to the agent and saves a change", () => {
    installations = [inst("i1", "o/a")];
    renderTab();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Critical", "Warning +", "Never"]);
    expect(screen.getByRole("radio", { name: "Warning +" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Never" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Never" }));
    expect(updateAgent).toHaveBeenCalledWith({ id: "a1", patch: { ci_fail_on: "never" } });
    expect(screen.getByText(/Takes effect in a repository after/)).toBeInTheDocument();
  });

  it("has no Agent column in the runs table", () => {
    installations = [inst("i1", "o/a")];
    renderTab();
    expect(screen.queryByRole("columnheader", { name: "Agent" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  });

  it("shows the empty state with an Add to CI call to action", () => {
    renderTab();
    expect(screen.getByText("Not in CI yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to CI" }));
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
  });
});
