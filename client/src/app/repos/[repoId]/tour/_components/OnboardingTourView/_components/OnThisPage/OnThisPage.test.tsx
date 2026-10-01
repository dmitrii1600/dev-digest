import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import { OnThisPage } from "./OnThisPage";

afterEach(cleanup);

describe("OnThisPage", () => {
  it("lists the five sections in order and reports the one picked", () => {
    const onSelect = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnThisPage active="critical_paths" onSelect={onSelect} />
      </NextIntlClientProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "How to run locally" }));
    expect(onSelect).toHaveBeenCalledWith("run_locally");
  });

  it("marks only the active section, with aria-current and the accent bar", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnThisPage active="critical_paths" onSelect={vi.fn()} />
      </NextIntlClientProvider>,
    );
    const current = screen.getByRole("button", { name: "Critical paths" });
    expect(current).toHaveAttribute("aria-current", "location");
    expect(current.style.borderColor).toBe("var(--accent)");
    const other = screen.getByRole("button", { name: "First tasks" });
    expect(other).not.toHaveAttribute("aria-current");
    expect(other.style.borderColor).toBe("transparent");
  });
});
