import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/prReview.json";
import { EvalCaseConfirmModal } from "./EvalCaseConfirmModal";

afterEach(cleanup);

const FINDING: FindingRecord = {
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
const PATCH = "@@ -10,2 +10,3 @@\n a\n+SECRET_LINE\n b\n@@ -90,1 +91,2 @@\n z\n+FAR_AWAY";
const FILES: PrFile[] = [{ path: "src/config.ts", additions: 1, deletions: 0, patch: PATCH }];

function setup(over: Partial<React.ComponentProps<typeof EvalCaseConfirmModal>> = {}) {
  const h = { onSaveOnly: vi.fn(), onRun: vi.fn(), onCancel: vi.fn() };
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <EvalCaseConfirmModal finding={FINDING} files={FILES} busy={false} error={null} {...h} {...over} />
    </NextIntlClientProvider>,
  );
  return h;
}

describe("EvalCaseConfirmModal", () => {
  it("shows what will be frozen: finding, expectation and only the overlapping hunk", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Create eval case" })).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
    expect(screen.getByText("must_find")).toBeInTheDocument();
    expect(screen.getByText(/SECRET_LINE/)).toBeInTheDocument();
    expect(screen.queryByText(/FAR_AWAY/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save only" })).toHaveFocus();
    cleanup();
    setup({ finding: { ...FINDING, accepted_at: null, dismissed_at: "2026-10-05T10:00:00Z" } });
    expect(screen.getByText("must_not_flag")).toBeInTheDocument();
  });

  it("says the preview is unavailable and keeps the actions enabled", () => {
    setup({ files: [] });
    expect(screen.getByText("A diff preview is not available for this finding.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save only" })).toBeEnabled();
  });

  it("notes truncation only past 200 lines", () => {
    const patch = (n: number) => ["@@ -1,300 +1,300 @@", ...Array.from({ length: n - 1 }, (_, i) => ` l${i}`)].join("\n");
    const f = (n: number): PrFile[] => [{ path: "src/config.ts", additions: 0, deletions: 0, patch: patch(n) }];
    const finding = { ...FINDING, start_line: 1, end_line: 1 };
    setup({ files: f(200), finding });
    expect(screen.queryByText(/Preview truncated/)).not.toBeInTheDocument();
    cleanup();
    setup({ files: f(201), finding });
    expect(screen.getByText("Preview truncated to the first 200 lines.")).toBeInTheDocument();
  });

  it("renders untrusted title and patch as literal text", () => {
    setup({
      finding: { ...FINDING, title: "<b>x</b>" },
      files: [{ path: "src/config.ts", additions: 1, deletions: 0, patch: "@@ -11,1 +11,1 @@\n+<b>y</b>" }],
    });
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
    expect(screen.getByText(/<b>y<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("Cancel, Escape, the backdrop and X each cancel without saving", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("dialog").previousElementSibling!);
    expect(h.onCancel).toHaveBeenCalledTimes(4);
    expect(h.onSaveOnly).not.toHaveBeenCalled();
    expect(h.onRun).not.toHaveBeenCalled();
  });

  it("is inert while busy", () => {
    const h = setup({ busy: true });
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save only" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("shows the card strings for a failed create; the focused button completes the flow", () => {
    setup({ error: "too_large" });
    expect(screen.getByRole("alert")).toHaveTextContent("The diff is too large to freeze as an eval case.");
    cleanup();
    const h = setup({ error: "error" });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create the eval case.");
    fireEvent.click(screen.getByRole("button", { name: "Save only" }));
    expect(h.onSaveOnly).toHaveBeenCalledTimes(1);
  });
});
