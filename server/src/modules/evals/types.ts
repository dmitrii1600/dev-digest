import type {
  EvalCase,
  EvalCaseMeta,
  EvalCaseResult,
  EvalExpectation,
  EvalExpectedFinding,
  EvalMetrics,
  EvalRunCaseRef,
  EvalRunSkill,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  EvalTarget,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';

/**
 * Plain data shapes exchanged between the evals service (ring 2) and the evals
 * repository (ring 3). The repository maps rows to these and to the wire
 * contracts, so the service never sees a Drizzle row.
 */

/** Everything a case needs from the finding it is made from. */
export interface FindingSource {
  finding: {
    id: string;
    title: string;
    severity: string;
    category: string;
    file: string;
    startLine: number;
    endLine: number;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  /** The agent that produced the finding's review; null when it was not recorded. */
  agentId: string | null;
  pull: { id: string; number: number; title: string; body: string | null; base: string; headSha: string };
  repo: { owner: string; name: string };
}

/** The slice of an agent a run reads. */
export interface EvalAgent {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  version: number;
}

/** Whose case set or run history is read: an agent, or a skill evaluated on a host agent. */
export interface EvalOwner {
  kind: 'agent' | 'skill';
  id: string;
}

/** The slice of a skill an eval run reads: its current body and version. */
export interface EvalSkill {
  id: string;
  name: string;
  source: string;
  body: string;
  version: number;
}

export interface NewCase {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputMeta: EvalCaseMeta;
  expectedOutput: EvalExpectedFinding;
  source: 'finding' | 'manual';
  /** Null for a manual case. */
  sourceFindingId: string | null;
  expectation: EvalExpectation;
  target: EvalTarget;
  fingerprint: string;
}

/** A case made from a decided finding: the source finding is what makes it unique per owner. */
export type NewFindingCase = NewCase & { sourceFindingId: string };

/** What an edit may change. `source`, the source-finding link, the owner and `expected_output` never change. */
export interface CasePatch {
  name: string;
  inputDiff: string;
  inputMeta: EvalCaseMeta;
  expectation: EvalExpectation;
  target: EvalTarget;
  fingerprint: string;
}

export interface NewRun {
  id: string;
  workspaceId: string;
  kind: 'suite' | 'single';
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  /** The case a `single` run covers; null for a suite run. */
  singleCaseId: string | null;
  /** The agent that runs: the owner for an agent run, the host for a skill run. */
  agentId: string;
  agentVersion: number;
  provider: string;
  model: string;
  skills: EvalRunSkill[];
  caseRefs: EvalRunCaseRef[];
  casesTotal: number;
}

export type InsertRunResult =
  | { ok: true; run: EvalSuiteRun }
  | { ok: false; reason: 'already_running'; kind: 'suite' | 'single'; runId: string | null };

export interface NewCaseResult {
  runId: string;
  caseId: string;
  caseName: string;
  expectation: EvalExpectation;
  target: EvalTarget;
  fingerprint: string;
  status: 'passed' | 'failed' | 'errored';
  error: string | null;
  produced: number;
  kept: number;
  matched: number;
  nmfHits: number;
  findings: EvalCaseResult['findings'];
  durationMs: number | null;
  costUsd: number | null;
}

export interface RunPatch {
  status: 'completed' | 'partial' | 'failed';
  error: string | null;
  metrics: EvalMetrics;
  casesPassed: number;
  casesErrored: number;
  durationMs: number;
  costUsd: number | null;
  finishedAt: Date;
}

export interface AgentWithCases {
  agentId: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
  casesTotal: number;
}

/** The newest single-case run of a case that has a result for it. */
export interface LatestSingle {
  runId: string;
  status: 'passed' | 'failed' | 'errored';
  /** ISO timestamp of the run's start. */
  startedAt: string;
}

/** What the evals service needs from persistence. */
export interface EvalsStore {
  findingSource(workspaceId: string, findingId: string): Promise<FindingSource | undefined>;
  prFilePatch(prId: string, path: string): Promise<string | null>;
  countCases(workspaceId: string, owner: EvalOwner): Promise<number>;
  insertCaseIfAbsent(row: NewFindingCase): Promise<{ case: EvalCase; created: boolean }>;
  insertCase(row: NewCase): Promise<EvalCase>;
  updateCase(workspaceId: string, id: string, patch: CasePatch): Promise<EvalCase | undefined>;
  /** Names of the owner's cases, optionally without one case (the one being edited). */
  caseNames(workspaceId: string, owner: EvalOwner, excludeId?: string): Promise<string[]>;
  listCases(workspaceId: string, owner: EvalOwner): Promise<EvalCase[]>;
  getCase(workspaceId: string, id: string): Promise<EvalCase | undefined>;
  deleteCase(workspaceId: string, id: string): Promise<boolean>;
  insertRunningRun(row: NewRun): Promise<InsertRunResult>;
  insertCaseResult(row: NewCaseResult): Promise<void>;
  finishRun(id: string, patch: RunPatch): Promise<void>;
  /** Fail every `running` run of the workspace (any kind, any owner) not in `activeIds`. */
  failStaleRunning(workspaceId: string, activeIds: readonly string[], reason: string): Promise<void>;
  /** Suite runs of one owner. Single-case runs are never listed. */
  listRuns(
    workspaceId: string,
    owner: EvalOwner,
    opts: {
      limit: number;
      statuses?: readonly EvalSuiteRun['status'][];
      order?: 'asc' | 'desc';
      /** Only runs started at or after this instant. */
      since?: Date;
    },
  ): Promise<EvalSuiteRun[]>;
  /** An agent-owned suite run (Compare). Single and skill runs are not found. */
  getRun(workspaceId: string, id: string): Promise<EvalSuiteRun | undefined>;
  /** A run of any kind or owner, with its per-case results (polling). */
  getRunWithResults(workspaceId: string, id: string): Promise<EvalSuiteRunDetail | undefined>;
  caseStatusesForRun(runId: string): Promise<{ caseId: string; status: 'passed' | 'failed' | 'errored' }[]>;
  latestCompletedRuns(workspaceId: string, owner: EvalOwner, n: number): Promise<EvalSuiteRun[]>;
  agentsWithCases(workspaceId: string): Promise<AgentWithCases[]>;
  /** Recent agent-owned suite runs of the workspace. */
  recentRuns(workspaceId: string, limit: number): Promise<EvalSuiteRun[]>;
  /** The newest single-case run result per case, for the given cases. */
  latestSingleByCase(workspaceId: string, caseIds: readonly string[]): Promise<Map<string, LatestSingle>>;
  /** The newest result row of a case from a run of either kind, with its run. */
  latestCaseResult(
    workspaceId: string,
    caseId: string,
  ): Promise<{ run: EvalSuiteRun; result: EvalCaseResult } | undefined>;
  /** The `running` single-case run of a case, if any. */
  runningSingle(workspaceId: string, caseId: string): Promise<EvalSuiteRun | undefined>;
}
