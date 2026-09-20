import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillStats: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
}));

import { SkillEditor } from "./SkillEditor";

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "House test-quality bar",
  type: "rubric",
  source: "manual",
  body: "# Rule\nOne assertion per test.",
  enabled: true,
  version: 1,
  evidence_files: null,
};

afterEach(cleanup);

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor (smoke)", () => {
  it("renders the Config tab fields by default", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("renders the read-only Preview tab", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="preview" onTab={() => {}} />);
    expect(screen.getByText("One assertion per test.")).toBeInTheDocument();
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("renders the Versions tab", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="versions" onTab={() => {}} />);
    expect(screen.getByText("No versions yet.")).toBeInTheDocument();
  });

  it("renders the Stats tab (loading skeleton, since the mocked hook is pending)", () => {
    const { container } = renderWithIntl(<SkillEditor skill={SKILL} tab="stats" onTab={() => {}} />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("shows the four tab labels", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Versions")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
  });
});
