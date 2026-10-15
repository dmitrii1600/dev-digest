import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../../../../../messages/en/prReview.json";
import multiReview from "../../../../../../../../messages/en/multiReview.json";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  agents: [] as unknown[],
  runMutate: vi.fn(),
  multiMutate: vi.fn(),
  multiPending: false,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: h.agents }) }));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: h.runMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/multi-review", () => ({
  useAgentRunEstimates: () => ({
    data: [{ agent_id: "a1", sample_runs: 3, avg_duration_ms: 6200, avg_cost_usd: 0.01 }],
  }),
  useStartMultiReview: () => ({ mutateAsync: h.multiMutate, isPending: h.multiPending }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

const agent = (id: string, name: string, enabled = true) => ({ id, name, model: "gpt-4.1", enabled });

beforeEach(() => {
  h.push.mockReset();
  h.runMutate.mockReset().mockResolvedValue({ runs: [{ run_id: "r1" }] });
  h.multiMutate.mockReset().mockResolvedValue({ multi_run_id: "m1" });
  h.multiPending = false;
  h.agents = [agent("a1", "Security Reviewer"), agent("a2", "Performance Reviewer"), agent("a3", "Off", false)];
});
afterEach(cleanup);

function renderIt(props: Partial<React.ComponentProps<typeof RunReviewDropdown>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, multiReview }}>
      <RunReviewDropdown prId="pr1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown", () => {
  it("lists enabled agents checked, toggles Select all / Clear, runs one agent or many", async () => {
    renderIt();
    fireEvent.click(screen.getByText("Run Review"));

    expect(screen.getByText("PICK AGENTS TO RUN")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    boxes.forEach((b) => expect(b).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText("~6s")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // a2 has no estimate

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const none = screen.getByRole("button", { name: "Select an agent" });
    expect(none).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    // two checked → multi
    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    expect(h.multiMutate).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/multi-agent/m1"));

    // one checked → existing single-agent path
    const onRunsStarted = vi.fn();
    cleanup();
    renderIt({ onRunsStarted });
    fireEvent.click(screen.getByText("Run Review"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Performance Reviewer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Security Reviewer" }));
    expect(h.runMutate).toHaveBeenCalledWith({ prId: "pr1", agentId: "a1" });
    await waitFor(() => expect(onRunsStarted).toHaveBeenCalledWith(["r1"]));
  });

  it("disables the run button while a multi start is pending", async () => {
    h.multiPending = true;
    renderIt();
    // trigger shows loading; open anyway
    fireEvent.click(screen.getByText("Running…"));
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeDisabled();
  });

  it("shows the merged warning above the header and the no-agents empty state", async () => {
    renderIt({ warnMerged: true });
    fireEvent.click(screen.getByText("Run Review"));
    const warn = screen.getByText("Already merged — review is informational");
    const header = screen.getByText("PICK AGENTS TO RUN");
    expect(warn.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    cleanup();
    h.agents = [agent("a3", "Off", false)];
    renderIt();
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(h.push).toHaveBeenCalledWith("/agents");
  });
});
