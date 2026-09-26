/**
 * DiffTab — Files changed (Smart Diff, L03). Hooks are mocked the way
 * `PRRow.test.tsx` mocks `@/lib/hooks/reviews`; `NextIntlClientProvider` gets
 * the real `prReview` + `shell` messages.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const mutate = vi.fn();

let mockReviews: ReviewRecord[] | undefined;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePrReviews: () => ({ data: mockReviews }),
  useFindingAction: () => ({ mutate, isPending: false }),
  useSmartDiff: () => ({ data: SMART_DIFF }),
}));

import { DiffTab } from "./DiffTab";

const PATCH = '@@ -1,1 +1,2 @@\n port: 3000,\n+  stripeKey: "sk_live_xxx",';
// Well past AUTO_EXPAND_MAX_LINES (200) — used to prove a finding forces the
// card open regardless of size (fix 1: FileCard must not rely on size alone).
const BIG_PATCH = "@@ -1,1 +1,2 @@\n context line,\n+  addedBigLine,";

const FILES: PrFile[] = [
  { path: "src/app.ts", additions: 1, deletions: 0, patch: PATCH },
  { path: "src/big.ts", additions: 210, deletions: 0, patch: BIG_PATCH },
  { path: "src/app.test.ts", additions: 1, deletions: 0, patch: null },
  { path: "docs/x.md", additions: 1, deletions: 0, patch: null },
  { path: "pnpm-lock.yaml", additions: 100, deletions: 0, patch: null },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/app.ts", additions: 1, deletions: 0, finding_lines: [2, 999] },
        { path: "src/big.ts", additions: 210, deletions: 0, finding_lines: [2] },
      ],
    },
    { role: "tests", files: [{ path: "src/app.test.ts", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "docs", files: [{ path: "docs/x.md", additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "boilerplate", files: [{ path: "pnpm-lock.yaml", additions: 100, deletions: 0, finding_lines: [] }] },
  ],
  split_suggestion: { too_big: false, total_lines: 313, proposed_splits: [] },
};

function finding(overrides: Partial<ReviewRecord["findings"][number]>) {
  return {
    id: overrides.id ?? "f1",
    severity: "CRITICAL" as const,
    category: "security" as const,
    title: overrides.title ?? "finding",
    file: "src/app.ts",
    start_line: 2,
    end_line: 2,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding" as const,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

const REVIEW_WITH_FINDINGS: ReviewRecord = {
  id: "r1",
  pr_id: "pr-1",
  agent_id: "agent-a",
  run_id: "run-1",
  agent_name: "Sec",
  kind: "review",
  verdict: "request_changes",
  summary: "s",
  score: 60,
  model: "gpt-4.1",
  created_at: "2026-01-01T00:00:00Z",
  findings: [
    finding({ id: "f-inline", title: "Hardcoded Stripe secret", start_line: 2 }),
    finding({ id: "f-outside", title: "Phantom finding", start_line: 999 }),
    finding({ id: "f-big", title: "Big file finding", file: "src/big.ts", start_line: 2 }),
  ],
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr-1" filesCount={FILES.length} files={FILES} canComment />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mutate.mockClear();
  mockReviews = undefined;
});

describe("DiffTab — smart order", () => {
  it("shows five group headers, in ROLE_ORDER (DOM order), with the collapsed group's file hidden until clicked", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();

    // DOM order, not just presence — each DiffGroup header is a `<button
    // aria-expanded>`; nothing else in this render has that attribute.
    const headers = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining(prReview.smartDiff.coreLabel),
      expect.stringContaining(prReview.smartDiff.testsLabel),
      expect.stringContaining(prReview.smartDiff.wiringLabel),
      expect.stringContaining(prReview.smartDiff.docsLabel),
      expect.stringContaining(prReview.smartDiff.boilerplateLabel),
    ]);

    // boilerplate (last header, ROLE_ORDER index 4) starts collapsed — its
    // file is not on screen yet.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    fireEvent.click(headers[4]!);
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("shows a dot on the file with findings, labelled with the finding count", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();
    expect(screen.getByLabelText("2 findings")).toBeInTheDocument();
  });

  it("renders the finding card under its matching line with no toggling, in the row (not the outside-diff block), and Accept calls mutate", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();

    const card = screen.getByText("Hardcoded Stripe secret").closest("[data-finding-id]") as HTMLElement;
    expect(card).toBeInTheDocument();

    // NOT inside the findings-outside-diff block, which holds the other
    // (line-999) finding in this same fixture.
    const outsideDiffBlock = screen.getByText(/1 finding outside the diff/).parentElement as HTMLElement;
    expect(outsideDiffBlock.contains(card)).toBe(false);

    fireEvent.click(within(card).getByText("Accept"));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f-inline", action: "accept", prId: "pr-1" });
  });

  it("a file over the auto-expand line threshold still starts open when it has a finding", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();
    // src/big.ts is 210 changed lines — past AUTO_EXPAND_MAX_LINES (200) —
    // but it has a finding, so its card must start open with no click (spec
    // §Acceptance: "card appears under the matching line without toggling
    // anything").
    expect(screen.getByText("Big file finding")).toBeInTheDocument();
  });

  it("a file over the auto-expand line threshold opens when its finding arrives after mount, with no click", () => {
    // No reviews yet at first render — the card mounts collapsed (findings
    // resolve after the file list on first load; after Run review the card,
    // keyed by path, never remounts). Neither case may leave a findings card
    // permanently hidden.
    mockReviews = undefined;
    const { rerender } = renderTab();
    expect(screen.queryByText("Big file finding")).not.toBeInTheDocument();

    mockReviews = [REVIEW_WITH_FINDINGS];
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <DiffTab prId="pr-1" filesCount={FILES.length} files={FILES} canComment />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Big file finding")).toBeInTheDocument();
  });

  it("shows an out-of-patch finding under the findings-outside-diff heading", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();
    expect(screen.getByText(/1 finding outside the diff/)).toBeInTheDocument();
    expect(screen.getByText("Phantom finding")).toBeInTheDocument();
  });

  it("clicking Hide removes the finding card", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();
    expect(screen.getByText("Hardcoded Stripe secret")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Hide comments/));
    expect(screen.queryByText("Hardcoded Stripe secret")).not.toBeInTheDocument();
  });

  it("with no review yet, shows noReviewYet and renders no findings counter", () => {
    mockReviews = [];
    renderTab();
    expect(screen.getByText(prReview.smartDiff.noReviewYet)).toBeInTheDocument();
    expect(screen.queryByText(/files with findings/)).not.toBeInTheDocument();
  });
});

describe("DiffTab — original order", () => {
  it("renders the flat GitHub-order list with no group headers", () => {
    mockReviews = [REVIEW_WITH_FINDINGS];
    renderTab();

    fireEvent.click(screen.getByText(prReview.smartDiff.originalOrder));
    expect(screen.queryByText(prReview.smartDiff.coreLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(prReview.smartDiff.boilerplateLabel)).not.toBeInTheDocument();
    // The flat list shows every file directly, in GitHub order.
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });
});
