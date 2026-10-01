import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { ContextFileList } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/providers/repo-context", () => ({ useRepoNotFound: () => false }));

let listState: { data?: ContextFileList; isLoading: boolean; isError: boolean };
let docError = false;
const listRefetch = vi.fn();
const docRefetch = vi.fn();
vi.mock("@/lib/hooks/project-context", () => ({
  useContextFiles: () => ({ ...listState, refetch: listRefetch }),
  useContextFile: (_r: string, path: string | null) => ({
    data: path && !docError ? { path, content: "# Title\n\nrendered **body**" } : undefined,
    isLoading: false,
    isError: docError,
    refetch: docRefetch,
  }),
}));

import { ProjectContextView } from "./ProjectContextView";

const FILES: ContextFileList = {
  cloned: true,
  total: 2,
  files: [
    { path: "docs/b.md", kind: "docs", used_by: 3 },
    { path: "specs/a.md", kind: "specs", used_by: 1 },
  ],
};

afterEach(() => {
  cleanup();
  docError = false;
  listRefetch.mockClear();
  docRefetch.mockClear();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("selects a document, shows heading, used-by and rendered Markdown, and refreshes", () => {
    listState = { data: FILES, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /docs\/b\.md/ }));
    expect(screen.getByRole("heading", { name: "docs/b.md" })).toBeInTheDocument();
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
    expect(screen.getByText("rendered", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(listRefetch).toHaveBeenCalled();
  });

  it("says showing 500 of N when the listing is capped", () => {
    listState = { data: { ...FILES, total: 750 }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("showing 2 of 750")).toBeInTheDocument();
  });

  it("shows the not-cloned and no-files empty states", () => {
    listState = { data: { cloned: false, total: 0, files: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("This repo is not cloned yet")).toBeInTheDocument();
    cleanup();
    listState = { data: { cloned: true, total: 0, files: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("No Markdown files found")).toBeInTheDocument();
  });

  it("offers retry when the list or a preview fails to load", () => {
    listState = { isLoading: false, isError: true };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(listRefetch).toHaveBeenCalled();
    cleanup();
    listState = { data: FILES, isLoading: false, isError: false };
    docError = true;
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /specs\/a\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(docRefetch).toHaveBeenCalled();
  });
});
