/* hooks/skills.ts — React Query hooks for the Skills Lab (L02).
   Same shape as hooks/agents.ts: thin wrappers over `api.*`, query keys per
   entity, invalidate-on-mutate. Import transport is base64-in-JSON (see
   AddSkillModal/_components/FileTab/helpers.ts) — never multipart, api.ts stays JSON-only. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillImportPreview, SkillStats, SkillType, SkillVersion } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    /** "What changed" — recorded on `skill_versions` only when `body` actually changes. */
    note?: string;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/** Newest-first version history. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  version: number;
  note?: string;
}

/** Appends version max+1 with the chosen version's body — never rewinds history. */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, note }: RestoreSkillVersionInput) =>
      api.post<Skill>(`/skills/${id}/restore`, { version, note }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

/** Agent-attributed usage aggregates — see `SkillStats`'s doc comment in the contract. */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

/** One row per agent this skill is linked to — `GET /skills/:id/agents`. Not a
 *  shared contract (server-only DTO shape), so the type is declared here. */
export interface SkillAgentUsage {
  agent_id: string;
  agent_name: string;
  order: number;
  enabled: boolean;
}

export function useSkillAgents(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", id],
    queryFn: () => api.get<SkillAgentUsage[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

/** Base64-in-JSON upload body shared by preview and commit — see
 *  `specs/03-skills.md` for why this isn't multipart. */
export interface SkillImportInput {
  filename: string;
  content_base64: string;
  name?: string;
  description?: string;
  type?: SkillType;
}

/** Pure preview — parses the upload and writes nothing. */
export function usePreviewSkillImport() {
  return useMutation({
    mutationFn: (input: SkillImportInput) => api.post<SkillImportPreview>("/skills/import/preview", input),
  });
}

/** Re-parses the SAME bytes server-side; only name/description/type are
 *  taken from the client. Always lands `enabled: false`. */
export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillImportInput) => api.post<Skill>("/skills/import", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

/** Import-from-URL: the server fetches through its guarded `UrlFetcher`
 *  (no loopback/private hosts, size-capped) and parses like a file upload. */
export interface SkillUrlImportInput {
  url: string;
  name?: string;
  description?: string;
  type?: SkillType;
}

/** Fetch + parse, write nothing. The preview carries the injection scan. */
export function usePreviewSkillUrlImport() {
  return useMutation({
    mutationFn: (input: { url: string }) =>
      api.post<SkillImportPreview>("/skills/import/url/preview", input),
  });
}

/** Re-fetches and re-parses on commit — nothing echoed from the preview is
 *  trusted. Lands `imported_url`, `enabled: false`. */
export function useImportSkillFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillUrlImportInput) => api.post<Skill>("/skills/import/url", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}
