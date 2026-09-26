/* hooks/blast.ts — React Query hooks over the blast module's routes (spec 09):
     GET /pulls/:id/blast-radius → BlastRadius (symbols, callers, endpoints,
     crons, degraded/reason). No LLM, no re-indexing — a plain index read.
     GET /pulls/:id/history → PrHistory ("Prior PRs touching these files",
     P3-d) — prior merged PRs from GitHub, no LLM. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius, PrHistory } from "@devdigest/shared";

/** Query-key prefix for one PR's blast map. Consumers that invalidate (e.g.
    after a resync) use this instead of re-typing the literal. */
export const blastRadiusKey = (prId: string | null | undefined) =>
  ["pr-blast-radius", prId] as const;

/** `headSha` rides in the query key (not just as a param) so a newly pushed
    commit — which changes `pr_files` via `GET /pulls/:id` — invalidates the
    cached map instead of showing stale callers. */
export function usePrBlastRadius(
  prId: string | null | undefined,
  headSha: string | null | undefined,
) {
  return useQuery({
    queryKey: [...blastRadiusKey(prId), headSha],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast-radius`),
    enabled: !!prId,
  });
}

/** Query-key prefix for one PR's prior-PR history. */
export const prHistoryKey = (prId: string | null | undefined) =>
  ["pr-history", prId] as const;

/** `headSha` rides in the query key for the same reason as `usePrBlastRadius`:
    a newly pushed commit refetches instead of showing a stale map. The
    server itself also caches by head sha (`pr_brief.json`), so a stale
    client cache still can't outrun a real recompute. */
export function usePrHistory(
  prId: string | null | undefined,
  headSha: string | null | undefined,
) {
  return useQuery({
    queryKey: [...prHistoryKey(prId), headSha],
    queryFn: () => api.get<PrHistory>(`/pulls/${prId}/history`),
    enabled: !!prId,
  });
}
