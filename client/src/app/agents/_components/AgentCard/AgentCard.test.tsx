import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentSkillLink } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";

// Mock the skill-links hook so the card's own "enabled skill count" query
// never hits the network in a component test, and the delete mutation so the
// confirm flow can be asserted without a server.
let skillLinks: AgentSkillLink[] | undefined;
const deleteMutate = vi.fn();
vi.mock("@/lib/hooks/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/agents")>();
  return {
    ...actual,
    useAgentSkillLinks: () => ({ data: skillLinks }),
    useDeleteAgent: () => ({ mutate: deleteMutate, isPending: false }),
  };
});

import { AgentCard } from "./AgentCard";

afterEach(() => {
  cleanup();
  skillLinks = undefined;
  deleteMutate.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentCard (smoke)", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={3} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("computes the skill count from enabled bindings when none is passed in", () => {
    skillLinks = [
      { agent_id: "ag1", skill_id: "sk1", order: 0, enabled: true },
      { agent_id: "ag1", skill_id: "sk2", order: 1, enabled: false },
      { agent_id: "ag1", skill_id: "sk3", order: 2, enabled: true },
    ];
    renderWithIntl(<AgentCard ag={AGENT} />);
    expect(screen.getByText("2 skills")).toBeInTheDocument();
  });

  it("shows no skill badge while the bindings haven't loaded yet", () => {
    skillLinks = undefined;
    renderWithIntl(<AgentCard ag={AGENT} />);
    expect(screen.queryByText(/skills$/)).toBeNull();
  });
});

describe("AgentCard delete", () => {
  it("opens the confirm modal without opening the agent, and deletes on Confirm", () => {
    const onClick = vi.fn();
    renderWithIntl(<AgentCard ag={AGENT} skillCount={0} onClick={onClick} />);
    fireEvent.click(screen.getByLabelText("Delete agent"));
    expect(onClick).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete agent?")).toBeInTheDocument();
    expect(within(dialog).getByText(/"Security Reviewer"/)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("ag1", expect.anything());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Cancel and the header X close the modal without deleting", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={0} />);
    fireEvent.click(screen.getByLabelText("Delete agent"));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByLabelText("Delete agent"));
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});
