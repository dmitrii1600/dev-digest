import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { StoredRisk } from "@devdigest/shared";
import brief from "../../../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

afterEach(cleanup);

const RISKS: StoredRisk[] = [
  {
    kind: "security",
    severity: "high",
    title: "Spoofable header",
    explanation: "A caller can rotate keys.",
    file_refs: ["src/a.ts:12-30", "src/b.ts:4"],
  },
  {
    kind: "mystery_kind",
    severity: "low",
    title: "Odd thing",
    explanation: "Second explanation.",
    file_refs: ["src/c.ts"],
  },
];

function renderRisks(risks: StoredRisk[], onJump = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ brief }}>
      <RiskAreas risks={risks} onJump={onJump} />
    </NextIntlClientProvider>,
  );
  return onJump;
}

describe("RiskAreas", () => {
  it("shows the severity word, jumps from the main part, and keeps one expander open at a time", () => {
    const onJump = renderRisks(RISKS);
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("low")).toBeInTheDocument();
    // every control is a real button
    for (const el of screen.getAllByRole("button")) expect(el.tagName).toBe("BUTTON");

    fireEvent.click(screen.getByRole("button", { name: /Spoofable header/ }));
    expect(onJump).toHaveBeenCalledWith("src/a.ts:12-30");

    const [first, second] = screen.getAllByRole("button", { name: "Why this is a risk" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(first!);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A caller can rotate keys.")).toBeInTheDocument();

    fireEvent.click(second!);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("A caller can rotate keys.")).not.toBeInTheDocument();
  });

  it("every ref in the open panel jumps", () => {
    const onJump = renderRisks(RISKS);
    fireEvent.click(screen.getAllByRole("button", { name: "Why this is a risk" })[0]!);
    const panel = screen.getByText("A caller can rotate keys.").parentElement!;
    fireEvent.click(within(panel).getByRole("button", { name: "src/b.ts:4" }));
    expect(onJump).toHaveBeenCalledWith("src/b.ts:4");
  });

  it("an unknown kind still renders (generic icon), and an empty list says so", () => {
    renderRisks([RISKS[1]!]);
    expect(screen.getByText("Odd thing")).toBeInTheDocument();
    cleanup();
    renderRisks([]);
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });
});
