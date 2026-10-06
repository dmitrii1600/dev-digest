import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRunComparison, EvalSuiteRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../messages/en/eval.json";
import agentsMessages from "../../../../../../messages/en/agents.json";

const state = vi.hoisted(() => ({
  comparison: undefined as unknown,
  versions: {} as Record<number, { data?: unknown; isError?: boolean }>,
  agent: undefined as unknown,
  links: [] as unknown[],
  skills: [] as unknown[],
  promote: vi.fn(),
  promoteError: null as Error | null,
  toast: vi.fn(),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalRunComparison: () => ({ data: state.comparison, isLoading: false, isError: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({ useSkills: () => ({ data: state.skills }) }));
vi.mock("@/providers/toast", () => ({ useToast: () => ({ success: state.toast }) }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: state.agent }),
  useAgentSkillLinks: () => ({ data: state.links }),
  usePromoteAgent: () => ({
    mutate: state.promote,
    reset: vi.fn(),
    isPending: false,
    isError: state.promoteError !== null,
    error: state.promoteError,
  }),
  useAgentVersion: (_agentId: string, version: number) => {
    const v = state.versions[version] ?? {};
    return { data: v.data, isError: !!v.isError };
  },
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(cleanup);

function run(id: string, version: number, over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id,
    kind: "suite",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_id: "ag1",
    agent_version: version,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    error: null,
    skills: [],
    cases: [],
    cases_total: 4,
    cases_passed: 3,
    cases_errored: 0,
    metrics: { recall: 0.5, precision: 0.8, citation_accuracy: null },
    duration_ms: 1000,
    cost_usd: 0.01,
    started_at: "2026-10-05T10:00:00Z",
    finished_at: "2026-10-05T10:00:01Z",
    ...over,
  };
}

function comparison(over: Partial<EvalRunComparison> = {}): EvalRunComparison {
  return {
    older: run("a", 1),
    newer: run("b", 2, { metrics: { recall: 0.6, precision: 0.5, citation_accuracy: null }, cost_usd: 0.02 }),
    deltas: { recall: 10, precision: -30, citation_accuracy: null, cost_usd: 0.01 },
    case_sets: { same: true, older_count: 4, newer_count: 4, edited_count: 0 },
    model_changed: false,
    skills_changed: false,
    ...over,
  };
}

function version(n: number, prompt: string) {
  return {
    agent_id: "ag1",
    version: n,
    created_at: "2026-10-05T10:00:00Z",
    config: { system_prompt: prompt },
  };
}

function renderModal(onClose: () => void = () => {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages, agents: agentsMessages }}>
      <CompareRunsModal agentId="ag1" runIds={["a", "b"]} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.agent = undefined;
  state.links = [];
  state.skills = [];
  state.promote.mockReset();
  state.promoteError = null;
  state.toast.mockReset();
  state.comparison = comparison();
  state.versions = {
    1: { data: version(1, "Be strict.\nReport bugs.") },
    2: { data: version(2, "Be strict.\nReport everything.") },
  };
});

describe("CompareRunsModal", () => {
  it("shows older → newer values with signed deltas as text, a dash for an unavailable metric", () => {
    renderModal();
    expect(screen.getByText("50.0% → 60.0%")).toBeInTheDocument();
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
    expect(screen.getByText("80.0% → 50.0%")).toBeInTheDocument();
    expect(screen.getByText("▼ −30.0 pts")).toBeInTheDocument();
    // citation is null on both sides: no value, no delta — never 0 %
    expect(screen.getByText("— → —")).toBeInTheDocument();
    expect(screen.getByText("+$0.01")).toBeInTheDocument();
    expect(screen.queryByText(/case sets differ/)).not.toBeInTheDocument();
  });

  it("warns when the case sets differ, and names a model or skill-set change", () => {
    state.comparison = comparison({
      case_sets: { same: false, older_count: 8, newer_count: 9, edited_count: 2 },
      model_changed: true,
      skills_changed: true,
    });
    renderModal();
    expect(
      screen.getByText("The case sets differ: older run 8 cases, newer run 9 cases, 2 edited."),
    ).toBeInTheDocument();
    expect(screen.getByText("Model changed between these runs.")).toBeInTheDocument();
    expect(screen.getByText("Skill set changed between these runs.")).toBeInTheDocument();
  });

  it("renders the system-prompt line diff from the two version snapshots", () => {
    renderModal();
    expect(screen.getByText("System prompt diff")).toBeInTheDocument();
    expect(screen.getByText("Report bugs.")).toBeInTheDocument();
    expect(screen.getByText("Report everything.")).toBeInTheDocument();
    expect(screen.getAllByText("Be strict.")).toHaveLength(1);
  });

  it("says so when the prompts are identical", () => {
    state.versions = { 1: { data: version(1, "Same") }, 2: { data: version(2, "Same") } };
    renderModal();
    expect(screen.getByText("System prompt unchanged.")).toBeInTheDocument();
  });

  it("keeps the deltas and says the diff is unavailable when a version snapshot cannot be read (EC-11)", () => {
    state.versions = { 1: { isError: true }, 2: { data: version(2, "x") } };
    renderModal();
    expect(
      screen.getByText("The system-prompt diff is unavailable: an agent-version snapshot could not be read."),
    ).toBeInTheDocument();
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
  });
});

/* Promote vX - runs of v2 and v4, the agent is at v5 with a prompt of its own. The v4 snapshot IS
   the agent's current configuration; the v2 snapshot differs in its prompt. */
const CURRENT = {
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Current prompt",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
};
const full = (n: number, over: Record<string, unknown> = {}) => ({
  agent_id: "ag1",
  version: n,
  created_at: "2026-10-05T10:00:00Z",
  config: { ...CURRENT, skills: [], ...over },
});

describe("CompareRunsModal - Promote", () => {
  beforeEach(() => {
    state.comparison = comparison({ older: run("a", 2), newer: run("b", 4) });
    state.agent = { id: "ag1", name: "A", version: 5, ...CURRENT };
    state.versions = { 2: { data: full(2, { system_prompt: "Old prompt" }) }, 4: { data: full(4) } };
  });

  it("AC-1/EC-1: one Promote button per run; the run that equals the current configuration is disabled as such", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Promote v2" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Promote v4" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Current configuration" })).toBeDisabled();

    state.versions = { 2: { data: full(2, { system_prompt: "Old prompt" }) }, 4: { data: full(4, { model: "gpt-5" }) } };
    cleanup();
    renderModal();
    expect(screen.getByRole("button", { name: "Promote v2" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Promote v4" })).toBeEnabled();
  });

  it("EC-5: an unreadable snapshot disables its Promote with a reason, and the metric deltas stay", () => {
    state.versions = { 2: { isError: true }, 4: { data: full(4) } };
    renderModal();
    expect(screen.getByRole("button", { name: "Version v2 cannot be read" })).toBeDisabled();
    expect(screen.getByText("▲ +10.0 pts")).toBeInTheDocument();
    expect(screen.getAllByText(/→/).length).toBeGreaterThan(0);
  });

  it("AC-2/AC-3: the confirmation lists the change; confirming sends the expected version captured when the modal opened", () => {
    const { rerender } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Promote v2" }));
    const dialogs = screen.getAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1]!;
    expect(within(confirm).getByText("System prompt")).toBeInTheDocument();

    // the agent moves on to v6 while the confirmation is open: the captured v5 is still what is sent
    state.agent = { id: "ag1", name: "A", version: 6, ...CURRENT };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: messages, agents: agentsMessages }}>
        <CompareRunsModal agentId="ag1" runIds={["a", "b"]} onClose={() => {}} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Promote" }));
    expect(state.promote).toHaveBeenCalledWith(
      { from_version: 2, eval_run_id: "a", expected_version: 5 },
      expect.anything(),
    );
  });

  it("AC-5: a successful promotion closes Compare and toasts the new version", () => {
    state.promote.mockImplementation((_input: unknown, opts: { onSuccess?: (a: { version: number }) => void }) =>
      opts.onSuccess?.({ version: 6 }),
    );
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Promote v2" }));
    const dialogs = screen.getAllByRole("dialog");
    fireEvent.click(within(dialogs[dialogs.length - 1]!).getByRole("button", { name: "Promote" }));
    expect(state.toast).toHaveBeenCalledWith("Promoted — now v6");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("EC-4: a 409 shows the reload message inline and nothing else changes", () => {
    state.promoteError = new ApiError("conflict", 409, "agent_version_conflict");
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Promote v2" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This agent changed since you opened Compare. Reload to see its current version.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
  });
});
