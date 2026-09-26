/* hooks/blast.ts — React Query hook over the blast-radius route (spec 07):
     GET /pulls/:id/blast-radius → BlastRadius (symbols, callers, endpoints,
     crons, degraded/reason). No LLM, no re-indexing — a plain index read. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

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
