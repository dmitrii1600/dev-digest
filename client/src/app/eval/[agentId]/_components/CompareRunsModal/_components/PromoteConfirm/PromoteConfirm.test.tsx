import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import eval_ from "../../../../../../../../messages/en/eval.json";
import agents from "../../../../../../../../messages/en/agents.json";
import type { PromotionDiff } from "../../helpers";
import { PromoteConfirm } from "./PromoteConfirm";

afterEach(cleanup);

const DIFF: PromotionDiff = {
  fieldChanges: ["model", "system_prompt"],
  skillChanges: { added: [{ skill_id: "s1", name: "SQL safety" }], removed: [{ skill_id: "s2", name: "Naming" }], reordered: true },
  missing: [{ skill_id: "gone", name: "Old skill" }],
  versionDrift: [{ skill_id: "s1", name: "SQL safety", then: 3, now: 4 }],
  same: false,
};

function renderConfirm(over: { error?: string | null; pending?: boolean } = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, agents }}>
      <PromoteConfirm version={2} diff={DIFF} pending={over.pending ?? false} error={over.error ?? null} onConfirm={onConfirm} onCancel={onCancel} />
    </NextIntlClientProvider>,
  );
  return { onConfirm, onCancel };
}

describe("PromoteConfirm", () => {
  it("lists the field and skill changes, the missing-skill line and the version-drift line", () => {
    renderConfirm();
    expect(screen.getByRole("dialog")).toHaveTextContent("Promote v2");
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getByText("Skill added: SQL safety")).toBeInTheDocument();
    expect(screen.getByText("Skill removed: Naming")).toBeInTheDocument();
    expect(screen.getByText("Skill order changed")).toBeInTheDocument();
    expect(screen.getByText("Missing skills: Old skill — they will not be restored")).toBeInTheDocument();
    expect(
      screen.getByText("Only the link to SQL safety is restored, not its text (v3 → v4)"),
    ).toBeInTheDocument();
  });

  it("is keyboard-operable: Promote and Cancel are focusable buttons, Escape cancels, the inline error is an alert", () => {
    const { onConfirm, onCancel } = renderConfirm({ error: "This agent changed since you opened Compare. Reload to see its current version." });
    const promote = screen.getByRole("button", { name: "Promote" });
    promote.focus();
    expect(promote).toHaveFocus();
    fireEvent.click(promote);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("alert")).toHaveTextContent("This agent changed since you opened Compare.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
