/**
 * Gap tests for the eval-case confirmation flow at the FindingsPanel level (client, jsdom).
 * FindingsPanel.test.tsx already pins the click/result matrix; this file pins the wiring it
 * does not reach: `files` flowing into the preview, the in-flight lock (A1), Escape through
 * the panel, the dismissed expectation, and the exact request counts of NFR-1.
 * Hooks are mocked at the module level; no fetch, no Docker.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";

vi.mock("../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
const createCase = vi.hoisted(() => vi.fn());
const runCase = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("../../lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: createCase, isPending: false }),
  useStartCaseRun: () => ({ mutateAsync: runCase, isPending: false }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);
beforeEach(() => {
  for (const m of [createCase, runCase, push]) m.mockReset();
});

const BASE: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "r",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: "2026-10-05T10:00:00Z",
  dismissed_at: null,
};
const FILES: PrFile[] = [
  { path: "src/config.ts", additions: 1, deletions: 0, patch: "@@ -10,2 +10,3 @@\n a\n+SECRET_LINE\n b" },
];

function open(finding = BASE, files: PrFile[] | undefined = FILES) {
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsPanel findings={[finding]} prId="pr1" files={files} evalAgentAvailable />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
}

describe("FindingsPanel — eval confirm wiring", () => {
  it("passes the PR files to the preview, and the dismissed decision selects must_not_flag", () => {
    open({ ...BASE, accepted_at: null, dismissed_at: "2026-10-05T10:00:00Z" });
    expect(screen.getByText(/SECRET_LINE/)).toBeInTheDocument();
    expect(screen.getByText("must_not_flag")).toBeInTheDocument();
  });

  it("shows the unavailable note, with both saves enabled, when the page has no file patch", () => {
    open(BASE, []);
    expect(screen.getByText("A diff preview is not available for this finding.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save only" })).toBeEnabled();
  });

  it("Escape closes the dialog through the panel and sends nothing", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createCase).not.toHaveBeenCalled();
    expect(runCase).not.toHaveBeenCalled();
  });

  it("while create is in flight the actions are disabled and Escape cannot close the dialog", async () => {
    let release!: (v: unknown) => void;
    createCase.mockReturnValueOnce(new Promise((r) => (release = r)));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Save only" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => release({ created: true, case: { id: "c1", owner_id: "a1" } }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape in the same tick as Save, before busy renders, cannot close the dialog", async () => {
    let release!: (v: unknown) => void;
    createCase.mockReturnValueOnce(new Promise((r) => (release = r)));
    open();
    // One act batch: the modal's Escape listener still holds the busy=false closure.
    act(() => {
      screen.getByRole("button", { name: "Save only" }).click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => release({ created: true, case: { id: "c1", owner_id: "a1" } }));
    expect(createCase).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("NFR-1: Run sends exactly one create and one run request", async () => {
    createCase.mockResolvedValueOnce({ created: true, case: { id: "c1", owner_id: "a1" } });
    runCase.mockResolvedValueOnce({});
    open();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await act(async () => {});
    expect(createCase).toHaveBeenCalledTimes(1);
    expect(runCase).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
