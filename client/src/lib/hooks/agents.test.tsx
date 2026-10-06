import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * `usePromoteAgent` — promoting a recorded version rewrites the agent row, its skill links and the
 * provider/model on the eval cards, so success must refetch every one of those reads. The `api`
 * client is the boundary and is mocked.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), api }));

import { usePromoteAgent } from "./agents";

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.post.mockReset();
});
afterEach(cleanup);

describe("usePromoteAgent", () => {
  it("POSTs the promote input and invalidates the agent, its versions and links, and both eval dashboards", async () => {
    api.post.mockResolvedValue({ id: "ag1", version: 6 });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePromoteAgent("ag1"), { wrapper });

    const input = { from_version: 2, eval_run_id: "7f1c0d6e-0000-4000-8000-000000000000", expected_version: 5 };
    act(() => result.current.mutate(input));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith("/agents/ag1/promote", input);
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["agents"],
        ["agent", "ag1"],
        ["agent-version", "ag1"],
        ["agent-skills", "ag1"],
        ["eval-dashboard"],
        ["agent-eval-dashboard"],
      ]),
    );
  });

  it("does not invalidate anything when the server rejects the promotion", async () => {
    api.post.mockRejectedValue(new Error("409"));
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePromoteAgent("ag1"), { wrapper });
    act(() => result.current.mutate({ from_version: 2, eval_run_id: "7f1c0d6e-0000-4000-8000-000000000000", expected_version: 4 }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });
});
