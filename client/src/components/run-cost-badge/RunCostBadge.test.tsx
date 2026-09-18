/**
 * RunCostBadge — the money is only as trustworthy as its "unknown" case.
 * The load-bearing rule: a null cost renders "—", never "$0.00". "$0.00" is
 * reserved for a genuine zero, so the two can never be confused on screen.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge, formatRunCost, formatTokenCount } from "./RunCostBadge";

afterEach(cleanup);

describe("formatRunCost", () => {
  it("keeps 2 significant digits under $1", () => {
    expect(formatRunCost(0.0013)).toBe("$0.0013");
    expect(formatRunCost(0.012)).toBe("$0.012");
    expect(formatRunCost(0.041)).toBe("$0.041");
  });

  it("switches to 2 decimal places at $1 and above", () => {
    expect(formatRunCost(1)).toBe("$1.00");
    expect(formatRunCost(12.5)).toBe("$12.50");
  });

  it("floors sub-cent-fraction spend instead of rounding it to nothing", () => {
    expect(formatRunCost(0.00002)).toBe("<$0.0001");
  });

  it("renders a genuine zero as $0.00", () => {
    expect(formatRunCost(0)).toBe("$0.00");
  });
});

describe("formatTokenCount", () => {
  it("abbreviates thousands, trimming a trailing .0", () => {
    expect(formatTokenCount(820)).toBe("820");
    expect(formatTokenCount(15230)).toBe("15.2K");
    expect(formatTokenCount(8000)).toBe("8K");
  });
});

describe("RunCostBadge", () => {
  it("compact: cost only", () => {
    render(<RunCostBadge costUsd={0.012} tokensIn={8200} tokensOut={1300} />);
    expect(screen.getByText("$0.012")).toBeInTheDocument();
  });

  it("timeline: total tokens first, then cost", () => {
    render(
      <RunCostBadge variant="timeline" costUsd={0.0013} tokensIn={7891} tokensOut={1228} />,
    );
    expect(screen.getByText("9,119 tok · $0.0013")).toBeInTheDocument();
  });

  it("detail: cost first, then in→out tokens", () => {
    render(<RunCostBadge variant="detail" costUsd={0.014} tokensIn={8200} tokensOut={1300} />);
    expect(screen.getByText("$0.014 · 8.2K→1.3K")).toBeInTheDocument();
  });

  it("renders '—' when the cost is unknown, never '$0.00'", () => {
    render(<RunCostBadge costUsd={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("still shows tokens on the timeline when only the cost is unknown", () => {
    render(<RunCostBadge variant="timeline" costUsd={null} tokensIn={100} tokensOut={50} />);
    expect(screen.getByText("150 tok")).toBeInTheDocument();
  });

  it("distinguishes a real zero from unknown", () => {
    render(<RunCostBadge costUsd={0} />);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
