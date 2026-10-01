import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/context.json";

const mutate = vi.fn();
let repoId: string | null = "r1";
let attachedError = false;
vi.mock("@/providers/repo-context", () => ({ useActiveRepo: () => ({ repoId }) }));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextFiles: () => ({
    data: {
      cloned: true,
      total: 2,
      files: [
        { path: "docs/b.md", kind: "docs", tokens: 20 },
        { path: "specs/a.md", kind: "specs", tokens: 10 },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
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
