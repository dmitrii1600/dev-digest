import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { ConventionCandidate, ConventionScan, ConventionsPage } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ApiError } from "@/lib/api";
import { ToastProvider } from "@/providers/toast";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/providers/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));
// The modal has its own test; here it only has to open.
vi.mock("./_components/ConventionSkillModal", () => ({
  ConventionSkillModal: () => <div role="dialog">modal</div>,
}));

let page: ConventionsPage;
let extractPending = false;
let extractError: unknown = null;
const extractMutate = vi.fn();
const updateMutate = vi.fn();
const updateMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({ data: page, isLoading: false, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: extractPending, error: extractError }),
  useUpdateCandidate: () => ({ mutate: updateMutate, mutateAsync: updateMutateAsync, isPending: false }),
}));

import { ConventionsView } from "./ConventionsView";

const SCAN: ConventionScan = {
  id: "scan1",
  repo_id: "r1",
  status: "done",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  sampled_files: ["src/api/users.ts", "src/lib/redis.ts"],
  candidates_total: 3,
  candidates_grounded: 2,
  dropped_ungrounded: 1,
  dropped_duplicate: 0,
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.001,
  error: null,
  started_at: new Date(Date.now() - 3_600_000).toISOString(),
  finished_at: new Date(Date.now() - 3_600_000).toISOString(),
};

const candidate = (over: Partial<ConventionCandidate>): ConventionCandidate => ({
  id: "c1",
  repo_id: "r1",
  category: "async",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line: 23,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "pending",
  edited: false,
  skill_id: null,
  created_at: "2026-09-20T10:00:00.000Z",
  ...over,
});

afterEach(() => {
  cleanup();
  extractMutate.mockClear();
  updateMutate.mockClear();
  updateMutateAsync.mockClear();
  extractPending = false;
  extractError = null;
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <ConventionsView repoId="r1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ConventionsView", () => {
  it("with no scan yet: heading names the repo, empty state offers Run Scan, no ReScan", () => {
    page = { scan: null, candidates: [], rejected_count: 0 };
    renderView();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    expect(screen.queryByText("ReScan")).toBeNull();
    fireEvent.click(screen.getByText("Run Scan"));
    expect(extractMutate).toHaveBeenCalledTimes(1);
  });

  it("with a scan: ReScan in the header, the detected-from line, and the cards", () => {
    page = { scan: SCAN, candidates: [candidate({}), candidate({ id: "c2", rule: "Second rule", confidence: 0.5 })], rejected_count: 0 };
    renderView();
    expect(screen.getByText("Detected from 2 sample files · last scan 1h ago")).toBeInTheDocument();
    expect(screen.queryByText("Run Scan")).toBeNull();
    fireEvent.click(screen.getByText("ReScan"));
    expect(extractMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Second rule")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 accepted")).toBeInTheDocument();
  });

  it("Create skill appears only once at least one candidate is accepted, and opens the modal", () => {
    page = { scan: SCAN, candidates: [candidate({})], rejected_count: 0 };
    renderView();
    expect(screen.queryByText("Create skill")).toBeNull();

    cleanup();
    page = {
      scan: SCAN,
      candidates: [candidate({ status: "accepted" }), candidate({ id: "c2", rule: "Second", status: "accepted" }), candidate({ id: "c3", rule: "Third" })],
      rejected_count: 1,
    };
    renderView();
    expect(screen.getByText("2 of 3 accepted")).toBeInTheDocument();
    expect(screen.getByText("1 rejected · hidden")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create skill"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("an accepted candidate already absorbed into a skill does not bring Create skill back", () => {
    page = { scan: SCAN, candidates: [candidate({ status: "accepted", skill_id: "sk1" })], rejected_count: 0 };
    renderView();
    expect(screen.queryByText("Create skill")).toBeNull();
    expect(screen.getByText("In skill")).toBeInTheDocument();
  });

  it("Deselect all returns every accepted candidate to pending", () => {
    page = {
      scan: SCAN,
      candidates: [candidate({ status: "accepted" }), candidate({ id: "c2", rule: "Second", status: "accepted" })],
      rejected_count: 0,
    };
    renderView();
    fireEvent.click(screen.getByText("Deselect all"));
    expect(updateMutateAsync).toHaveBeenCalledTimes(2);
    expect(updateMutateAsync).toHaveBeenCalledWith({ id: "c1", patch: { status: "pending" } });
  });

  it("card actions patch through the hook", () => {
    page = { scan: SCAN, candidates: [candidate({})], rejected_count: 0 };
    renderView();
    fireEvent.click(screen.getByText("Reject"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "rejected" } });
  });

  it("while scanning the button reads Scanning… and is disabled", () => {
    page = { scan: SCAN, candidates: [candidate({})], rejected_count: 0 };
    extractPending = true;
    renderView();
    const btn = screen.getByText("Scanning…").closest("button")!;
    expect(btn).toBeDisabled();
  });

  it("a repo_not_indexed failure renders its specific copy", () => {
    page = { scan: null, candidates: [], rejected_count: 0 };
    extractError = new ApiError("The repo is not indexed yet", 422, "repo_not_indexed");
    renderView();
    expect(screen.getByText("Extraction failed")).toBeInTheDocument();
    expect(screen.getByText(/not indexed yet\. Conventions are sampled/)).toBeInTheDocument();
  });

  it("a scan that found nothing shows the dropped count instead of the Run Scan empty state", () => {
    page = { scan: { ...SCAN, candidates_grounded: 0, dropped_ungrounded: 4 }, candidates: [], rejected_count: 0 };
    renderView();
    expect(screen.getByText("The scan found no grounded conventions")).toBeInTheDocument();
    expect(screen.getByText(/4 candidates were dropped/)).toBeInTheDocument();
    expect(screen.getByText("ReScan")).toBeInTheDocument();
  });
});
