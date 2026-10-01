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
      total: 3,
      files: [
        { path: "docs/b.md", kind: "docs", tokens: 20 },
        { path: "specs/a.md", kind: "specs", tokens: 10 },
        { path: "INSIGHTS.md", kind: "insights", tokens: 5 },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSkillContext: () => ({ data: { repo_id: "r1", paths: ["specs/a.md", "INSIGHTS.md"] }, isLoading: false, isError: attachedError, refetch: vi.fn() }),
  useSetSkillContext: () => ({ mutate }),
  useContextFile: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
  repoId = "r1";
  attachedError = false;
});

describe("Skill ContextTab", () => {
  it("shows the inherit note and SERIALIZES AS in attached order, and toggling calls the skill mutation", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skillId="s1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    expect(screen.getByTestId("serializes-as").textContent).toBe("specs/a.md\nINSIGHTS.md");
    fireEvent.click(screen.getByRole("checkbox", { name: /docs\/b\.md/ }));
    expect(mutate).toHaveBeenCalledWith({ paths: ["specs/a.md", "INSIGHTS.md", "docs/b.md"] });
  });

  it("renders the no-repo empty state when no repository is active", () => {
    repoId = null;
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skillId="s1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.picker.noRepo)).toBeInTheDocument();
  });

  it("shows the error state when the attachments query fails", () => {
    attachedError = true;
    render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextTab skillId="s1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(messages.listError)).toBeInTheDocument();
  });
});
