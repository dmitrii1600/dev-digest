import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import { TourSection } from "./TourSection";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = React.useState(true);
  return (
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <TourSection id="critical_paths" title="Critical paths" icon="Activity" expanded={open} onToggle={() => setOpen((v) => !v)}>
        <p>section body</p>
      </TourSection>
    </NextIntlClientProvider>
  );
}

describe("TourSection", () => {
  it("toggles its body from a header button named after the section", () => {
    render(<Harness />);
    const header = screen.getByRole("button", { name: "Critical paths" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header.getAttribute("aria-label")).toBeNull();
    expect(header.getAttribute("title")).toBe("Expand or collapse");
    expect(screen.getByText("section body")).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByRole("button", { name: "Critical paths" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("section body")).not.toBeInTheDocument();
  });
});
