import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

// Mock the data hooks so the tab renders without a network/query client.
// jsdom can't fire a real HTML5 drag — the drag path is covered by
// e2e/specs/09-skills.flow.json; this file covers the keyboard path, which is
// also the a11y story for reordering.
const setSkillsMutate = vi.fn();
const updateLinkMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkillLinks: () => ({ data: LINKS }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate }),
  useUpdateAgentSkillLink: () => ({ mutate: updateLinkMutate }),
}));

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setSkillsMutate.mockClear();
  updateLinkMutate.mockClear();
});

function skill(o: Partial<Skill> & Pick<Skill, "id" | "name" | "type">): Skill {
  return {
    description: "",
    source: "manual",
    body: "",
    enabled: true,
    version: 1,
    evidence_files: null,
    ...o,
  };
}

// 6 workspace skills; only 4 are linked to this agent, and one of those
// (Alpha) is unchecked, sitting between two checked ones — position is
// independent of enabled-ness.
const SKILLS: Skill[] = [
  skill({ id: "s1", name: "Alpha", type: "rubric" }),
  skill({ id: "s2", name: "Bravo", type: "convention" }),
  skill({ id: "s3", name: "Charlie", type: "security" }),
  skill({ id: "s4", name: "Delta", type: "custom" }),
  skill({ id: "s5", name: "Echo", type: "rubric" }),
  skill({ id: "s6", name: "Foxtrot", type: "convention" }),
];

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "s3", order: 0, enabled: true },
  { agent_id: "ag1", skill_id: "s1", order: 1, enabled: false },
  { agent_id: "ag1", skill_id: "s5", order: 2, enabled: true },
  { agent_id: "ag1", skill_id: "s2", order: 3, enabled: true },
];
// Merged row order: Charlie, Alpha, Echo, Bravo, then unlinked Delta, Foxtrot
// (name order).

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <SkillsTab agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("counts enabled bindings against every workspace skill", () => {
    renderTab();
    expect(screen.getByText("3 of 6 enabled")).toBeInTheDocument();
  });

  it("checking a row patches that binding's enabled flag", () => {
    renderTab();
    const row = screen.getByText("Alpha").closest("div")!;
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(updateLinkMutate).toHaveBeenCalledWith({ skillId: "s1", enabled: true });
  });

  it("filters the visible list by name", () => {
    renderTab();
    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), { target: { value: "ech" } });
    expect(screen.getByText("Echo")).toBeInTheDocument();
    expect(screen.queryByText("Charlie")).toBeNull();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Delta")).toBeNull();
  });

  it("reorders the whole list with the keyboard and dims unchecked rows", () => {
    renderTab();
    // Alpha (unchecked, between two checked rows) renders dimmed.
    const alphaRow = screen.getByText("Alpha").closest("div") as HTMLElement;
    expect(alphaRow.style.opacity).toBe("0.6");

    // Move Charlie (index 0) down one slot, past Alpha.
    fireEvent.keyDown(screen.getByLabelText("Reorder Charlie"), { key: "ArrowDown" });
    expect(setSkillsMutate).toHaveBeenCalledWith({
      skill_ids: ["s1", "s3", "s5", "s2", "s4", "s6"],
    });
  });
});
