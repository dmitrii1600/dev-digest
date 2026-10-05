import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { OnboardingPage } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";

vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/providers/repo-context", () => ({ useRepoNotFound: () => false }));
vi.mock("@/components/mermaid-diagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => <div data-testid="diagram">{chart}</div>,
}));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() };
vi.mock("@/providers/toast", () => ({ useToast: () => toast }));

let queryState: { data?: OnboardingPage; isLoading: boolean; isError: boolean };
let genState: { isPending: boolean; error: unknown };
const mutate = vi.fn();
const refetch = vi.fn();
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: () => ({ ...queryState, refetch }),
  useGenerateOnboarding: () => ({ ...genState, mutate }),
}));

import { ApiError } from "@/lib/api";
import { OnboardingTourView } from "./OnboardingTourView";

const TOUR_PAGE: OnboardingPage = {
  repo: { name: "payments-api", full_name: "acme/payments-api", default_branch: "main" },
  generating: false,
  stale: false,
  tour: {
    repo_id: "r1",
    generated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    index_sha: "sha1",
    files_indexed: 42,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    architecture: { prose: "A **payments** service.", diagram: "flowchart LR\nA-->B" },
    critical_paths: [{ path: "src/server.ts", reason: "Entry point" }],
    run_locally: [{ line: "pnpm dev", source_path: "package.json" }],
    reading_path: [{ path: "src/a.ts", reason: null }],
    first_tasks: [{ text: "Add a route", paths: ["src/server.ts"] }],
  },
};

const TITLES = [
  "Architecture overview",
  "Critical paths",
  "How to run locally",
  "Guided reading path",
  "First tasks",
];

beforeEach(() => {
  queryState = { data: TOUR_PAGE, isLoading: false, isError: false };
  genState = { isPending: false, error: null };
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  mutate.mockClear();
  refetch.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingTourView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

/** The accordion headers — the "On this page" entries share their names but carry no aria-expanded. */
const sectionButtons = () =>
  TITLES.map((name) => screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-expanded"))!);

describe("OnboardingTourView", () => {
  it("shows the heading, subtitle and five sections, all expanded, in order", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Onboarding for payments-api");
    expect(screen.getByText(/42 files/)).toBeInTheDocument();
    expect(screen.getByText(/AI-generated · openrouter\/deepseek\/deepseek-v4-flash/)).toBeInTheDocument();
    const buttons = sectionButtons();
    expect(buttons.map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "true", "true", "true", "true"]);
    const order = buttons.map((b) => b.compareDocumentPosition(buttons[0]!));
    expect(order.slice(1).every((p) => p & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true);
    expect(screen.getByTestId("diagram")).toBeInTheDocument();
  });

  it("collapses one section without touching the others, and On this page re-expands and scrolls", () => {
    renderView();
    fireEvent.click(sectionButtons()[0]!);
    expect(sectionButtons().map((b) => b.getAttribute("aria-expanded"))).toEqual([
      "false",
      "true",
      "true",
      "true",
      "true",
    ]);
    // the nav entry and the section header share a name; the nav one is inside <nav>
    const nav = screen.getByRole("navigation", { name: "On this page" });
    fireEvent.click(nav.querySelectorAll("button")[0]!);
    expect(sectionButtons()[0]).toHaveAttribute("aria-expanded", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("copies the studio URL with Share link and never starts a generation", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link copied"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost:3000/repos/r1/tour");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("disables Regenerate and keeps the old tour while a generation runs", () => {
    queryState = { data: { ...TOUR_PAGE, generating: true }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
    expect(screen.getByText("Entry point")).toBeInTheDocument();
  });

  it("offers Regenerate that calls the mutation, and shows the stale notice", () => {
    queryState = { data: { ...TOUR_PAGE, stale: true }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("This tour predates the current index")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state naming the five sections, and Generate calls the mutation", () => {
    queryState = { data: { ...TOUR_PAGE, tour: null }, isLoading: false, isError: false };
    renderView();
    for (const title of TITLES) expect(screen.getByText(new RegExp(title))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate onboarding tour" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled Generating… button on the empty state while a run is live", () => {
    queryState = { data: { ...TOUR_PAGE, tour: null, generating: true }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
  });

  it("shows timeout copy with a Retry above the stored tour", () => {
    genState = {
      isPending: false,
      error: new ApiError("x", 502, "generation_failed", { reason: "timeout" }),
    };
    renderView();
    expect(screen.getByText("Generation did not finish within 120 seconds. Nothing was saved.")).toBeInTheDocument();
    expect(screen.getByText("Entry point")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("names the provider and links to Settings when the key is missing", () => {
    genState = {
      isPending: false,
      error: new ApiError("x", 422, "provider_key_missing", { provider: "openrouter" }),
    };
    renderView();
    expect(screen.getByRole("alert")).toHaveTextContent("No API key is set for openrouter.");
    expect(screen.getByRole("link", { name: "Open Settings → API Keys" })).toHaveAttribute("href", "/settings/api-keys");
  });

  it("explains why a repo cannot be indexed when repo-intel is off", () => {
    queryState = { data: { ...TOUR_PAGE, tour: null }, isLoading: false, isError: false };
    genState = {
      isPending: false,
      error: new ApiError("x", 422, "repo_not_indexed", { reason: "flag_off" }),
    };
    renderView();
    expect(
      screen.getByText("Repo indexing is switched off, so there is nothing to build the tour from."),
    ).toBeInTheDocument();
  });

  it("offers Retry when the page fails to load", () => {
    queryState = { data: undefined, isLoading: false, isError: true };
    renderView();
    expect(screen.getByText("Couldn’t load the onboarding tour")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});

/* Added by the test-writer pass: wiring and states the first block does not pin. */
describe("OnboardingTourView — wiring and states", () => {
  const errors = messages.errors;

  it("AC-2: the subtitle shows the time since generation, and every visit starts with all sections expanded", () => {
    const first = renderView();
    expect(screen.getByText(/last refreshed 2 hours ago/)).toBeInTheDocument();
    fireEvent.click(sectionButtons()[2]!);
    expect(sectionButtons()[2]).toHaveAttribute("aria-expanded", "false");
    first.unmount();

    renderView();
    expect(sectionButtons().map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "true", "true", "true", "true"]);
  });

  it("AC-4: picking a collapsed section in On this page expands THAT section and scrolls to it", () => {
    renderView();
    fireEvent.click(sectionButtons()[4]!); // First tasks → collapsed
    expect(sectionButtons()[4]).toHaveAttribute("aria-expanded", "false");

    const nav = screen.getByRole("navigation", { name: "On this page" });
    fireEvent.click(Array.from(nav.querySelectorAll("button")).find((b) => b.textContent === "First tasks")!);

    expect(sectionButtons()[4]).toHaveAttribute("aria-expanded", "true");
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts as HTMLElement[];
    expect(scrolled.map((el) => el.id)).toEqual(["tour-first_tasks"]);
  });

  it("AC-13: every file link opens the repo's DEFAULT branch, not a hard-coded one", () => {
    queryState = {
      data: { ...TOUR_PAGE, repo: { ...TOUR_PAGE.repo, default_branch: "develop" } },
      isLoading: false,
      isError: false,
    };
    renderView();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThanOrEqual(3); // critical path Open, reading path, task
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/github\.com\/acme\/payments-api\/blob\/develop\//);
  });

  it("AC-15: while this tab's own generation is pending Regenerate is disabled and the stored tour stays", () => {
    genState = { isPending: true, error: null };
    renderView();
    const busy = screen.getByRole("button", { name: "Generating…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Entry point")).toBeInTheDocument();
  });

  it("AC-15: no Retry is offered while a generation is running", () => {
    queryState = { data: { ...TOUR_PAGE, generating: true }, isLoading: false, isError: false };
    genState = { isPending: false, error: new ApiError("x", 409, "generation_running") };
    renderView();
    expect(screen.getByText(errors.generation_running)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  const failures: [string, ApiError | Error, string][] = [
    ["EC-2 repo_not_cloned", new ApiError("x", 422, "repo_not_cloned"), errors.repo_not_cloned],
    ["EC-3 never_indexed", new ApiError("x", 422, "repo_not_indexed", { reason: "never_indexed" }), errors.repo_not_indexed.never_indexed],
    ["EC-3 index_failed", new ApiError("x", 422, "repo_not_indexed", { reason: "index_failed" }), errors.repo_not_indexed.index_failed],
    ["EC-3 no_ranked_files", new ApiError("x", 422, "repo_not_indexed", { reason: "no_ranked_files" }), errors.repo_not_indexed.no_ranked_files],
    ["EC-4 invalid_output", new ApiError("x", 502, "generation_failed", { reason: "invalid_output" }), errors.generation_failed.invalid_output],
    ["EC-4 llm_error", new ApiError("x", 502, "generation_failed", { reason: "llm_error" }), errors.generation_failed.llm_error],
    ["an unrecognised ApiError code", new ApiError("x", 500, "something_new"), errors.unknown],
    ["a non-API failure", new Error("network down"), errors.unknown],
  ];
  it.each(failures)("%s names its own failure and offers Retry, with the stored tour still shown", (_label, error, copy) => {
    genState = { isPending: false, error };
    renderView();
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.getByText("Entry point")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("EC-8: with nothing found, every section stays in the list with its own one-line message", () => {
    queryState = {
      data: {
        ...TOUR_PAGE,
        tour: {
          ...TOUR_PAGE.tour!,
          architecture: { prose: "", diagram: null },
          critical_paths: [],
          run_locally: [],
          reading_path: [],
          first_tasks: [],
        },
      },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(sectionButtons()).toHaveLength(5);
    for (const line of Object.values(messages.sectionEmpty)) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByTestId("diagram")).not.toBeInTheDocument();
  });

  it("EC-9: no stale notice when the tour matches the current index", () => {
    renderView();
    expect(screen.queryByText("This tour predates the current index")).not.toBeInTheDocument();
  });

  it("EC-10: Share link reports a failure (no success toast) when the clipboard rejects or is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not copy to the clipboard"));

    toast.error.mockClear();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
