/* hooks/conventions.ts — React Query hooks for the Conventions page (L02,
   second half). Same shape as hooks/skills.ts: thin wrappers over `api.*`,
   one query key per repo, invalidate-on-mutate. The extract call is
   synchronous (one POST, ~15–40 s), so there is nothing to poll. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionSkillDraft,
  ConventionStatus,
  ConventionsPage,
  SkillType,
} from "@devdigest/shared";

export const conventionsKey = (repoId: string) => ["conventions", repoId] as const;

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionsKey(repoId ?? "_"),
    queryFn: () => api.get<ConventionsPage>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Run Scan / ReScan — the response is the whole page, so it replaces the cache directly. */
export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionsPage>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (page) => qc.setQueryData(conventionsKey(repoId), page),
  });
}

export interface UpdateCandidateInput {
  id: string;
  patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory };
}

/** Accept / reject / edit one candidate. */
export function useUpdateCandidate(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateCandidateInput) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: conventionsKey(repoId) }),
  });
}

/** The editable draft — a POST that writes nothing; fired once when the modal opens. */
export function usePreviewConventionSkill(repoId: string) {
  return useMutation({
    mutationFn: (candidateIds?: string[]) =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill/preview`, {
        ...(candidateIds ? { candidate_ids: candidateIds } : {}),
      }),
  });
}

export interface CreateConventionSkillInput {
  candidate_ids?: string[];
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled: boolean;
  agent_ids: string[];
}

/** Create the skill from the (edited) draft and bind it to the chosen agents. */
export function useCreateConventionSkill(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConventionSkillInput) =>
      api.post<{ skill_id: string }>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: conventionsKey(repoId) });
      qc.invalidateQueries({ queryKey: ["skills"] });
      for (const agentId of input.agent_ids) {
        qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      }
    },
  });
}
