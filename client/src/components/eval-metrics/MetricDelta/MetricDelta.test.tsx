import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/eval.json";
import { MetricDelta } from "./MetricDelta";

afterEach(cleanup);

function renderDelta(value: number | null, unit: "points" | "cases") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <MetricDelta value={value} unit={unit} />
    </NextIntlClientProvider>,
  );
}

describe("MetricDelta", () => {
  it("shows a sign glyph and signed text for points", () => {
    renderDelta(3, "points");
    expect(screen.getByText("▲ +3.0 pts")).toBeInTheDocument();
    cleanup();
    renderDelta(-2.5, "points");
    expect(screen.getByText("▼ −2.5 pts")).toBeInTheDocument();
    cleanup();
    renderDelta(0, "points");
    expect(screen.getByText("= 0.0 pts")).toBeInTheDocument();
    cleanup();
    renderDelta(null, "points");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows whole signed numbers for the case unit", () => {
    renderDelta(2, "cases");
    expect(screen.getByText("▲ +2 cases")).toBeInTheDocument();
    cleanup();
    renderDelta(-2, "cases");
    expect(screen.getByText("▼ −2 cases")).toBeInTheDocument();
    cleanup();
    renderDelta(0, "cases");
    expect(screen.getByText("= 0 cases")).toBeInTheDocument();
    cleanup();
    renderDelta(null, "cases");
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
