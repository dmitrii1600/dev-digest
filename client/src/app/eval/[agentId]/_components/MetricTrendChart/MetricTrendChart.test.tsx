import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";
import { MetricTrendChart } from "./MetricTrendChart";

/**
 * The branch a user sees on a fresh agent: fewer than two completed runs make a
 * trend meaningless, so the chart says so instead of drawing a single dot.
 * (The "unavailable stays null, never 0" rule is pinned in helpers.test.ts; the
 * SVG itself is not asserted — jsdom has no layout for recharts.)
 */
afterEach(cleanup);

const point = (i: number): EvalTrendPoint => ({
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
});

const renderChart = (trend: EvalTrendPoint[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <MetricTrendChart trend={trend} />
    </NextIntlClientProvider>,
  );

describe("MetricTrendChart", () => {
  it("asks for a second run when there is no trend to draw yet", () => {
    const hint = "Run the eval set at least twice to see a trend.";
    renderChart([]);
    expect(screen.getByText(hint)).toBeInTheDocument();
    cleanup();

    renderChart([point(1)]);
    expect(screen.getByText(hint)).toBeInTheDocument();
    cleanup();

    renderChart([point(1), point(2)]);
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });
});
