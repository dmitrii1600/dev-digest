/* hooks/project-context.ts — React Query hooks for Project Context: the clone's
   Markdown listing, one document preview, and the ordered (repo, path)
   attachments on an agent or a skill. Not re-exported from hooks/index.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "../api";
import { notify } from "@/providers/toast";
import type { ContextAttachments, ContextFileList, SpecFile } from "@devdigest/shared";

export const contextFilesKey = (repoId: string | null | undefined) => ["context", repoId] as const;
export const contextFileKey = (repoId: string | null | undefined, path: string | null | undefined) =>
  ["context", repoId, "file", path] as const;
export const agentContextKey = (agentId: string, repoId: string | null | undefined) =>
  ["agent-context", agentId, repoId] as const;
export const skillContextKey = (skillId: string, repoId: string | null | undefined) =>
  ["skill-context", skillId, repoId] as const;

export function useContextFiles(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextFilesKey(repoId),
    queryFn: () => api.get<ContextFileList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

export function useContextFile(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: contextFileKey(repoId, path),
    queryFn: () => api.get<SpecFile>(`/repos/${repoId}/context/file?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!repoId && !!path,
  });
}

export function useAgentContext(agentId: string, repoId: string | null | undefined) {
  return useQuery({
    queryKey: agentContextKey(agentId, repoId),
    queryFn: () => api.get<ContextAttachments>(`/agents/${agentId}/context?repoId=${repoId}`),
    enabled: !!repoId,
  });
}

export function useSkillContext(skillId: string, repoId: string | null | undefined) {
  return useQuery({
    queryKey: skillContextKey(skillId, repoId),
    queryFn: () => api.get<ContextAttachments>(`/skills/${skillId}/context?repoId=${repoId}`),
    enabled: !!repoId,
  });
}

/** Shared PUT mutation. `scope` makes PUTs for one owner run serially, and the
    optimistic write keeps the count and token estimate live with no round trip. */
function useSetContext(kind: "agent" | "skill", ownerId: string, repoId: string | null | undefined) {
  const qc = useQueryClient();
  const t = useTranslations("context");
  const key = kind === "agent" ? agentContextKey(ownerId, repoId) : skillContextKey(ownerId, repoId);
  return useMutation({
    scope: { id: `context:${kind}:${ownerId}:${repoId}` },
    mutationFn: (input: { paths: string[] }) =>
      api.put<ContextAttachments>(`/${kind}s/${ownerId}/context?repoId=${repoId}`, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextAttachments>(key);
      qc.setQueryData<ContextAttachments>(key, {
        repo_id: previous?.repo_id ?? repoId ?? "",
        paths: input.paths,
      });
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      notify.error(t("saveError"));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: contextFilesKey(repoId) });
    },
  });
}

export function useSetAgentContext(agentId: string, repoId: string | null | undefined) {
  return useSetContext("agent", agentId, repoId);
}

export function useSetSkillContext(skillId: string, repoId: string | null | undefined) {
  return useSetContext("skill", skillId, repoId);
}
