import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const deleteMutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { DeleteSkillConfirm } from "./DeleteSkillConfirm";

const SKILL: Skill = {
  id: "s2",
  name: "API contract convention",
  description: "",
  type: "security",
  source: "imported_file",
  body: "# Contract",
  enabled: false,
  version: 1,
  evidence_files: null,
  agent_count: 0,
  security: { status: "not_scanned", findings: [] },
};

afterEach(() => {
  cleanup();
  deleteMutate.mockReset();
});

function renderConfirm() {
  const onDeleted = vi.fn();
  const onCancel = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <DeleteSkillConfirm skill={SKILL} onDeleted={onDeleted} onCancel={onCancel} />
    </NextIntlClientProvider>,
  );
  return { onDeleted, onCancel };
}

describe("DeleteSkillConfirm", () => {
  it("names the skill, deletes on Confirm and reports back with the skill", () => {
    const { onDeleted } = renderConfirm();
    expect(screen.getByText("Delete skill?")).toBeInTheDocument();
    expect(screen.getByText(/"API contract convention"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("s2", expect.anything());
    act(() => deleteMutate.mock.calls[0]![1].onSuccess());
    expect(onDeleted).toHaveBeenCalledWith(SKILL);
  });

  it("Cancel and the header X both leave the skill alone", () => {
    const { onCancel } = renderConfirm();
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});
