import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

import { AgentSwitcher } from "./AgentSwitcher";

afterEach(() => {
  cleanup();
  nav.push.mockReset();
});

const AGENTS = [
  { agent_id: "ag1", agent_name: "General Reviewer" },
  { agent_id: "ag2", agent_name: "Security Reviewer" },
];

describe("AgentSwitcher", () => {
  it("lists the agents by name and pushes the picked agent's page with the current window", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <AgentSwitcher agents={AGENTS} agentId="ag1" window="7d" />
      </NextIntlClientProvider>,
    );

    const select = screen.getByRole("combobox", { name: "Agent" });
    expect(select).toHaveValue("ag1");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["General Reviewer", "Security Reviewer"]);

    // a native select: reachable by keyboard, announced as "Agent"
    select.focus();
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: "ag2" } });
    expect(nav.push).toHaveBeenCalledWith("/eval/ag2?window=7d");
  });
});
