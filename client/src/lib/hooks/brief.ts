/* hooks/brief.ts — React Query hooks over the brief module's routes:
     GET  /pulls/:id/brief → PrBriefResponse (the stored brief, `stale`,
          `generating`). No model call.
     POST /pulls/:id/brief → generate / refresh: ONE synchronous call (up to
          120 s) that returns the whole response. No body.
   The tab that sent the POST shows its skeleton from `mutation.isPending`;
   polling starts only when the SERVER reports `generating` (another tab, or a
   revisit), so the waiting tab makes no extra GETs. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefResponse } from "@devdigest/shared";

export const briefKey = (prId: string | null | undefined) => ["pr-brief", prId] as const;

const POLL_MS = 3000;

export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: briefKey(prId),
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    refetchInterval: (q) => (q.state.data?.generating ? POLL_MS : false),
  });
}

/** Generate / refresh — the response replaces the cache directly. */
export function useGenerateBrief(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: (res) => qc.setQueryData(briefKey(prId), res),
    // A 409 means a run is live elsewhere; a refetch picks up `generating`.
    onError: () => qc.invalidateQueries({ queryKey: briefKey(prId) }),
  });
}
