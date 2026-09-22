import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mutate = vi.fn();
const deleteMutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false }),
  useUpdateSkill: () => ({ mutate }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewSkillImport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  usePreviewSkillUrlImport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkillFromUrl: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { SkillsRail } from "./SkillsRail";

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "PR quality rubric",
    description: "House test-quality bar",
    type: "rubric",
    source: "manual",
    body: "# Rule",
    enabled: true,
    version: 3,
    evidence_files: null,
    agent_count: 2,
    security: { status: "not_scanned", findings: [] },
  },
  {
    id: "s2",
    name: "no-then-chains",
    description: "",
    type: "convention",
    source: "imported_file",
    body: "# No then",
    enabled: false,
    version: 1,
    evidence_files: null,
    agent_count: 0,
    security: { status: "clean", findings: [] },
  },
];

afterEach(() => {
  cleanup();
  push.mockClear();
  mutate.mockClear();
  deleteMutate.mockReset();
});

function renderRail(activeId = "s1", tab = "versions") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsRail activeId={activeId} tab={tab} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillsRail", () => {
  it("renders the same tiles as the grid: description, type, source, version and agent count", () => {
    renderRail();
    expect(screen.getByText("PR quality rubric")).toBeInTheDocument();
    expect(screen.getByText("House test-quality bar")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getAllByLabelText("Delete skill")).toHaveLength(2);
  });

  it("selecting another tile keeps the current tab", () => {
    renderRail("s1", "versions");
    fireEvent.click(screen.getByText("no-then-chains"));
    expect(push).toHaveBeenCalledWith("/skills/s2?tab=versions");
  });

  it("Add Skill opens the same three-tab modal as the grid", () => {
    renderRail();
    fireEvent.click(screen.getByText("Add Skill"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Create")).toBeInTheDocument();
    expect(within(dialog).getByText("From file")).toBeInTheDocument();
    expect(within(dialog).getByText("Import from URL")).toBeInTheDocument();
  });

  it("deleting the OPEN skill returns to the grid; deleting another one stays put", () => {
    renderRail("s1");
    fireEvent.click(screen.getAllByLabelText("Delete skill")[0]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("s1", expect.anything());
    act(() => deleteMutate.mock.calls[0]![1].onSuccess());
    expect(push).toHaveBeenCalledWith("/skills");

    push.mockClear();
    deleteMutate.mockReset();
    fireEvent.click(screen.getAllByLabelText("Delete skill")[1]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Delete"));
    act(() => deleteMutate.mock.calls[0]![1].onSuccess());
    expect(push).not.toHaveBeenCalled();
  });
});
