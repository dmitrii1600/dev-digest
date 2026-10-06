import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseListItem } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";
import { EvalCaseList } from "./EvalCaseList";

afterEach(cleanup);

function item(id: string, name: string, over: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id,
    owner_kind: "agent",
    owner_id: "ag1",
    name,
    expectation: "must_find",
    target: { file: "src/config.ts", start_line: 11, end_line: 11 },
    source: "finding",
    source_finding_id: `f-${id}`,
    fingerprint: `fp-${id}`,
    input_diff: "",
    input_files: null,
    input_meta: { pr_title: "t", pr_body: "" },
    expected_output: { title: name, severity: "HIGH", category: "bug" },
    created_at: "2026-10-05T10:00:00Z",
    last_result: "passed",
    latest_single: null,
    ...over,
  };
}

function mount(cases: EvalCaseListItem[], props: Partial<React.ComponentProps<typeof EvalCaseList>> = {}) {
  const cb = { onEdit: vi.fn(), onRun: vi.fn(), onDelete: vi.fn() };
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseList cases={cases} {...cb} {...props} />
    </NextIntlClientProvider>,
  );
  return cb;
}

describe("EvalCaseList", () => {
  it("AC-7/AC-13: each row says where the case came from; the single-run marker sits beside the unchanged suite badge", () => {
    mount([
      item("c1", "From a finding", { source: "finding" }),
      item("c2", "Hand written", {
        source: "manual",
        last_result: "failed",
        latest_single: { run_id: "r1", status: "passed", started_at: "2026-10-06T10:00:00Z" },
      }),
    ]);
    expect(screen.getByText("from finding")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getAllByText("must find · src/config.ts:11")).toHaveLength(2);

    // only the second row has a marker, and it reads as text; the main badge is still the suite result
    expect(screen.getAllByText(/single run:/)).toHaveLength(1);
    expect(screen.getByText("single run: passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("AC-9: Run, Edit and Delete call back with the row's case", () => {
    const first = item("c1", "One");
    const second = item("c2", "Two");
    const cb = mount([first, second]);
    fireEvent.click(screen.getByRole("button", { name: "Run eval case Two" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit eval case One" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete eval case Two" }));
    expect(cb.onRun).toHaveBeenCalledWith(second);
    expect(cb.onEdit).toHaveBeenCalledWith(first);
    expect(cb.onDelete).toHaveBeenCalledWith(second);
  });

  it("a blocked or running case cannot be started: no callback, and the reason is the tooltip", () => {
    const cb = mount([item("c1", "One"), item("c2", "Two")], {
      runBlockedReason: "Link this skill to an agent first.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Run eval case One" }));
    expect(cb.onRun).not.toHaveBeenCalled();
    expect(screen.getAllByTitle("Link this skill to an agent first.")).toHaveLength(2);
    cleanup();

    const running = mount([item("c1", "One"), item("c2", "Two")], { runningCaseId: "c1" });
    fireEvent.click(screen.getByRole("button", { name: "Run eval case One" }));
    expect(running.onRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run eval case Two" }));
    expect(running.onRun).toHaveBeenCalledTimes(1);
  });
});
