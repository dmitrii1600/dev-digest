import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefReviewFocusItem } from "@devdigest/shared";
import brief from "../../../../../../../../../../messages/en/brief.json";
import { ReviewFocus } from "./ReviewFocus";

afterEach(cleanup);

const ITEMS: BriefReviewFocusItem[] = [
  { file: "src/a.ts", line: 12, reason: "Refill math" },
  { file: "src/b.ts", line: 8, reason: "429 path" },
];

function renderFocus(items: BriefReviewFocusItem[], onJump = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ brief }}>
      <ReviewFocus items={items} onJump={onJump} />
    </NextIntlClientProvider>,
  );
  return { onJump, view };
}

describe("ReviewFocus", () => {
  it("keeps model order, shows the count, names each button with file:line once, and jumps on click", () => {
    const { onJump } = renderFocus(ITEMS);
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "src/a.ts:12 — Refill math",
      "src/b.ts:8 — 429 path",
    ]);
    expect(buttons[0]!.textContent).not.toContain("src/a.ts:12:12");
    expect(screen.getByRole("button", { name: /src\/a\.ts:12 / })).toBeInTheDocument();

    fireEvent.click(buttons[1]!);
    expect(onJump).toHaveBeenCalledWith("src/b.ts:8");
  });

  it("renders nothing when there are no items", () => {
    const { view } = renderFocus([]);
    expect(view.container).toBeEmptyDOMElement();
  });
});
