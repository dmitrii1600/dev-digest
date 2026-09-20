import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

const mutate = vi.fn();
const deleteMutate = vi.fn();
const createMutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
  useCreateSkill: () => ({ mutate: createMutate, isPending: false }),
  usePreviewSkillImport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  usePreviewSkillUrlImport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkillFromUrl: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
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
    agent_count: 2,
    security: { status: "not_scanned", findings: [] },
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
    agent_count: 0,
    security: { status: "clean", findings: [] },
  },
];

afterEach(() => {
  cleanup();
  push.mockClear();
  mutate.mockClear();
  deleteMutate.mockClear();
  createMutate.mockClear();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillsListView", () => {
  it("lists every skill with its type, source, version and agent-count badges", () => {
    renderView();
    expect(screen.getByText("PR quality rubric")).toBeInTheDocument();
    expect(screen.getByText("API contract convention")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getByText("0 agents")).toBeInTheDocument();
  });

  it("filters the grid by name/description", () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Search skills…"), { target: { value: "contract" } });
    expect(screen.queryByText("PR quality rubric")).toBeNull();
    expect(screen.getByText("API contract convention")).toBeInTheDocument();
  });

  it("never renders a skill body — the grid is tiles only", () => {
    renderView();
    expect(screen.queryByText("Write one assertion per test.")).toBeNull();
  });

  it("a card click opens the editor on its Config tab", () => {
    renderView();
    fireEvent.click(screen.getByText("PR quality rubric"));
    expect(push).toHaveBeenCalledWith("/skills/s1?tab=config");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles enabled from the card without navigating", () => {
    renderView();
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    expect(mutate).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } });
    expect(push).not.toHaveBeenCalled();
  });

  it("Add Skill opens the one modal with Create / From file / Import from URL tabs", () => {
    renderView();
    fireEvent.click(screen.getByText("Add Skill"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add skill")).toBeInTheDocument();
    expect(within(dialog).getByText("Create")).toBeInTheDocument();
    expect(within(dialog).getByText("From file")).toBeInTheDocument();
    expect(within(dialog).getByText("Import from URL")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("pr-quality-rubric")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Delete on a card asks for confirmation, then deletes — without navigating", () => {
    renderView();
    fireEvent.click(screen.getAllByLabelText("Delete skill")[1]!);
    expect(push).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete skill?")).toBeInTheDocument();
    expect(within(dialog).getByText(/"API contract convention"/)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("s2", expect.anything());
  });

  it("Cancel and the header X leave the skill alone", () => {
    renderView();
    fireEvent.click(screen.getAllByLabelText("Delete skill")[0]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Delete skill")[0]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});
