/* hooks/evals.ts — React Query hooks over the evals module's routes:
     POST   /findings/:id/eval-case          → EvalCaseCreateResult (201 new, 200 existing)
     GET    /agents/:id/eval-cases           → EvalCaseList
     DELETE /eval-cases/:id
     POST   /agents/:id/eval-runs            → 202 EvalSuiteRun (status `running`)
     GET    /agents/:id/eval-runs            → EvalSuiteRun[]
     GET    /agents/:id/eval-runs/compare    → EvalRunComparison
     GET    /eval-runs/:id                   → EvalSuiteRunDetail
     GET    /eval/dashboard                  → EvalDashboard (workspace)
     GET    /agents/:id/eval-dashboard       → EvalDashboard (one agent)
   A run executes on the server after the 202, so the run list and the agent
   dashboard poll while one is `running`. POST bodies are strict `{}` — an
   empty body would 422 against `z.object({}).strict()`. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  EvalCaseCreateResult,
  EvalCaseList,
  EvalDashboard,
  EvalRunComparison,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from "@devdigest/shared";

const POLL_MS = 2000;

export const evalCasesKey = (agentId: string | null | undefined) => ["eval-cases", agentId] as const;
export const evalRunsKey = (agentId: string | null | undefined) => ["eval-runs", agentId] as const;
export const evalRunKey = (id: string | null | undefined) => ["eval-run", id] as const;
export const evalDashboardKey = () => ["eval-dashboard"] as const;
export const agentEvalDashboardKey = (agentId: string | null | undefined) =>
  ["agent-eval-dashboard", agentId] as const;
export const evalCompareKey = (agentId: string | null | undefined, a: string | null, b: string | null) =>
  ["eval-compare", agentId, a, b] as const;

/** Every query a changed case set or a finished run can make stale. */
function invalidateEvals(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["eval-cases"] });
  qc.invalidateQueries({ queryKey: ["eval-runs"] });
  qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
  qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
}

export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalCasesKey(agentId),
    queryFn: () => api.get<EvalCaseList>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** Turn a decided finding into an eval case. `created: false` = it already was one. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCaseCreateResult>(`/findings/${findingId}/eval-case`, {}),
    onSuccess: () => invalidateEvals(qc),
  });
}

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalCasesKey(agentId) });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
    },
  });
}

export function useAgentEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalRunsKey(agentId),
    queryFn: () => api.get<EvalSuiteRun[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? POLL_MS : false),
  });
}

/** Start a suite run over the agent's whole case set. The response is the `running` run. */
export function useStartEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalSuiteRun>(`/agents/${agentId}/eval-runs`, {}),
    onSuccess: () => invalidateEvals(qc),
    // A 409 means a run is already live; a refetch shows it as `running`.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) invalidateEvals(qc);
    },
  });
}

export function useEvalRun(id: string | null | undefined) {
  return useQuery({
    queryKey: evalRunKey(id),
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? POLL_MS : false),
  });
}

/** Two runs of one agent, older → newer. Enabled only with both ids. */
export function useEvalRunComparison(agentId: string | null | undefined, a: string | null, b: string | null) {
  return useQuery({
    queryKey: evalCompareKey(agentId, a, b),
    queryFn: () =>
      api.get<EvalRunComparison>(
        `/agents/${agentId}/eval-runs/compare?a=${encodeURIComponent(a ?? "")}&b=${encodeURIComponent(b ?? "")}`,
      ),
    enabled: !!agentId && !!a && !!b,
    retry: false,
  });
}

/** Workspace dashboard: one card per agent that has cases + recent runs. */
export function useEvalDashboard() {
  return useQuery({
    queryKey: evalDashboardKey(),
    queryFn: () => api.get<EvalDashboard>("/eval/dashboard"),
    refetchInterval: (q) => (q.state.data?.recent_runs.some((r) => r.status === "running") ? POLL_MS : false),
  });
}

/** One agent's dashboard; polls while a run is in flight. */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentEvalDashboardKey(agentId),
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
    refetchInterval: (q) => (q.state.data?.running ? POLL_MS : false),
  });
}
