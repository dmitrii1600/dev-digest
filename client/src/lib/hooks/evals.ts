/* hooks/evals.ts — React Query hooks over the evals module's routes:
     POST   /findings/:id/eval-case          → EvalCaseCreateResult (201 new, 200 existing)
     GET    /agents/:id/eval-cases           → EvalCaseList
     DELETE /eval-cases/:id
     POST   /agents/:id/eval-runs            → 202 EvalSuiteRun (status `running`)
     GET    /agents/:id/eval-runs[?since=]   → EvalSuiteRun[]
     POST   /eval/run-all                    → EvalRunAllResult (one outcome per agent)
     GET    /agents/:id/eval-runs/compare    → EvalRunComparison
     GET    /eval-runs/:id                   → EvalSuiteRunDetail
     GET    /eval/dashboard                  → EvalDashboard (workspace)
     GET    /agents/:id/eval-dashboard       → EvalDashboard (one agent)
     POST   /agents|skills/:id/eval-cases    → 201 EvalCase (manual case)
     PUT    /eval-cases/:id                  → EvalCase
     GET    /skills/:id/eval-cases           → EvalCaseList
     POST   /eval-cases/:id/runs             → 202 EvalSuiteRun (kind `single`)
     GET    /eval-cases/:id/runs/latest      → EvalCaseRunState
     POST   /skills/:id/eval-runs            → 202 EvalSuiteRun (skill suite on a host agent)
     GET    /skills/:id/eval-dashboard       → EvalDashboard (one skill)
   A run executes on the server after the 202, so the run list and the agent
   dashboard poll while one is `running`. POST bodies are strict `{}` — an
   empty body would 422 against `z.object({}).strict()`; a case or skill run
   sends `{ host_agent_id }` only when a skill is being hosted. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  EvalCase,
  EvalCaseCreateResult,
  EvalCaseInput,
  EvalCaseList,
  EvalCaseRunState,
  EvalDashboard,
  EvalRunAllResult,
  EvalRunComparison,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from "@devdigest/shared";

const POLL_MS = 2000;

export const evalCasesKey = (agentId: string | null | undefined) => ["eval-cases", agentId] as const;
export const evalRunsKey = (agentId: string | null | undefined, since?: string) =>
  ["eval-runs", agentId, since ?? "all"] as const;
export const evalRunKey = (id: string | null | undefined) => ["eval-run", id] as const;
export const evalDashboardKey = () => ["eval-dashboard"] as const;
export const agentEvalDashboardKey = (agentId: string | null | undefined) =>
  ["agent-eval-dashboard", agentId] as const;
export const skillEvalCasesKey = (skillId: string | null | undefined) =>
  ["eval-cases", "skill", skillId] as const;
export const evalCaseRunStateKey = (caseId: string | null | undefined) => ["eval-case-runs", caseId] as const;
export const skillEvalDashboardKey = (skillId: string | null | undefined) =>
  ["skill-eval-dashboard", skillId] as const;
export const evalCompareKey = (agentId: string | null | undefined, a: string | null, b: string | null) =>
  ["eval-compare", agentId, a, b] as const;

/** Every query a changed case set or a finished run can make stale. */
function invalidateEvals(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["eval-cases"] });
  qc.invalidateQueries({ queryKey: ["eval-runs"] });
  qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
  qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
  qc.invalidateQueries({ queryKey: ["eval-case-runs"] });
  qc.invalidateQueries({ queryKey: ["skill-eval-dashboard"] });
}

export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalCasesKey(agentId),
    queryFn: () => api.get<EvalCaseList>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: skillEvalCasesKey(skillId),
    queryFn: () => api.get<EvalCaseList>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
  });
}

/** Write a manual case into an owner's set. The body is the strict `EvalCaseInput`. */
export function useCreateEvalCase(owner: { kind: "agent" | "skill"; id: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>(`/${owner.kind === "agent" ? "agents" : "skills"}/${owner.id}/eval-cases`, input),
    onSuccess: () => invalidateEvals(qc),
  });
}

/** Edit a case in place; the server recomputes its fingerprint. */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, input }: { caseId: string; input: EvalCaseInput }) =>
      api.put<EvalCase>(`/eval-cases/${caseId}`, input),
    onSuccess: () => invalidateEvals(qc),
  });
}

/** Run one saved case. `hostAgentId` is for a skill-owned case only; an agent case sends `{}`. */
export function useStartCaseRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, hostAgentId }: { caseId: string; hostAgentId?: string }) =>
      api.post<EvalSuiteRun>(`/eval-cases/${caseId}/runs`, hostAgentId ? { host_agent_id: hostAgentId } : {}),
    onSuccess: () => invalidateEvals(qc),
    // A 409 means this case is already running; a refetch shows it.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) invalidateEvals(qc);
    },
  });
}

/** The editor's last-run read; polls while a single run of this case is live. */
export function useEvalCaseRunState(caseId: string | null | undefined) {
  return useQuery({
    queryKey: evalCaseRunStateKey(caseId),
    queryFn: () => api.get<EvalCaseRunState>(`/eval-cases/${caseId}/runs/latest`),
    enabled: !!caseId,
    refetchInterval: (q) => (q.state.data?.running ? POLL_MS : false),
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
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
    },
  });
}

/** The agent's newest suite runs; `since` (ISO datetime) limits them to a time window. */
export function useAgentEvalRuns(agentId: string | null | undefined, opts?: { since?: string }) {
  const since = opts?.since;
  return useQuery({
    queryKey: evalRunsKey(agentId, since),
    queryFn: () =>
      api.get<EvalSuiteRun[]>(
        `/agents/${agentId}/eval-runs${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      ),
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

/** Start one suite run per eligible agent. The strict body is `{}`; the result lists every agent's outcome. */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>("/eval/run-all", {}),
    onSettled: () => invalidateEvals(qc),
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
    refetchInterval: (q) =>
      q.state.data?.agents.some((a) => a.running) || q.state.data?.recent_runs.some((r) => r.status === "running")
        ? POLL_MS
        : false,
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

/** One skill's dashboard (its hosted suite runs); polls while a run is in flight. */
export function useSkillEvalDashboard(skillId: string | null | undefined) {
  return useQuery({
    queryKey: skillEvalDashboardKey(skillId),
    queryFn: () => api.get<EvalDashboard>(`/skills/${skillId}/eval-dashboard`),
    enabled: !!skillId,
    refetchInterval: (q) => (q.state.data?.running ? POLL_MS : false),
  });
}

/** Run a skill's whole case set on a chosen host agent. The response is the `running` run. */
export function useStartSkillEvalRun(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hostAgentId: string) =>
      api.post<EvalSuiteRun>(`/skills/${skillId}/eval-runs`, { host_agent_id: hostAgentId }),
    onSuccess: () => invalidateEvals(qc),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) invalidateEvals(qc);
    },
  });
}
