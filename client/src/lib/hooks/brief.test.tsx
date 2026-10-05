import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PrBriefResponse } from "@devdigest/shared";

/**
 * Brief data hooks. The view tests mock this module, so nothing else proves:
 * the hooks hit `/pulls/:id/brief`, Generate POSTs with NO body, polling runs
 * only while the SERVER reports `generating`, a pending POST neither flips the
 * cached `generating` nor issues extra GETs, success replaces the cache, and a
 * failure (409) refetches. The `api` client is the boundary and is mocked.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api", () => ({ api }));

import { briefKey, useGenerateBrief, usePrBrief } from "./brief";

const res = (over: Partial<PrBriefResponse> = {}): PrBriefResponse => ({
  brief: null,
  stale: false,
  head_sha: "a1b2c3d4e5f6",
  generating: false,
  ...over,
});

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePrBrief", () => {
  it("reads the brief path, and does not fetch without a PR id", async () => {
    api.get.mockResolvedValue(res());
    const { result } = renderHook(() => usePrBrief("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/pulls/p1/brief");

    api.get.mockClear();
    renderHook(() => usePrBrief(undefined), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("polls every 3 s while the server reports generating, and stops when it does not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockResolvedValue(res({ generating: true }));
    const { result } = renderHook(() => usePrBrief("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2);

    api.get.mockResolvedValue(res({ generating: false }));
    for (let i = 0; i < 3 && result.current.data?.generating; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
    }
    expect(result.current.data?.generating).toBe(false);
    const settled = api.get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.get.mock.calls.length).toBe(settled);
  });
});

describe("useGenerateBrief", () => {
  it("POSTs with no body; while pending the cache is untouched and no extra GET is made; success stores the response", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockResolvedValue(res());
    let finish!: (v: PrBriefResponse) => void;
    api.post.mockReturnValue(new Promise<PrBriefResponse>((r) => (finish = r)));
    const { result } = renderHook(() => ({ q: usePrBrief("p1"), m: useGenerateBrief("p1") }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    api.get.mockClear();

    act(() => result.current.m.mutate());
    await waitFor(() => expect(result.current.m.isPending).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/pulls/p1/brief");
    expect(api.post.mock.calls[0]).toHaveLength(1);
    expect(qc.getQueryData<PrBriefResponse>(briefKey("p1"))?.generating).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.get).not.toHaveBeenCalled();

    const fresh = res({ stale: false });
    await act(async () => finish(fresh));
    await waitFor(() => expect(result.current.m.isSuccess).toBe(true));
    expect(qc.getQueryData(briefKey("p1"))).toEqual(fresh);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("on failure (409) refetches the brief so a live run elsewhere shows up as generating", async () => {
    api.get.mockResolvedValue(res({ generating: true }));
    api.post.mockRejectedValue(new Error("409"));
    qc.setQueryData(briefKey("p1"), res());
    const { result } = renderHook(() => useGenerateBrief("p1"), { wrapper });
    renderHook(() => usePrBrief("p1"), { wrapper });
    api.get.mockClear();

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/pulls/p1/brief"));
  });
});
