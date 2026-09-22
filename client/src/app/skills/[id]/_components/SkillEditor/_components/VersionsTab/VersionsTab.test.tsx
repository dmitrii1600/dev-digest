import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const VERSIONS: SkillVersion[] = [
  {
    skill_id: "sk1",
    version: 3,
    body: "# Rubric\nCheck correctness.\nCheck tests.",
    note: "Tightened wording",
    created_at: "2026-09-18T10:00:00.000Z",
  },
  {
    skill_id: "sk1",
    version: 2,
    body: "# Rubric\nCheck correctness.",
    note: null,
    created_at: "2026-09-10T10:00:00.000Z",
  },
  {
    skill_id: "sk1",
    version: 1,
    body: "# Rubric\nCheck everything.",
    note: null,
    created_at: "2026-09-01T10:00:00.000Z",
  },
];

const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: "# Rubric\nCheck correctness.\nCheck tests.",
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 0,
  security: { status: "not_scanned", findings: [] },
};

afterEach(() => {
  cleanup();
  mutate.mockClear();
  vi.restoreAllMocks();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <VersionsTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("VersionsTab", () => {
  it("lists every version newest-first, marking only the highest as Current", () => {
    renderTab();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getAllByText(/^v\d$/)).toHaveLength(3);
    expect(screen.getByText("Tightened wording")).toBeInTheDocument();
    expect(screen.getAllByText("No note")).toHaveLength(2);
  });

  it("does not show a Restore button on the current version", () => {
    renderTab();
    expect(screen.getAllByText("Restore")).toHaveLength(2);
  });

  it("asks for confirmation and restores on confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTab();
    fireEvent.click(screen.getAllByText("Restore")[0]!);
    expect(window.confirm).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith({ id: "sk1", version: 2 }, expect.anything());
  });

  it("does nothing when the confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab();
    fireEvent.click(screen.getAllByText("Restore")[0]!);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows a Diff button on every row except the current one", () => {
    renderTab();
    expect(screen.getAllByText("Diff vs current")).toHaveLength(2);
    expect(screen.queryByText("Diff")).toBeNull();
  });

  it("expands a diff of that version against the CURRENT version, and collapses again", () => {
    renderTab();
    // v1 is the last row: relative to current (v3) it lacks "Check correctness."
    // and "Check tests." and has "Check everything." instead.
    fireEvent.click(screen.getAllByText("Diff vs current")[1]!);
    expect(screen.getByText("v1 → v3 — what the current version changed since this one")).toBeInTheDocument();
    expect(screen.getByText("Check everything.")).toBeInTheDocument();
    expect(screen.getByText("Check correctness.")).toBeInTheDocument();
    expect(screen.getByText("Check tests.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hide diff"));
    expect(screen.queryByText("Check everything.")).toBeNull();
  });

  it("shows only one diff at a time", () => {
    renderTab();
    fireEvent.click(screen.getAllByText("Diff vs current")[0]!);
    expect(screen.getByText("v2 → v3 — what the current version changed since this one")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Diff vs current")[0]!);
    expect(screen.queryByText("v2 → v3 — what the current version changed since this one")).toBeNull();
    expect(screen.getByText("v1 → v3 — what the current version changed since this one")).toBeInTheDocument();
  });

  it("diffs v2 against v3 as a single added line", () => {
    renderTab();
    fireEvent.click(screen.getAllByText("Diff vs current")[0]!);
    expect(screen.getByText("Check tests.")).toBeInTheDocument();
    expect(screen.queryByText("Check everything.")).toBeNull();
  });
});
