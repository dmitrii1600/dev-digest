import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EvalDashboard } from "@devdigest/shared";

/**
 * Eval data hooks. The screen tests mock this module, so nothing else proves
 * the wire behaviour the specs lean on: POST bodies are the strict `{}` (an
 * empty body 422s against `z.object({}).strict()`), a 409 on "Run all evals"
 * refetches so the live run shows as running (EC-6), the agent dashboard polls
 * only while the SERVER reports a run (AC-6), and Compare does not fetch until
 * two runs are chosen. The `api` client is the boundary and is mocked.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), api }));

import { ApiError } from "../api";
import {
  agentEvalDashboardKey,
  useAgentEvalDashboard,
  useCreateEvalCaseFromFinding,
  useEvalRunComparison,
  useStartEvalRun,
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
