import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";
// jsdom has no layout, so ResponsiveContainer renders nothing; give the chart a fixed size and
// keep everything else in recharts real, so the tooltip trigger under test is recharts' own.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
    React.cloneElement(children, { width: 600, height: 220 }),
}));

import { MetricTrendChart } from "./MetricTrendChart";
import { TrendTooltip } from "./TrendTooltip";
import { toChartRows } from "./helpers";

/**
 * The branch a user sees on a fresh agent: fewer than two completed runs make a
 * trend meaningless, so the chart says so instead of drawing a single dot. The tooltip
 * (AC-15) is rendered directly for its content, and once through the real chart with the
 * keyboard (the `accessibilityLayer` path) to pin that the tooltip is wired to a focused
 * point. ("Unavailable stays null, never 0" is pinned in helpers.test.ts.)
 */
afterEach(cleanup);

const point = (i: number, over: Partial<EvalTrendPoint> = {}): EvalTrendPoint => ({
  run_id: `r${i}`,
  ran_at: `2026-10-0${i}T10:00:00Z`,
  agent_version: 1,
  recall: 0.5,
  precision: null,
  citation_accuracy: 1,
  pass_rate: 0.5,
  cases_passed: 1,
  cases_total: 2,
  cost_usd: null,
  ...over,
});

const intl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("MetricTrendChart", () => {
  it("asks for a second run when there is no trend to draw yet", () => {
    const hint = "Run the eval set at least twice to see a trend.";
    intl(<MetricTrendChart trend={[]} />);
    expect(screen.getByText(hint)).toBeInTheDocument();
    cleanup();

    intl(<MetricTrendChart trend={[point(1)]} />);
    expect(screen.getByText(hint)).toBeInTheDocument();
    cleanup();

    intl(<MetricTrendChart trend={[point(1), point(2)]} />);
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it("tooltip shows the run's date, version and cost, with a dash for an unknown cost", () => {
    const [known, unknown] = toChartRows([
      point(1, { agent_version: 3, cost_usd: 0.02 }),
      point(2, { agent_version: 3 }),
    ]);

    intl(<TrendTooltip active payload={[{ payload: unknown }]} />);
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("Cost").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Ran at").parentElement).toHaveTextContent(
      new Date("2026-10-02T10:00:00Z").toLocaleString(),
    );
    cleanup();

    intl(<TrendTooltip active payload={[{ payload: known }]} />);
    expect(screen.getByText("Cost").parentElement).toHaveTextContent("$0.02");
    cleanup();

    const { container } = intl(<TrendTooltip active={false} payload={[{ payload: known }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("AC-15: focusing the chart and stepping through points with the keyboard shows each run's version and cost", () => {
    const { container } = intl(
      <MetricTrendChart
        trend={[
          point(1, { agent_version: 4, cost_usd: 0.02 }),
          point(2, { agent_version: 5 }),
          point(3, { agent_version: 6, cost_usd: 0.5 }),
        ]}
      />,
    );
    // The chart surface is a tab stop only when `accessibilityLayer` is on.
    const surface = container.querySelector("svg.recharts-surface") as SVGElement;
    expect(surface).toHaveAttribute("tabindex", "0");

    fireEvent.focus(surface);
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("Cost").parentElement).toHaveTextContent("—");

    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    expect(screen.getByText("v4")).toBeInTheDocument();
    expect(screen.getByText("Cost").parentElement).toHaveTextContent("$0.02");
  });
});
