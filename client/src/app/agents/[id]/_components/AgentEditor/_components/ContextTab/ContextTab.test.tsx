import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/context.json";

const mutate = vi.fn();
let repoId: string | null = "r1";
let attachedError = false;
let emptyList = false;
const listRefetch = vi.fn();
vi.mock("@/providers/repo-context", () => ({ useActiveRepo: () => ({ repoId }) }));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextFiles: () => ({
    data: {
      cloned: true,
      total: emptyList ? 0 : 2,
      files: emptyList
        ? []
        : [
            { path: "docs/b.md", kind: "docs", tokens: 20 },
            { path: "specs/a.md", kind: "specs", tokens: 10 },
          ],
    },
    isLoading: false,
    isError: false,
    refetch: listRefetch,
  }),
  useAgentContext: () => ({ data: { repo_id: "r1", paths: ["specs/a.md"] }, isLoading: false, isError: attachedError, refetch: vi.fn() }),
  useSetAgentContext: () => ({ mutate }),
  useContextFile: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
  repoId = "r1";
  attachedError = false;
  emptyList = false;
  listRefetch.mockClear();
});

describe("Agent ContextTab", () => {
  it("persists the whole ordered list when a row is checked", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="a1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /docs\/b\.md/ }));
    expect(mutate).toHaveBeenCalledWith({ paths: ["specs/a.md", "docs/b.md"] });
  });

  it("refetches the listing from the empty state's Refresh action", () => {
    emptyList = true;
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="a1" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(listRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders the no-repo empty state when no repository is active", () => {
    repoId = null;
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="a1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.picker.noRepo)).toBeInTheDocument();
  });

  it("shows the error state when the attachments query fails", () => {
    attachedError = true;
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab agentId="a1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.listError)).toBeInTheDocument();
  });
});
