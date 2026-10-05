import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefRecord, PrBriefResponse } from "@devdigest/shared";
import brief from "../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

let mockData: PrBriefResponse | undefined;
let mockPending = false;
vi.mock("@/lib/hooks/brief", () => ({
  briefKey: (id: string) => ["pr-brief", id],
  usePrBrief: () => ({ data: mockData, isLoading: false }),
  useGenerateBrief: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: mockPending,
    isError: false,
    error: null,
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: () => ({ data: [] }) }));
vi.mock("./_components/IntentCard", () => ({ IntentCard: () => <div>Intent card</div> }));
vi.mock("../BlastRadiusPanel", () => ({ BlastRadiusPanel: () => <div>Blast radius panel</div> }));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  mockData = undefined;
  mockPending = false;
});

const RECORD: PrBriefRecord = {
  summary: "Adds a limiter.",
  risks: [
    {
      kind: "security",
      severity: "high",
      title: "Spoofable header",
      explanation: "Rotate keys.",
      file_refs: ["src/a.ts:12-30"],
    },
  ],
  review_focus: [{ file: "src/a.ts", line: 12, reason: "Refill math" }],
  missing_facts: [],
  head_sha: "a1b2c3d4e5f6",
  provider: "openai",
  model: "gpt-4.1",
  input_tokens: 10,
  tokens_in: 10,
  tokens_out: 5,
  cost_usd: null,
  generated_at: "2026-10-02T10:00:00.000Z",
};

function renderTab(onJump = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
      <OverviewTab
        prId="p1"
        prBody="The PR description."
        repoFullName="acme/api"
        headSha="a1b2c3d4e5f6"
        repoId="r1"
        onJump={onJump}
      />
    </NextIntlClientProvider>,
  );
  return onJump;
}

const before = (a: HTMLElement, b: HTMLElement) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("OverviewTab", () => {
  it("AC-3: banner, then Intent above Risk areas beside Blast radius, then Review focus; the Description stays; a focus click jumps", () => {
    mockData = { brief: RECORD, stale: false, head_sha: "a1b2c3d4e5f6", generating: false };
    const onJump = renderTab();

    const summary = screen.getByText("Adds a limiter.");
    const intent = screen.getByText("Intent card");
    const risks = screen.getByText("Risk areas");
    const blast = screen.getByText("Blast radius panel");
    const focus = screen.getByText("Review focus — read these first");
    expect(before(summary, intent)).toBe(true);
    expect(before(intent, risks)).toBe(true);
    expect(before(risks, blast)).toBe(true);
    expect(before(blast, focus)).toBe(true);
    // Intent and Risk areas share the first column; Blast radius is in the other one.
    const grid = blast.parentElement!;
    expect(intent.parentElement).toBe(grid.children[0]);
    expect(risks.closest("section")!.parentElement).toBe(grid.children[0]);
    expect(screen.getByText("The PR description.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /src\/a\.ts:12 / }));
    expect(onJump).toHaveBeenCalledWith("src/a.ts:12");
  });

  it("NFR-12: the grid is auto-fit minmax(360px, 1fr), so the columns stack on a narrow window", () => {
    mockData = { brief: RECORD, stale: false, head_sha: "a1b2c3d4e5f6", generating: false };
    renderTab();
    const grid = screen.getByText("Blast radius panel").parentElement!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(auto-fit, minmax(360px, 1fr))");
  });

  it("SA-10: while generating, Intent and Blast radius stay, the skeleton shows, Risk areas and Review focus are absent", () => {
    mockData = { brief: RECORD, stale: false, head_sha: "a1b2c3d4e5f6", generating: true };
    renderTab();
    expect(screen.getByText("Intent card")).toBeInTheDocument();
    expect(screen.getByText("Blast radius panel")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
    expect(screen.getByText("The PR description.")).toBeInTheDocument();
  });
});
