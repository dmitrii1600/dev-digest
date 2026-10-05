import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SpecFile } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../../messages/en/context.json";

const h = vi.hoisted(() => {
  const idle = () => ({ isPending: false, isError: false, error: null as unknown, variables: undefined as unknown });
  return {
    save: idle(),
    del: idle(),
    idle,
    saveMutate: vi.fn(),
    delMutate: vi.fn(),
    reset: vi.fn(),
    refetch: vi.fn(),
    setBlocker: vi.fn(),
  };
});

vi.mock("@/lib/hooks/project-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks/project-context")>()),
  useSaveContextFile: () => ({ ...h.save, mutate: h.saveMutate, reset: h.reset }),
  useDeleteContextFile: () => ({ ...h.del, mutate: h.delMutate, reset: h.reset }),
}));
vi.mock("@/providers/navigation-guard", () => ({
  useNavigationGuard: () => ({ setBlocker: h.setBlocker, confirmLeave: () => true }),
}));

import { DocPane, type DocMode } from "./DocPane";
import { useSpecDraft } from "../../useSpecDraft";

const V1 = "a".repeat(64);
const V2 = "b".repeat(64);
const PATH = ".devdigest/specs/a.md";
const FILE: SpecFile = { path: PATH, content: "# Title\n\nbody", version: V1, editable: true, read_only_reason: null };

beforeEach(() => {
  h.save = h.idle();
  h.del = h.idle();
});
afterEach(() => {
  cleanup();
  for (const m of [h.saveMutate, h.delMutate, h.reset, h.refetch, h.setBlocker]) m.mockReset();
});

function Harness({ file, onClear }: { file: SpecFile; onClear: () => void }) {
  const [mode, setMode] = React.useState<DocMode>("preview");
  const draft = useSpecDraft({ repoId: "r1", path: file.path, doc: file, refetchDoc: h.refetch, onClear });
  return draft ? (
    <DocPane path={file.path} file={file} usedBy={2} mode={mode} onModeChange={setMode} draft={draft} />
  ) : null;
}

function ui(file: SpecFile, onClear = vi.fn()) {
  return (
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <Harness file={file} onClear={onClear} />
    </NextIntlClientProvider>
  );
}

const edit = () => fireEvent.click(screen.getByRole("button", { name: "Edit" }));
const type = (value: string) => fireEvent.change(screen.getByLabelText(`Edit ${PATH}`), { target: { value } });
const conflict = (reason: "changed" | "deleted", current: string | null) => ({
  isPending: false,
  isError: true,
  error: new ApiError("conflict", 409, "version_conflict", { reason, current_version: current }),
  variables: { path: PATH },
});

describe("DocPane", () => {
  it("toggles Preview | Edit, previews unsaved edits, and shows the unsaved indicator only while text differs", () => {
    render(ui(FILE));
    expect(screen.getByRole("group", { name: "View mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    edit();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
    type("hello unsaved");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(h.setBlocker).toHaveBeenCalledWith(`You have unsaved changes to ${PATH}. Leave and discard them?`);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("hello unsaved")).toBeInTheDocument();

    edit();
    type("# Title\r\n\r\nbody");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAccessibleName();
  });

  it("saves { path, content, version }, then the indicator clears and the blocker is released", () => {
    h.saveMutate.mockImplementation((_in, opts) => opts.onSuccess({ ...FILE, version: V2 }));
    render(ui(FILE));
    edit();
    type("# New");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.saveMutate.mock.calls[0]![0]).toEqual({ path: PATH, content: "# New", version: V1 });
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(h.setBlocker).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ["tracked", "Tracked by the repository — DevDigest does not change committed files."],
    ["outside_root", "Only files under .devdigest/specs/ can be edited here."],
    ["too_large", "Over 64 KB — this file can be previewed but not edited."],
  ] as const)("shows a %s file read-only with its reason and no Edit or Delete", (reason, text) => {
    render(ui({ ...FILE, editable: false, read_only_reason: reason }));
    expect(screen.getByText("read-only")).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("disables Save and Delete while a request is in flight", () => {
    const view = render(ui(FILE));
    edit();
    type("# New");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    h.save = { ...h.idle(), isPending: true };
    view.rerender(ui(FILE));
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.click(saving);
    fireEvent.click(saving);
    expect(h.saveMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps the text on a changed conflict and offers Reload and Overwrite with the current version", () => {
    h.save = conflict("changed", V2);
    render(ui(FILE));
    edit();
    type("# mine");
    expect(screen.getByRole("alert")).toHaveTextContent("This file changed on disk after you opened it. Your text has not been saved.");
    expect(screen.getByLabelText(`Edit ${PATH}`)).toHaveValue("# mine");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    expect(h.saveMutate.mock.calls[0]![0]).toEqual({ path: PATH, content: "# mine", version: V2 });
  });

  it("overwrites a deleted file with version null, and Reload asks first then re-reads the file", async () => {
    h.save = conflict("deleted", null);
    h.refetch.mockResolvedValue({ data: { ...FILE, content: "# disk", version: V2 }, error: null });
    render(ui(FILE));
    expect(screen.getByRole("alert")).toHaveTextContent("This file no longer exists on disk.");
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    expect(h.saveMutate.mock.calls[0]![0]).toMatchObject({ path: PATH, version: null });

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByText("Reload from disk?")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Reload" }).at(-1)!);
    await vi.waitFor(() => expect(h.refetch).toHaveBeenCalled());
  });

  it("offers Reload only on a delete conflict", () => {
    h.del = { ...conflict("changed", V2), variables: { path: PATH } };
    render(ui(FILE));
    expect(screen.getByRole("alert")).toHaveTextContent("so it was not deleted");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Overwrite" })).not.toBeInTheDocument();
  });

  it("shows a retryable error and keeps Unsaved changes when a save fails for another reason", () => {
    h.save = {
      isPending: false,
      isError: true,
      error: new ApiError("boom", 500, "internal"),
      variables: { path: PATH },
    };
    render(ui(FILE));
    edit();
    type("# mine");
    expect(screen.getByText("Couldn’t save this file.")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.saveMutate.mock.calls[0]![0]).toEqual({ path: PATH, content: "# mine", version: V1 });
  });

  it("confirms Delete, sends { path, version } and clears the selection; a dirty file says so", () => {
    h.delMutate.mockImplementation((_in, opts) => opts.onSuccess());
    const onClear = vi.fn();
    render(ui(FILE, onClear));
    edit();
    type("# unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(`Delete ${PATH}?`)).toBeInTheDocument();
    expect(screen.getByText(/together with your unsaved changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    expect(h.delMutate.mock.calls[0]![0]).toEqual({ path: PATH, version: V1 });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
