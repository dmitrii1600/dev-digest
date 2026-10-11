import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";
import { RegressionBanner } from "./RegressionBanner";

afterEach(cleanup);

function renderBanner(regressions: React.ComponentProps<typeof RegressionBanner>["regressions"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <RegressionBanner regressions={regressions} />
    </NextIntlClientProvider>,
  );
}

describe("RegressionBanner", () => {
  it("names each dropped metric and its drop in points", () => {
    renderBanner([
      { metric: "precision", drop_points: 12.5 },
      { metric: "citation_accuracy", drop_points: 3 },
    ]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Precision dropped 12.5 pts since the previous run")).toBeInTheDocument();
    expect(screen.getByText("Citation dropped 3.0 pts since the previous run")).toBeInTheDocument();
  });

  it("renders nothing when no metric dropped", () => {
    const { container } = renderBanner([]);
    expect(container).toBeEmptyDOMElement();
  });
});
