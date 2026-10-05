import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OnboardingPage } from "@devdigest/shared";

/**
 * Onboarding data hooks — the wire the Onboarding Tour page stands on. The view
 * tests mock this module, so nothing else proves: the hooks call the SERVER path
 * (`/repos/:id/onboarding`, not the page path `/tour`), Generate POSTs the strict
 * empty body `{}`, a successful generation replaces the cached page directly, a
 * failed one refetches (a 409 means a run is live elsewhere), and a page that
 * reports `generating` is polled so a revisit during a run shows the new tour
 * (spec EC-12 / AC-15). The `api` client is the boundary and is mocked.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api", () => ({ api }));

import { onboardingKey, useGenerateOnboarding, useOnboarding } from "./onboarding";

const page = (over: Partial<OnboardingPage> = {}): OnboardingPage => ({
  repo: { name: "api", full_name: "acme/api", default_branch: "main" },
  tour: null,
  generating: false,
  stale: false,
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

describe("useOnboarding", () => {
  it("reads the server path, and does not fetch without a repo id", async () => {
    api.get.mockResolvedValue(page());
    const { result } = renderHook(() => useOnboarding("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/repos/r1/onboarding");

    api.get.mockClear();
    renderHook(() => useOnboarding(undefined), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("polls every 3 s while the server reports generating, and stops when it does not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockResolvedValue(page({ generating: true }));
    const { result } = renderHook(() => useOnboarding("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2);

    // the run finished → a later poll sees generating:false and polling stops
    api.get.mockResolvedValue(page({ generating: false }));
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

describe("useGenerateOnboarding", () => {
  it("POSTs {} to the generate path and puts the returned page straight into the cache", async () => {
    const fresh = page({ stale: false, generating: false });
    api.post.mockResolvedValue(fresh);
    const { result } = renderHook(() => useGenerateOnboarding("r1"), { wrapper });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/repos/r1/onboarding/generate", {});
    expect(qc.getQueryData(onboardingKey("r1"))).toEqual(fresh);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("on failure refetches the page so a live run elsewhere (409) shows up as generating", async () => {
    api.get.mockResolvedValue(page({ generating: true }));
    api.post.mockRejectedValue(new Error("409"));
    qc.setQueryData(onboardingKey("r1"), page());
    const { result } = renderHook(() => useGenerateOnboarding("r1"), { wrapper });
    // an active observer is what makes invalidate refetch
    renderHook(() => useOnboarding("r1"), { wrapper });
    api.get.mockClear();

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/repos/r1/onboarding"));
  });
});
