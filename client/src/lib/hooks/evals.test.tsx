import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EvalCaseInput, EvalDashboard } from "@devdigest/shared";

/**
 * Eval data hooks. The screen tests mock this module, so nothing else proves
 * the wire behaviour the specs lean on: POST bodies are the strict `{}` (an
 * empty body 422s against `z.object({}).strict()`), a 409 on "Run all evals"
 * refetches so the live run shows as running (EC-6), the agent dashboard polls
 * only while the SERVER reports a run (AC-6), and Compare does not fetch until
 * two runs are chosen. The `api` client is the boundary and is mocked.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), api }));

import { ApiError } from "../api";
import {
  agentEvalDashboardKey,
  useAgentEvalDashboard,
  useCreateEvalCase,
  useCreateEvalCaseFromFinding,
  useDeleteEvalCase,
  useEvalCaseRunState,
  useEvalRunComparison,
  useSkillEvalCases,
  useSkillEvalDashboard,
  useStartCaseRun,
  useStartEvalRun,
  useStartSkillEvalRun,
  useUpdateEvalCase,
} from "./evals";

const dash = (running: boolean): EvalDashboard =>
  ({ running: running ? { id: "run-1", status: "running" } : null }) as unknown as EvalDashboard;

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.del.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useStartEvalRun / useCreateEvalCaseFromFinding", () => {
  it("POST the strict empty object, and a success refetches the dashboards", async () => {
    api.get.mockResolvedValue(dash(false));
    api.post.mockResolvedValue({ id: "run-1" });
    const { result } = renderHook(
      () => ({ q: useAgentEvalDashboard("ag1"), m: useStartEvalRun("ag1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    api.get.mockClear();

    act(() => result.current.m.mutate());
    await waitFor(() => expect(result.current.m.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/agents/ag1/eval-runs", {});
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/agents/ag1/eval-dashboard"));
  });

  it("creating a case POSTs {} to the finding and refetches the case list and dashboards", async () => {
    api.get.mockResolvedValue(dash(false));
    api.post.mockResolvedValue({ case: { id: "c1" }, created: true });
    qc.setQueryData(agentEvalDashboardKey("ag1"), dash(false));
    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), { wrapper });
    renderHook(() => useAgentEvalDashboard("ag1"), { wrapper });
    api.get.mockClear();

    act(() => result.current.mutate("f1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/findings/f1/eval-case", {});
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/agents/ag1/eval-dashboard"));
  });

  it("EC-6: a 409 refetches so the live run shows; any other failure does not", async () => {
    api.get.mockResolvedValue(dash(true));
    const { result } = renderHook(
      () => ({ q: useAgentEvalDashboard("ag1"), m: useStartEvalRun("ag1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));

    api.post.mockRejectedValueOnce(new ApiError("already running", 409, "eval_run_in_progress"));
    api.get.mockClear();
    act(() => result.current.m.mutate());
    await waitFor(() => expect(result.current.m.isError).toBe(true));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/agents/ag1/eval-dashboard"));

    api.post.mockRejectedValueOnce(new ApiError("no cases", 422, "eval_set_empty"));
    api.get.mockClear();
    act(() => result.current.m.mutate());
    await waitFor(() => expect((result.current.m.error as ApiError | null)?.status).toBe(422));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("useAgentEvalDashboard", () => {
  it("polls every 2 s while a run is reported running, and stops when it is not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockResolvedValue(dash(true));
    const { result } = renderHook(() => useAgentEvalDashboard("ag1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2);

    api.get.mockResolvedValue(dash(false));
    for (let i = 0; i < 3 && result.current.data?.running; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    }
    expect(result.current.data?.running).toBeNull();
    const settled = api.get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.get.mock.calls.length).toBe(settled);
  });

  it("does not fetch without an agent id", () => {
    renderHook(() => useAgentEvalDashboard(undefined), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("useEvalRunComparison", () => {
  it("fetches only once both runs are chosen, and sends both ids", async () => {
    api.get.mockResolvedValue({ older: {}, newer: {} });
    const { rerender } = renderHook(({ a, b }) => useEvalRunComparison("ag1", a, b), {
      wrapper,
      initialProps: { a: "r1" as string | null, b: null as string | null },
    });
    expect(api.get).not.toHaveBeenCalled();

    rerender({ a: "r1", b: "r2" });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/agents/ag1/eval-runs/compare?a=r1&b=r2"));
  });
});

const INPUT: EvalCaseInput = {
  name: "stripe-key-leak",
  input_diff: "diff",
  input_meta: { pr_title: "t", pr_body: "" },
  expectation: "must_find",
  target: { file: "src/config.ts", start_line: 10, end_line: 10 },
};

describe("case authoring hooks", () => {
  it("create POSTs the input to the owner's collection, update PUTs it, and both refetch every eval view", async () => {
    api.get.mockResolvedValue([]);
    api.post.mockResolvedValue({ id: "c1" });
    api.put.mockResolvedValue({ id: "c1" });
    const { result } = renderHook(
      () => ({
        agent: useCreateEvalCase({ kind: "agent", id: "ag1" }),
        skill: useCreateEvalCase({ kind: "skill", id: "sk1" }),
        upd: useUpdateEvalCase(),
        cases: useSkillEvalCases("sk1"),
        state: useEvalCaseRunState("c1"),
        sdash: useSkillEvalDashboard("sk1"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cases.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.state.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.sdash.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/skills/sk1/eval-cases");

    api.get.mockClear();
    act(() => result.current.agent.mutate(INPUT));
    await waitFor(() => expect(result.current.agent.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/agents/ag1/eval-cases", INPUT);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/skills/sk1/eval-cases"));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/eval-cases/c1/runs/latest"));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/skills/sk1/eval-dashboard"));

    act(() => result.current.skill.mutate(INPUT));
    await waitFor(() => expect(result.current.skill.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/skills/sk1/eval-cases", INPUT);

    act(() => result.current.upd.mutate({ caseId: "c1", input: INPUT }));
    await waitFor(() => expect(result.current.upd.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith("/eval-cases/c1", INPUT);
  });

  it("a case run sends {} for an agent case and { host_agent_id } for a skill case", async () => {
    api.post.mockResolvedValue({ id: "run-1" });
    const { result } = renderHook(() => useStartCaseRun(), { wrapper });

    act(() => result.current.mutate({ caseId: "c1" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenLastCalledWith("/eval-cases/c1/runs", {});

    act(() => result.current.mutate({ caseId: "c2", hostAgentId: "ag9" }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith("/eval-cases/c2/runs", { host_agent_id: "ag9" }));
  });

  it("a skill suite run sends the host id, and a 409 refetches the skill dashboard", async () => {
    api.get.mockResolvedValue(dash(true));
    api.post.mockResolvedValueOnce({ id: "run-1" });
    const { result } = renderHook(
      () => ({ q: useSkillEvalDashboard("sk1"), m: useStartSkillEvalRun("sk1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    act(() => result.current.m.mutate("ag9"));
    await waitFor(() => expect(result.current.m.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/skills/sk1/eval-runs", { host_agent_id: "ag9" });

    api.post.mockRejectedValueOnce(new ApiError("already running", 409, "eval_run_in_progress"));
    api.get.mockClear();
    act(() => result.current.m.mutate("ag9"));
    await waitFor(() => expect(result.current.m.isError).toBe(true));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/skills/sk1/eval-dashboard"));
  });

  it("polls the case run state while a single run is live and stops once it is not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const live = { latest: null, running: { id: "r1", status: "running" } };
    const idle = { latest: null, running: null };
    api.get.mockResolvedValue(live);
    const { result } = renderHook(() => useEvalCaseRunState("c1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2);

    api.get.mockResolvedValue(idle);
    for (let i = 0; i < 3 && result.current.data?.running; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    }
    expect(result.current.data?.running).toBeNull();
    const settled = api.get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.get.mock.calls.length).toBe(settled);
  });

  it("does not fetch the case run state or the skill dashboard without an id", () => {
    renderHook(() => ({ a: useEvalCaseRunState(undefined), b: useSkillEvalDashboard(null) }), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("deleting a case refetches the skill case list too (prefix invalidation)", async () => {
    api.get.mockResolvedValue({ cases: [], passing: 0, total: 0, latest_run_id: null });
    api.del.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => ({ q: useSkillEvalCases("sk1"), d: useDeleteEvalCase("sk1") }), { wrapper });
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    api.get.mockClear();
    act(() => result.current.d.mutate("c1"));
    await waitFor(() => expect(result.current.d.isSuccess).toBe(true));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/skills/sk1/eval-cases"));
  });
});
