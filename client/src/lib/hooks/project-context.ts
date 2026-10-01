/* hooks/project-context.ts — React Query hooks for Project Context: the clone's
   Markdown listing, one document preview, the authoring writes under
   .devdigest/specs/, and the ordered (repo, path) attachments on an agent or a
   skill. Not re-exported from hooks/index.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../api";
import { notify } from "@/providers/toast";
import type {
  ContextAttachments,
  ContextConflictDetails,
  ContextFileCreate,
  ContextFileDeleteQuery,
  ContextFileList,
  ContextFileSave,
  ContextFileUpload,
  SpecFile,
} from "@devdigest/shared";

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

/** True once the 409 is a stale-version conflict; `details` says which kind. */
export function conflictOf(err: unknown): ContextConflictDetails | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.code !== "version_conflict") return null;
  const d = err.details as Partial<ContextConflictDetails> | undefined;
  if (!d || (d.reason !== "changed" && d.reason !== "deleted")) return null;
  return { reason: d.reason, current_version: d.current_version ?? null };
}

/** Shared by the four authoring writes: refresh the listing, then refresh or
    drop the cached document. Errors render inline (`meta.inlineError`), so the
    global mutation toast stays quiet. */
function useAfterWrite(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return (path: string, saved: SpecFile | null) => {
    void qc.invalidateQueries({ queryKey: contextFilesKey(repoId) });
    if (saved) qc.setQueryData(contextFileKey(repoId, path), saved);
    else qc.removeQueries({ queryKey: contextFileKey(repoId, path) });
  };
}

export function useCreateContextFile(repoId: string | null | undefined) {
  const after = useAfterWrite(repoId);
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (input: ContextFileCreate) => api.post<SpecFile>(`/repos/${repoId}/context/files`, input),
    onSuccess: (saved) => after(saved.path, saved),
  });
}

export function useUploadContextFile(repoId: string | null | undefined) {
  const after = useAfterWrite(repoId);
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (input: ContextFileUpload) => api.post<SpecFile>(`/repos/${repoId}/context/upload`, input),
    onSuccess: (saved) => after(saved.path, saved),
  });
}

export function useSaveContextFile(repoId: string | null | undefined) {
  const after = useAfterWrite(repoId);
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (input: ContextFileSave) => api.put<SpecFile>(`/repos/${repoId}/context/file`, input),
    onSuccess: (saved) => after(saved.path, saved),
  });
}

export function useDeleteContextFile(repoId: string | null | undefined) {
  const after = useAfterWrite(repoId);
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (input: ContextFileDeleteQuery) =>
      api.del<void>(
        `/repos/${repoId}/context/file?path=${encodeURIComponent(input.path)}&version=${encodeURIComponent(input.version)}`,
      ),
    onSuccess: (_void, input) => after(input.path, null),
  });
}
