import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { ContextFileList, SpecFile } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, crumb }: { children: ReactNode; crumb: { label: string }[] }) => (
    <div>
      <nav aria-label="crumb">{crumb.map((c) => c.label).join(" › ")}</nav>
      {children}
    </div>
  ),
}));
vi.mock("@/providers/repo-context", () => ({
  useRepoNotFound: () => false,
  useActiveRepo: () => ({ repos: [{ id: "r1", full_name: "acme/web" }] }),
}));

const h = vi.hoisted(() => {
  const inert = () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  });
  return {
    inert,
    listRefetch: vi.fn(),
    docRefetch: vi.fn(),
    createMutate: vi.fn(),
    uploadMutate: vi.fn(),
    state: { list: {} as { data?: unknown; isLoading: boolean; isError: boolean }, docError: false },
  };
});
const { listRefetch, docRefetch, createMutate, uploadMutate } = h;
const VERSION = "a".repeat(64);
const SPEC = ".devdigest/specs/a.md";
vi.mock("@/lib/hooks/project-context", () => ({
  conflictOf: () => null,
  useContextFiles: () => ({ ...(h.state.list as object), refetch: listRefetch }),
  useContextFile: (_r: string, path: string | null) => ({
    data:
      path && !h.state.docError
        ? ({
            path,
            content: "# Title\n\nrendered **body**",
            version: VERSION,
            editable: path.startsWith(".devdigest/specs/"),
            read_only_reason: path.startsWith(".devdigest/specs/") ? null : "outside_root",
          } satisfies SpecFile)
        : undefined,
    isLoading: false,
    isError: h.state.docError,
    refetch: docRefetch,
  }),
  useCreateContextFile: () => ({ ...h.inert(), mutate: h.createMutate }),
  useUploadContextFile: () => ({ ...h.inert(), mutate: h.uploadMutate }),
  useSaveContextFile: h.inert,
  useDeleteContextFile: h.inert,
}));

import { ProjectContextView } from "./ProjectContextView";

const FILES: ContextFileList = {
  cloned: true,
  total: 3,
  files: [
    { path: ".devdigest/specs/a.md", kind: "specs", used_by: 0, editable: true },
    { path: "docs/b.md", kind: "docs", used_by: 3, editable: false, read_only_reason: "outside_root" },
    { path: "specs/a.md", kind: "specs", used_by: 1, editable: false, read_only_reason: "outside_root" },
  ],
};

afterEach(() => {
  cleanup();
  h.state.docError = false;
  for (const m of [listRefetch, docRefetch, createMutate, uploadMutate]) m.mockReset();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

const row = (path: string) => screen.getByRole("button", { name: new RegExp("^" + path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")) });

describe("ProjectContextView", () => {
  it("selects a document, shows heading, used-by and rendered Markdown, and refreshes", () => {
    h.state.list = { data: FILES, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    fireEvent.click(row("docs/b.md"));
    expect(screen.getByRole("heading", { name: "docs/b.md" })).toBeInTheDocument();
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
    expect(screen.getByText("rendered", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(listRefetch).toHaveBeenCalled();
  });

  it("shows the crumb, root path, local note and toolbar in order", () => {
    h.state.list = { data: FILES, isLoading: false, isError: false };
    renderView();
    expect(screen.getByLabelText("crumb")).toHaveTextContent(/^acme\/web › Project Context$/);
    expect(screen.getByText(".devdigest/specs/")).toBeInTheDocument();
    expect(screen.getByText(/exist only in this local clone/)).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .slice(0, 4)
        .map((b) => b.textContent),
    ).toEqual(["New file", "New folder", "Upload", "Refresh"]);
    fireEvent.click(row("docs/b.md"));
    expect(screen.getByLabelText("crumb")).toHaveTextContent("acme/web › Project Context › docs/b.md");
  });

  it("disables the write actions when the repo is not cloned, but not Refresh", () => {
    h.state.list = { data: { cloned: false, total: 0, files: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("This repo is not cloned yet")).toBeInTheDocument();
    for (const name of ["New file", "New folder", "Upload"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("says showing 500 of N when the listing is capped", () => {
    h.state.list = { data: { ...FILES, total: 750 }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("showing 3 of 750")).toBeInTheDocument();
  });

  it("offers Add a spec file on an empty clone, opening the name dialog pre-filled", () => {
    h.state.list = { data: { cloned: true, total: 0, files: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("No spec files yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a spec file" }));
    expect(screen.getByLabelText("Name")).toHaveValue("untitled.md");
  });

  it("selects a created file in Edit mode, an uploaded one in Preview mode, and pins a path past the cap", async () => {
    h.state.list = { data: FILES, isLoading: false, isError: false };
    const created: SpecFile = { path: ".devdigest/specs/untitled.md", content: "# x", version: VERSION, editable: true, kind: "specs" };
    createMutate.mockImplementation((_in, opts) => opts.onSuccess(created));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(createMutate.mock.calls[0]![0]).toEqual({ kind: "file", name: "untitled.md" });
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
    const pinnedRow = row(created.path);
    expect(within(pinnedRow).getByText("not in the first 500")).toBeInTheDocument();
    fireEvent.click(row("docs/b.md"));
    expect(screen.queryByText("not in the first 500")).not.toBeInTheDocument();

    const uploaded: SpecFile = { path: ".devdigest/specs/up.md", content: "# up", version: VERSION, editable: true, kind: "specs" };
    uploadMutate.mockImplementation((_in, opts) => opts.onSuccess(uploaded));
    // jsdom's File has no arrayBuffer(); browsers do.
    const file = new File(["# up"], "up.md", { type: "text/markdown" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("# up").buffer });
    fireEvent.change(screen.getByLabelText("Choose a Markdown file to upload"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true"));
    expect(uploadMutate.mock.calls[0]![0]).toMatchObject({ name: "up.md", content_base64: "IyB1cA==" });
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks before leaving unsaved edits; Cancel keeps them and Discard switches", () => {
    h.state.list = { data: FILES, isLoading: false, isError: false };
    renderView();
    fireEvent.click(row(SPEC));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(`Edit ${SPEC}`), { target: { value: "# changed" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(row("docs/b.md"));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText(`Edit ${SPEC}`)).toHaveValue("# changed");

    fireEvent.click(row("docs/b.md"));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("heading", { name: "docs/b.md" })).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("offers retry when the list or a preview fails to load", () => {
    h.state.list = { isLoading: false, isError: true };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(listRefetch).toHaveBeenCalled();
    cleanup();
    h.state.list = { data: FILES, isLoading: false, isError: false };
    h.state.docError = true;
    renderView();
    fireEvent.click(row("specs/a.md"));
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(docRefetch).toHaveBeenCalled();
  });
});
