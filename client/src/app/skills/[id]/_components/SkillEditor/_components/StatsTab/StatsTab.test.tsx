import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

let statsResult: { data: SkillStats | undefined; isLoading: boolean; isError: boolean; refetch: () => void };
vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: () => statsResult,
}));

import { StatsTab } from "./StatsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  evidence_files: null,
};

afterEach(cleanup);

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("StatsTab", () => {
  it("renders — rather than 0% when nothing has been accepted or dismissed", () => {
    statsResult = {
      data: {
        agents: 2,
        runs_30d: 14,
        findings_30d: 0,
        accepted: 0,
        dismissed: 0,
        accept_rate: null,
        by_category: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderTab();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("formats a real accept rate as a rounded percentage", () => {
    statsResult = {
      data: {
        agents: 2,
        runs_30d: 14,
        findings_30d: 9,
        accepted: 7,
        dismissed: 3,
        accept_rate: 0.7,
        by_category: [{ category: "security", count: 4 }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderTab();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
  });

  it("states the agent-attribution caveat", () => {
    statsResult = {
      data: {
        agents: 1,
        runs_30d: 1,
        findings_30d: 0,
        accepted: 0,
        dismissed: 0,
        accept_rate: null,
        by_category: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderTab();
    expect(screen.getByText(/count runs of the agents this skill is attached to/)).toBeInTheDocument();
  });

  it("shows an error state with retry when the stats fail to load", () => {
    statsResult = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("Could not load usage stats.")).toBeInTheDocument();
  });
});
