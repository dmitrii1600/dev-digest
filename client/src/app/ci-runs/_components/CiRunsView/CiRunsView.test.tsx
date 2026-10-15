import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/ci.json";

const refreshMutate = vi.fn();
let runsData: unknown[] = [];
let refreshError = false;
let runsError = false;
let params = "";
const replace = vi.fn();
const refetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(params),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/hooks", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Sec" }] }),
  useRepos: () => ({ data: [{ id: "r1", full_name: "o/a" }] }),
}));
vi.mock("@/lib/hooks/ci", () => ({
  useCiRuns: (f: { agentId?: string }) => ({
    data: f.agentId === "a1" ? (runsData as { agent: string }[]).filter((r) => r.agent === "Sec") : runsData,
    isLoading: false,
    isError: runsError,
    refetch,
  }),
  useRefreshCiRuns: () => ({ mutate: refreshMutate, isPending: false, isError: refreshError }),
}));

import { CiRunsView } from "./CiRunsView";

const run = {
  id: "c1",
  ci_installation_id: "i1",
  pr_number: 7,
  ran_at: new Date().toISOString(),
  status: "succeeded",
  findings_count: 1,
  cost_usd: 0.01,
  github_url: "https://github.com/o/a/actions/runs/1",
  source: "ci",
  agent: "Sec",
  repo: "o/a",
  pr_title: "T",
  critical: 1,
  warning: 0,
  suggestion: 0,
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiRunsView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  runsData = [];
  refreshError = false;
  runsError = false;
  params = "";
  refreshMutate.mockClear();
  replace.mockClear();
  refetch.mockClear();
});

describe("CiRunsView", () => {
  it("renders the table, writes the agent filter to the URL and refreshes", () => {
    runsData = [run];
    renderView();
    expect(screen.getByText("CI Runs")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Agent" })).toBeInTheDocument();
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "a1" } });
    expect(replace).toHaveBeenCalledWith("/ci-runs?agent=a1");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshMutate).toHaveBeenCalledTimes(2);
  });

  it("shows only the selected agent's rows when the URL carries the filter", () => {
    runsData = [run, { ...run, id: "c2", pr_number: 8, pr_title: "U", agent: "Other" }];
    params = "agent=a1";
    renderView();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.queryByText("#8")).toBeNull();
  });

  it("says so when a filter matches nothing", () => {
    runsData = [{ ...run, agent: "Other" }];
    params = "agent=a1";
    renderView();
    expect(screen.getByText("No runs match these filters.")).toBeInTheDocument();
  });

  it("shows an error with retry when the runs query fails", () => {
    runsError = true;
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state linking to the agents list", () => {
    renderView();
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up CI for an agent" })).toHaveAttribute("href", "/agents");
  });

  it("keeps stored rows visible when the refresh fails", () => {
    runsData = [run];
    refreshError = true;
    renderView();
    expect(screen.getByText("Could not read CI runs from GitHub — showing stored runs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
  });
});
