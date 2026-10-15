import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiReview.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

const h = vi.hoisted(() => ({
  push: vi.fn(),
  mutate: vi.fn(),
  agents: [] as unknown[],
  estimates: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/providers/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: { id: "r1" } }) }));
vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ id: "pr1", number: 482, title: "Add rate limiting" }] }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: h.agents }) }));
vi.mock("@/lib/hooks/multi-review", () => ({
  useAgentRunEstimates: () => ({ data: h.estimates }),
  useStartMultiReview: () => ({ mutateAsync: h.mutate, isPending: false }),
}));

import { ConfigureRunView } from "./ConfigureRunView";

const agent = (id: string, name: string, enabled = true) => ({ id, name, description: `${name} desc`, enabled });
const est = (id: string, ms: number | null, cost: number | null) => ({
  agent_id: id,
  sample_runs: 3,
  avg_duration_ms: ms,
  avg_cost_usd: cost,
});

beforeEach(() => {
  h.push.mockReset();
  h.mutate.mockReset().mockResolvedValue({ multi_run_id: "m1" });
  h.agents = [agent("a1", "Security Reviewer"), agent("a2", "Performance Reviewer"), agent("a3", "Off", false)];
  h.estimates = [est("a1", 6200, 0.012), est("a2", 7400, 0.014)];
});
afterEach(cleanup);

function renderIt() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiReview: messages }}>
      <ConfigureRunView />
    </NextIntlClientProvider>,
  );
}

const pickPr = () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "pr1" } });

describe("ConfigureRunView", () => {
  it("needs a PR first, then shows estimates, labels the run button by count and starts the run", async () => {
    renderIt();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "#482 · Add rate limiting" })).toBeInTheDocument();

    pickPr();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2); // disabled agent absent
    expect(screen.getByText("6.2s · $0.012")).toBeInTheDocument();
    expect(screen.getByText("≈ 7.4s · $0.026 · parallel fan-out")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Performance Reviewer/ }));
    expect(screen.getByRole("button", { name: "Run 1 agent" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Security Reviewer/ }));
    expect(screen.getByRole("button", { name: "Select agents" })).toBeDisabled();

    fireEvent.click(screen.getByRole("switch")); // Select all
    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    expect(h.mutate).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/multi-agent/m1"));
  });

  it("shows unknowns as dashes and never counts an unknown cost as zero", () => {
    h.estimates = [est("a1", 6200, null)];
    renderIt();
    pickPr();
    expect(screen.getByText("6.2s · —")).toBeInTheDocument();
    expect(screen.getByText("— · —")).toBeInTheDocument();
    expect(screen.getByText("≈ 6.2s · — · parallel fan-out")).toBeInTheDocument();
    expect(screen.getByText("Clear all")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Select all")).toBeInTheDocument();
  });

  it("shows the empty state when no agent is enabled", () => {
    h.agents = [agent("a3", "Off", false)];
    renderIt();
    pickPr();
    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(h.push).toHaveBeenCalledWith("/agents");
  });
});
