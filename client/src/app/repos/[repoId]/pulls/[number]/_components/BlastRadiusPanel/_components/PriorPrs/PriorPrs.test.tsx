import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import type { PrHistory } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";

const usePrHistory = vi.fn();
vi.mock("@/lib/hooks/blast", () => ({
  usePrHistory: (...args: unknown[]) => usePrHistory(...args),
}));

import { PriorPrs } from "./PriorPrs";

afterEach(() => {
  cleanup();
  usePrHistory.mockReset();
});

const HISTORY: PrHistory = {
  history: [
    {
      pr_number: 401,
      title: "Introduce public API namespace",
      merged_at: "2026-03-18T00:00:00Z",
      author: "marisa.koch",
      files_overlap: ["src/api/users.ts", "src/middleware/ratelimit.ts"],
      notes: "Touched 2 of this PR's files; merged 2026-03-18.",
    },
  ],
};

function renderPanel(props?: Partial<ComponentProps<typeof PriorPrs>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <PriorPrs prId="pr1" headSha="abc123" repoFullName="acme/payments-api" {...props} />
    </NextIntlClientProvider>,
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /Prior PRs touching these files/ }));
}

describe("PriorPrs", () => {
  it("is collapsed by default and shows the count badge in the header", () => {
    usePrHistory.mockReturnValue({ data: HISTORY, isLoading: false, isError: false, refetch: vi.fn() });
    renderPanel();
    const header = screen.getByRole("button", { name: /Prior PRs touching these files/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("1");
    expect(screen.queryByText("Introduce public API namespace")).toBeNull();
  });

  it("expands to list a prior PR with its link, title, author, merged date and note", () => {
    usePrHistory.mockReturnValue({ data: HISTORY, isLoading: false, isError: false, refetch: vi.fn() });
    renderPanel();
    openPanel();

    expect(screen.getByRole("button", { name: /Prior PRs touching these files/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "#401" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/pull/401",
    );
    expect(screen.getByText("Introduce public API namespace")).toBeInTheDocument();
    expect(screen.getByText(/marisa\.koch/)).toBeInTheDocument();
    expect(screen.getByText("Touched 2 of this PR's files; merged 2026-03-18.")).toBeInTheDocument();

    const overlap = within(screen.getByRole("group", { name: "Overlapping files" }));
    expect(overlap.getByText("src/api/users.ts")).toBeInTheDocument();
    expect(overlap.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  it("renders the PR number without a link when the repo full name is unknown", () => {
    usePrHistory.mockReturnValue({ data: HISTORY, isLoading: false, isError: false, refetch: vi.fn() });
    renderPanel({ repoFullName: null });
    openPanel();

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("#401")).toBeInTheDocument();
  });

  it("shows a muted empty line when there is no prior history", () => {
    usePrHistory.mockReturnValue({ data: { history: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    renderPanel();
    openPanel();

    expect(screen.getByText("No prior merged PRs touched these files.")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    usePrHistory.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderPanel();
    openPanel();

    expect(document.querySelector(".skeleton")).not.toBeNull();
  });

  it("shows an error state and retries on failure", () => {
    const refetch = vi.fn();
    usePrHistory.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderPanel();
    openPanel();

    expect(screen.getByText("Couldn't load prior PRs.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
