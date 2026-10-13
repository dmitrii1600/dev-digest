/* hooks/multi-review.ts — start a multi-agent review, read its results, and the
   per-agent run estimates shown in the pickers. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentRunEstimate, MultiReviewDetail, MultiReviewStarted } from "@devdigest/shared";

export const agentRunEstimatesKey = ["agent-run-estimates"] as const;

export function useAgentRunEstimates() {
  return useQuery({
    queryKey: agentRunEstimatesKey,
    queryFn: () => api.get<AgentRunEstimate[]>("/agents/run-estimates"),
  });
}

export function useStartMultiReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiReviewStarted>(`/pulls/${prId}/multi-review`, { agentIds }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}

export const multiReviewKey = (id: string) => ["multi-review", id] as const;

/** Re-read every 2 s while any agent run is in flight (status "running" or
   unknown); stop once every run has ended. There is no "queued" status. */
export function multiReviewRefetchInterval(data?: MultiReviewDetail): number | false {
  if (!data) return false;
  const inFlight = data.agents.some((a) => a.run.status === "running" || a.run.status == null);
  return inFlight ? 2000 : false;
}

export function useMultiReview(id: string) {
  return useQuery({
    queryKey: multiReviewKey(id),
    queryFn: () => api.get<MultiReviewDetail>(`/multi-reviews/${id}`),
    refetchInterval: (q) => multiReviewRefetchInterval(q.state.data),
    retry: false, // a 404/422 must surface at once (not-found state)
  });
}
