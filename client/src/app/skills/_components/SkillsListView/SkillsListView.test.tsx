import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate }),
}));

import { SkillsListView } from "./SkillsListView";

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "PR quality rubric",
    description: "House test-quality bar",
    type: "rubric",
    source: "manual",
    body: "# Rule\nWrite one assertion per test.",
    enabled: true,
    version: 2,
    evidence_files: null,
  },
  {
    id: "s2",
    name: "API contract convention",
    description: "Imported from the security team's repo",
    type: "security",
    source: "imported_file",
    body: "# Contract\nNever break a public response shape.",
    enabled: false,
    version: 1,
    evidence_files: null,
  },
];

afterEach(() => {
  cleanup();
  push.mockClear();
  mutate.mockClear();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillsListView />
    </NextIntlClientProvider>,
  );
}

describe("SkillsListView", () => {
  it("lists every skill with its type and source badge", () => {
    renderView();
    expect(screen.getByText("PR quality rubric")).toBeInTheDocument();
    expect(screen.getByText("API contract convention")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("filters the rail by name/description", () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Search skills…"), { target: { value: "contract" } });
    expect(screen.queryByText("PR quality rubric")).toBeNull();
    expect(screen.getByText("API contract convention")).toBeInTheDocument();
  });

  it("opens the editor in edit mode when a card is clicked", () => {
    renderView();
    fireEvent.click(screen.getByText("PR quality rubric"));
    expect(push).toHaveBeenCalledWith("/skills/s1?tab=config");
  });

  it("does not render a skill body — that lives behind the editor's Preview tab", () => {
    renderView();
    expect(screen.queryByText("Write one assertion per test.")).toBeNull();
  });
});
