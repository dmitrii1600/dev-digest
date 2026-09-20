import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "House test-quality bar",
  type: "rubric",
  source: "manual",
  body: "# Rule\nOne assertion per test.",
  enabled: true,
  version: 3,
  evidence_files: null,
};

function renderTab(skill: Skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ConfigTab skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ConfigTab", () => {
  it("renders the form pre-filled from the skill", () => {
    renderTab();
    expect(screen.getByDisplayValue("PR quality rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("House test-quality bar")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("disables the note field until the body changes", () => {
    renderTab();
    const note = screen.getByPlaceholderText("e.g. Tightened the wording on rule 3");
    expect(note).toBeDisabled();
  });

  it("enables the note field once the body is edited, and saves it in the patch", () => {
    renderTab();
    const body = screen.getByDisplayValue(/One assertion per test/);
    fireEvent.change(body, { target: { value: "# Rule\nTwo assertions per test." } });

    const note = screen.getByPlaceholderText("e.g. Tightened the wording on rule 3");
    expect(note).not.toBeDisabled();
    fireEvent.change(note, { target: { value: "Loosened the rule" } });

    fireEvent.click(screen.getByText("Save"));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sk1",
        patch: expect.objectContaining({
          body: "# Rule\nTwo assertions per test.",
          note: "Loosened the rule",
        }),
      }),
      expect.anything(),
    );
  });

  it("does not send a note when only the name changes", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("PR quality rubric"), { target: { value: "Renamed rubric" } });
    fireEvent.click(screen.getByText("Save"));
    const patch = mutate.mock.calls[0]![0].patch;
    expect(patch.name).toBe("Renamed rubric");
    expect(patch.note).toBeUndefined();
  });

  it("resets the form when the skill id changes", () => {
    const { rerender } = renderTab();
    fireEvent.change(screen.getByDisplayValue("PR quality rubric"), { target: { value: "Scratch edit" } });
    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <ConfigTab skill={{ ...SKILL, id: "sk2", name: "Other skill" }} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByDisplayValue("Other skill")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Scratch edit")).toBeNull();
  });
});
