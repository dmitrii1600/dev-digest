import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalCaseInput, EvalCaseRunState } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";
import shell from "../../../../messages/en/shell.json";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  createError: null as Error | null,
  runState: undefined as unknown,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({
    mutate: state.create,
    isPending: false,
    isError: state.createError !== null,
    error: state.createError,
  }),
  useUpdateEvalCase: () => ({ mutate: state.update, isPending: false, isError: false, error: null }),
  useEvalCaseRunState: () => ({ data: state.runState }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(cleanup);

/* The fixture strings are the ones in server/test/evals-authoring-helpers.test.ts. */
const TWO_FILES = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "+added",
  " tail",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -5,1 +5,2 @@",
  "-old",
  "+new1",
  "+new2",
].join("\n");
const PLACEHOLDER = '--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: "sk_live_..."';
const BARE_HUNK = "@@ -1,1 +1,2 @@\n+a";
const BARE_TWO = "--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,2 @@\n+a\n--- a/y.ts\n+++ b/y.ts\n@@ -1,1 +1,2 @@\n+b";

function savedCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key",
    expectation: "must_find",
    target: { file: "src/config.ts", start_line: 10, end_line: 10 },
    source: "manual",
    source_finding_id: null,
    fingerprint: "fp",
    input_diff: PLACEHOLDER,
    input_files: null,
    input_meta: { pr_title: "Add Stripe", pr_body: "" },
    expected_output: { title: null, severity: null, category: null },
    created_at: "2026-10-05T10:00:00Z",
    ...over,
  };
}

function runState(over: Partial<EvalCaseRunState> = {}): EvalCaseRunState {
  return { latest: null, running: null, ...over };
}

function mount(props: Partial<React.ComponentProps<typeof EvalCaseEditor>> = {}) {
  const onClose = vi.fn();
  const onRun = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages, shell }}>
      <EvalCaseEditor
        owner={{ kind: "agent", id: "ag1" }}
        takenNames={[]}
        onClose={onClose}
        onRun={onRun}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onClose, onRun };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => screen.getByRole("button", { name: "Save" });
const optionLabels = () =>
  within(screen.getByLabelText("File"))
    .getAllByRole("option")
    .map((o) => o.textContent);
const jsonOf = () => JSON.parse((screen.getByLabelText("Expected output") as HTMLTextAreaElement).value);

beforeEach(() => {
  state.create.mockReset();
  state.update.mockReset();
  state.createError = null;
  state.runState = undefined;
  state.create.mockImplementation((input: EvalCaseInput, opts: { onSuccess: (c: EvalCase) => void }) =>
    opts.onSuccess(savedCase({ name: input.name, input_diff: input.input_diff, target: input.target })),
  );
});

describe("EvalCaseEditor — fields, preview, sync", () => {
  it("AC-1/2/3: opens with every field and tab; a pasted 2-file diff gives two file cards, the Files view and a file select limited to the diff", () => {
    mount();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    for (const name of ["Diff", "Files", "PR meta"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Diff")).toBeInTheDocument();
    for (const label of ["Expectation", "File", "Start line", "End line", "Expected output"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Finding skeleton" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));

    type("Diff", TWO_FILES);
    // each file is a card in the preview (its path) and an option of the file select
    expect(screen.getAllByText("src/a.ts").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("src/b.ts").length).toBeGreaterThanOrEqual(2);
    expect(optionLabels()).toEqual(["Pick a file from the diff", "src/a.ts", "src/b.ts"]);

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("changed lines 2")).toBeInTheDocument();
    expect(screen.getByText("changed lines 5–6")).toBeInTheDocument();
  });

  it("AC-3: the Files view reads `changed lines 10` for the placeholder diff, and only that file is offered", () => {
    mount();
    type("Diff", PLACEHOLDER);
    expect(optionLabels()).toEqual(["Pick a file from the diff", "src/config.ts"]);
    expect(optionLabels()).not.toContain("src/a.tsx");
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("changed lines 10")).toBeInTheDocument();
  });

  it("AC-4/5: the skeleton fills the first file and range; form edits rewrite the JSON and JSON edits rewrite the form", () => {
    mount();
    type("Diff", TWO_FILES);
    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    expect(screen.getByLabelText("File")).toHaveValue("src/a.ts");
    expect(screen.getByLabelText("Start line")).toHaveValue(2);
    expect(jsonOf()).toEqual({ type: "must_find", file: "src/a.ts", start_line: 2, end_line: 2 });
    expect(screen.getByText("valid JSON")).toBeInTheDocument();

    type("End line", "3");
    expect(jsonOf().end_line).toBe(3);

    type("Expected output", JSON.stringify({ type: "must_not_flag", file: "src/b.ts", start_line: 5, end_line: 6 }));
    expect(screen.getByLabelText("File")).toHaveValue("src/b.ts");
    expect(screen.getByLabelText("Expectation")).toHaveValue("must_not_flag");
    expect(screen.getByLabelText("Start line")).toHaveValue(5);
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
  });

  it("EC-4: invalid JSON keeps the last valid fields, says why, and blocks Save", () => {
    mount();
    type("Name", "case one");
    type("Diff", TWO_FILES);
    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    expect(save()).toBeEnabled();

    type("Expected output", '{"type":"must_find",}');
    expect(screen.getByLabelText("File")).toHaveValue("src/a.ts");
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByText("This is not valid JSON.")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    type("Expected output", '{"type":"must_find"}');
    expect(screen.getByText(/exactly the keys type, file, start_line and end_line/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });
});

describe("EvalCaseEditor — validation (EC-1 … EC-5)", () => {
  it("EC-1/EC-2: a bare hunk, a bare multi-file diff and an oversize diff block Save with their own message", () => {
    mount();
    type("Name", "x");
    type("Diff", BARE_HUNK);
    expect(screen.getByText("This is not a unified diff with at least one file and one hunk.")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    type("Diff", BARE_TWO);
    expect(screen.getByText(/needs a diff --git line before each file/)).toBeInTheDocument();

    type("Diff", "a".repeat(65_537));
    expect(screen.getByText(/The diff is 65,537 bytes; the limit is 65,536 bytes/)).toBeInTheDocument();
    expect(save()).toBeDisabled();

    // exactly 65 536 bytes is within the cap: the size message is gone (the text is still not a diff)
    type("Diff", "a".repeat(65_536));
    expect(screen.queryByText(/the limit is 65,536 bytes/)).not.toBeInTheDocument();
  });

  it("EC-3: a file outside the diff, a range off the changed lines and start after end each name the problem", () => {
    mount();
    type("Name", "x");
    type("Diff", PLACEHOLDER);
    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    expect(save()).toBeEnabled();

    type("Expected output", JSON.stringify({ type: "must_find", file: "src/other.ts", start_line: 10, end_line: 10 }));
    expect(screen.getByText("The file src/other.ts is not in the diff.")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    type("Expected output", JSON.stringify({ type: "must_find", file: "src/config.ts", start_line: 11, end_line: 12 }));
    expect(screen.getByText("Lines 11–12 do not overlap a changed line of src/config.ts.")).toBeInTheDocument();

    type("Start line", "10");
    type("End line", "9");
    expect(screen.getByText("The start line is after the end line.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("EC-5: an empty name, a 121-character name and a name already in the set are refused", () => {
    mount({ takenNames: ["taken"] });
    type("Diff", PLACEHOLDER);
    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    type("Name", "   ");
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    type("Name", "n".repeat(121));
    expect(screen.getByText("The name is longer than 120 characters.")).toBeInTheDocument();
    type("Name", "n".repeat(120));
    expect(save()).toBeEnabled();
    type("Name", " Taken ");
    expect(screen.getByText("Another case in this set already uses this name.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });
});

describe("EvalCaseEditor — save, run, close", () => {
  it("AC-11/EC-7: Run case needs a saved case; with Run on save on, saving calls onRun once with the new id", () => {
    const { onRun } = mount();
    type("Name", "stripe-key");
    type("Diff", PLACEHOLDER);
    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();
    expect(screen.getByText("Save the case before running it.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Run on save" }));
    fireEvent.click(save());
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create.mock.calls[0]![0]).toMatchObject({
      name: "stripe-key",
      input_diff: PLACEHOLDER,
      target: { file: "src/config.ts", start_line: 10, end_line: 10 },
    });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("c1");

    // saved and clean: Run case runs the saved case
    expect(screen.getByRole("button", { name: "Run case" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Run case" }));
    expect(onRun).toHaveBeenCalledTimes(2);

    // a further edit makes it dirty again
    type("Name", "renamed");
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();
    expect(screen.getByText("Save the case before running it.")).toBeInTheDocument();
  });

  it("AC-11: with Run on save off, saving does not run the case; a later save PUTs to the same id", () => {
    const { onRun } = mount();
    type("Name", "stripe-key");
    type("Diff", PLACEHOLDER);
    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    fireEvent.click(save());
    expect(onRun).not.toHaveBeenCalled();

    type("Name", "stripe-key-2");
    fireEvent.click(save());
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.update.mock.calls[0]![0]).toMatchObject({ caseId: "c1", input: { name: "stripe-key-2" } });
  });

  it("an existing case still treats a name already in the set as taken", () => {
    mount({ takenNames: ["stripe-key"], initial: savedCase({ name: "other" }) });
    type("Name", "stripe-key");
    expect(screen.getByText("Another case in this set already uses this name.")).toBeInTheDocument();
  });

  it("EC-6: a dirty close asks first; Keep editing stays, Discard closes; a clean close does not ask", () => {
    const { onClose } = mount({ initial: savedCase() });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    type("Name", "changed");
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("EC-12: changing the target of a finding-made case warns, and the body never carries the finding link", () => {
    mount({ initial: savedCase({ source: "finding", source_finding_id: "f1" }) });
    expect(screen.queryByText(/made from a finding/)).not.toBeInTheDocument();
    type("Expectation", "must_not_flag");
    expect(screen.getByText(/This case was made from a finding\./)).toBeInTheDocument();
    fireEvent.click(save());
    expect(state.update.mock.calls[0]![0].input).not.toHaveProperty("source_finding_id");
  });

  it("EC-10: a reason from the tab disables Run case and is shown", () => {
    mount({ initial: savedCase(), runBlockedReason: "Link this skill to an agent first." });
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();
    expect(screen.getByText("Link this skill to an agent first.")).toBeInTheDocument();
  });

  it("a rejected save shows the server's message", () => {
    state.createError = new Error("Name already used");
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Name already used");
  });
});

describe("EvalCaseEditor — last run (AC-12, EC-9)", () => {
  const run = { id: "r1", kind: "single", agent_version: 3 };
  const result = (over: Record<string, unknown> = {}) => ({
    case_id: "c1",
    case_name: "stripe-key",
    expectation: "must_find",
    target: { file: "src/config.ts", start_line: 10, end_line: 10 },
    fingerprint: "fp",
    status: "passed",
    error: null,
    produced: 2,
    kept: 1,
    matched: 1,
    findings: [{ file: "src/config.ts", start_line: 10, end_line: 10, title: "t", severity: "HIGH" }],
    duration_ms: 1234,
    cost_usd: 0.004,
    ...over,
  });

  it("none, running, and a finished result with kind, version, expected vs got, duration and cost", () => {
    mount({ initial: savedCase() });
    expect(screen.getByText("This case has not run yet.")).toBeInTheDocument();
    cleanup();

    state.runState = runState({ running: { id: "r2" } as never });
    mount({ initial: savedCase() });
    expect(screen.getByText("Running this case…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    cleanup();

    state.runState = runState({ latest: { run: run as never, result: result() as never } });
    mount({ initial: savedCase() });
    expect(screen.getByText(/Single-case run · agent v3/)).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Expected: a finding at src/config.ts:10")).toBeInTheDocument();
    expect(screen.getByText("Got: 1 finding, 1 on the target")).toBeInTheDocument();
    expect(screen.getByText(/1\.2 s · cost/)).toBeInTheDocument();
  });

  it("an errored run shows the status as text and the reason", () => {
    state.runState = runState({
      latest: {
        run: { ...run, kind: "suite" } as never,
        result: result({ status: "errored", error: "model timed out", cost_usd: null, duration_ms: null }) as never,
      },
    });
    mount({ initial: savedCase() });
    expect(screen.getByText(/Suite run · agent v3/)).toBeInTheDocument();
    expect(screen.getByText("Errored")).toBeInTheDocument();
    expect(screen.getByText("Reason: model timed out")).toBeInTheDocument();
  });
});
