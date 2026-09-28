import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

let blastData: BlastRadius | null = null;
let blastLoading = false;
let blastError = false;
const refetchMock = vi.fn();
vi.mock("@/lib/hooks/blast", () => ({
  blastRadiusKey: (prId: string) => ["pr-blast-radius", prId],
  prHistoryKey: (prId: string) => ["pr-history", prId],
  usePrBlastRadius: () => ({ data: blastData, isLoading: blastLoading, isError: blastError, refetch: refetchMock }),
  // The Prior PRs block has its own test; here it only has to mount quietly.
  usePrHistory: () => ({ data: { history: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
}));

let resyncPending = false;
let resyncSuccess = false;
const resyncMutate = vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => {
  opts?.onSuccess?.();
});
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: resyncMutate, isPending: resyncPending, isSuccess: resyncSuccess }),
}));

import { BlastRadiusPanel } from "./BlastRadiusPanel";

afterEach(() => {
  cleanup();
  blastData = null;
  blastLoading = false;
  blastError = false;
  resyncPending = false;
  resyncSuccess = false;
  refetchMock.mockClear();
  resyncMutate.mockClear();
});

function renderPanel(props?: Partial<React.ComponentProps<typeof BlastRadiusPanel>>) {
  const qc = new QueryClient();
  const view = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <BlastRadiusPanel
          prId="pr1"
          repoId="repo1"
          repoFullName="acme/payments-api"
          headSha="abc123"
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

const TWO_SYMBOLS_ONE_GROUP: BlastRadius = {
  changed_symbols: [
    { name: "applyRateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
    { name: "RateLimitConfig", file: "src/middleware/ratelimit.ts", kind: "interface" },
  ],
  downstream: [
    {
      symbol: "applyRateLimit",
      callers: [
        { name: "registerPublicRoutes", file: "src/api/public/webhooks.ts", line: 42 },
        { name: "createUser", file: "src/api/users.ts", line: 118 },
      ],
      endpoints_affected: ["GET /users/:id", "POST /webhooks/stripe"],
      crons_affected: ["job:digest"],
    },
  ],
  summary: "2 changed symbols; 2 callers in 2 files; 2 endpoints; 1 cron.",
  degraded: false,
  reason: null,
};

describe("BlastRadiusPanel", () => {
  it("computes the stats row from the arrays, not from summary", () => {
    blastData = TWO_SYMBOLS_ONE_GROUP;
    renderPanel();
    const stats = within(screen.getByRole("group", { name: "Blast radius summary" }));
    expect(stats.getByText("symbols", { exact: false })).toHaveTextContent("2 symbols");
    expect(stats.getByText("callers", { exact: false })).toHaveTextContent("2 callers");
    expect(stats.getByText("endpoints", { exact: false })).toHaveTextContent("2 endpoints");
    expect(stats.getByText("cron/jobs", { exact: false })).toHaveTextContent("1 cron/jobs");
  });

  it("builds a caller link at the PR head sha", () => {
    blastData = TWO_SYMBOLS_ONE_GROUP;
    renderPanel();
    const link = screen.getByRole("link", { name: "src/api/users.ts:118" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L118",
    );
  });

  it("renders endpoint and cron chips under their own symbol only", () => {
    blastData = {
      ...TWO_SYMBOLS_ONE_GROUP,
      downstream: [
        TWO_SYMBOLS_ONE_GROUP.downstream[0]!,
        {
          symbol: "RateLimitConfig",
          callers: [{ name: "createUser", file: "src/api/users.ts", line: 120 }],
          endpoints_affected: [],
          crons_affected: ["job:nightly"],
        },
      ],
    };
    renderPanel();
    // Only the first group is expanded by default; open the second one too.
    fireEvent.click(screen.getByRole("button", { name: /RateLimitConfig/ }));
    // Group A has endpoints + a cron, group B only a cron: one endpoint row
    // in total, one cron row per group, and nothing leaks across symbols.
    const endpointRows = screen.getAllByRole("group", { name: "Endpoints affected" });
    const cronRows = screen.getAllByRole("group", { name: "Crons and jobs affected" });
    expect(endpointRows).toHaveLength(1);
    expect(cronRows).toHaveLength(2);
    expect(within(endpointRows[0]!).getByText("GET /users/:id")).toBeInTheDocument();
    expect(within(endpointRows[0]!).queryByText("job:digest")).toBeNull();
    expect(within(cronRows[0]!).getByText("job:digest")).toBeInTheDocument();
    expect(within(cronRows[1]!).getByText("job:nightly")).toBeInTheDocument();
    expect(within(cronRows[1]!).queryByText("GET /users/:id")).toBeNull();
  });

  it("shows noDownstream with the changed-symbol count when there are no callers", () => {
    blastData = {
      changed_symbols: [
        { name: "a", file: "f1.ts", kind: "function" },
        { name: "b", file: "f2.ts", kind: "function" },
        { name: "c", file: "f3.ts", kind: "function" },
      ],
      downstream: [],
      summary: "3 changed symbol(s); no downstream callers found.",
      degraded: false,
      reason: null,
    };
    renderPanel();
    expect(screen.getByText("3 changed symbol(s), no downstream callers found.")).toBeInTheDocument();
  });

  it("shows noSymbols when nothing indexed", () => {
    blastData = {
      changed_symbols: [],
      downstream: [],
      summary: "No indexed symbols in the 1 changed file(s).",
      degraded: false,
      reason: null,
    };
    renderPanel();
    expect(screen.getByText("No indexed symbols in this PR's changed files.")).toBeInTheDocument();
  });

  it("shows the degraded badge and reason text, absent when not degraded", () => {
    blastData = { ...TWO_SYMBOLS_ONE_GROUP, degraded: true, reason: "index_partial" };
    renderPanel();
    expect(screen.getByText("Partial data")).toBeInTheDocument();
    expect(
      screen.getByText("The index is partial — some files were skipped, so callers may be missing."),
    ).toBeInTheDocument();

    cleanup();
    blastData = { ...TWO_SYMBOLS_ONE_GROUP, degraded: false, reason: null };
    renderPanel();
    expect(screen.queryByText("Partial data")).toBeNull();
  });

  it("renders only the title while loading", () => {
    blastLoading = true;
    renderPanel();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the blast radius.")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the error state on failure", () => {
    blastError = true;
    renderPanel();
    expect(screen.getByText("Couldn't load the blast radius.")).toBeInTheDocument();
  });

  it("toggles a group open/closed (P3-a)", () => {
    blastData = TWO_SYMBOLS_ONE_GROUP;
    renderPanel();
    // The symbol name stays the accessible name; "Collapse"/"Expand" is only a tooltip.
    const header = screen.getByRole("button", { name: /applyRateLimit/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveAttribute("title", "Collapse");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("src/api/users.ts:118")).toBeNull();
  });

  it("toggles between the tree and graph views (P3-b)", () => {
    blastData = TWO_SYMBOLS_ONE_GROUP;
    renderPanel();
    expect(screen.getByRole("button", { name: "tree", pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "graph", pressed: false }));
    expect(screen.getByRole("button", { name: "graph", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
  });

  it("shows the resync button when degraded (not flag_off), calls the mutation and invalidates the blast query (P3-c)", () => {
    blastData = { ...TWO_SYMBOLS_ONE_GROUP, degraded: true, reason: "no_data" };
    const { qc } = renderPanel();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: /Resync/ }));
    expect(resyncMutate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pr-blast-radius", "pr1"] });
  });

  it("shows the started note once the resync mutation has succeeded", () => {
    blastData = { ...TWO_SYMBOLS_ONE_GROUP, degraded: true, reason: "no_data" };
    resyncSuccess = true;
    renderPanel();
    expect(screen.getByText("Resync started — refresh in a minute.")).toBeInTheDocument();
  });

  it("hides the resync button when the reason is flag_off", () => {
    blastData = { ...TWO_SYMBOLS_ONE_GROUP, degraded: true, reason: "flag_off" };
    renderPanel();
    expect(screen.queryByRole("button", { name: /Resync/ })).toBeNull();
  });
});
