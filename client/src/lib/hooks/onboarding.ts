/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour page.
   They call the server's API path (`/repos/:id/onboarding`), not the page
   path (`/repos/:id/tour`). Generation is one synchronous POST (up to 120 s);
   while the server reports `generating` (a run started before this visit) the
   query polls so the new tour shows up without a reload. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingPage } from "@devdigest/shared";

export const onboardingKey = (repoId: string) => ["onboarding", repoId] as const;

const POLL_MS = 3000;

export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: onboardingKey(repoId ?? "_"),
    queryFn: () => api.get<OnboardingPage>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: (q) => (q.state.data?.generating ? POLL_MS : false),
  });
}

/** Generate / Regenerate — the response is the whole page, so it replaces the cache directly. */
export function useGenerateOnboarding(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingPage>(`/repos/${repoId}/onboarding/generate`, {}),
    onSuccess: (page) => qc.setQueryData(onboardingKey(repoId), page),
    // A 409 means a run is live elsewhere; a refetch picks up `generating` and the old tour.
    onError: () => qc.invalidateQueries({ queryKey: onboardingKey(repoId) }),
  });
}
