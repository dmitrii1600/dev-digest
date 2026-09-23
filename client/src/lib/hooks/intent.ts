/* hooks/intent.ts — React Query hook for the Intent Layer card (L03). Same
   key-helper + sync-mutation + setQueryData shape as hooks/conventions.ts's
   ReScan: one fast POST, no SSE machinery. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord, PrIntentResponse } from "@devdigest/shared";

export const intentKey = (prId: string) => ["pr-intent", prId] as const;

export function usePrIntent(prId: string | null) {
  return useQuery({
    queryKey: intentKey(prId ?? "_"),
    queryFn: () => api.get<PrIntentResponse>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** Derive / Re-run — the response is the whole record, so it replaces the cache directly. */
export function useDeriveIntent(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: (record) => qc.setQueryData(intentKey(prId), { derived: record }),
  });
}
