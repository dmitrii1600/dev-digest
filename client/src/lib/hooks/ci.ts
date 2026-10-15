/* hooks/ci.ts — React Query hooks for Export-to-CI: an agent's installations and
   runs, the export preview, install/update, and the pull-based run refresh.
   Not re-exported from hooks/index.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentCi,
  CiExport,
  CiExportInputBody,
  CiPostAs,
  CiPreview,
  CiRefreshResult,
  CiRun,
  CiTrigger,
  CiUpdateResult,
} from "@devdigest/shared";

export const agentCiKey = (agentId: string) => ["agent-ci", agentId] as const;
export const ciPreviewKey = (agentId: string, repo: string, triggers: CiTrigger[], postAs: CiPostAs) =>
  ["ci-preview", agentId, repo, triggers.join(","), postAs] as const;
export const ciRunsKey = (filters: { agentId?: string; repoId?: string }) =>
  ["ci-runs", filters.agentId ?? null, filters.repoId ?? null] as const;

export function useAgentCi(agentId: string) {
  return useQuery({
    queryKey: agentCiKey(agentId),
    queryFn: () => api.get<AgentCi>(`/agents/${agentId}/ci`),
  });
}

export interface CiPreviewParams {
  repo: string;
  triggers: CiTrigger[];
  postAs: CiPostAs;
}

export function useCiPreview(agentId: string, params: CiPreviewParams, enabled: boolean) {
  const { repo, triggers, postAs } = params;
  return useQuery({
    queryKey: ciPreviewKey(agentId, repo, triggers, postAs),
    queryFn: () => {
      const qs = new URLSearchParams({ repo, post_as: postAs, triggers: triggers.join(",") });
      return api.get<CiPreview>(`/agents/${agentId}/export-ci/preview?${qs.toString()}`);
    },
    enabled: enabled && !!repo && triggers.length > 0,
    retry: false,
  });
}

export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentCiKey(agentId) }),
  });
}

export function useUpdateCiConfig(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiUpdateResult>(`/agents/${agentId}/ci/update`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentCiKey(agentId) }),
  });
}

export function useCiRuns(filters: { agentId?: string; repoId?: string } = {}) {
  return useQuery({
    queryKey: ciRunsKey(filters),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.agentId) qs.set("agent_id", filters.agentId);
      if (filters.repoId) qs.set("repo_id", filters.repoId);
      const q = qs.toString();
      return api.get<CiRun[]>(`/ci/runs${q ? `?${q}` : ""}`);
    },
  });
}

export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { agent_id?: string } = {}) => api.post<CiRefreshResult>("/ci/runs/refresh", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
      qc.invalidateQueries({ queryKey: ["agent-ci"] });
    },
  });
}
