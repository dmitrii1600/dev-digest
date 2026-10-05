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

export interface NewCase {
  workspaceId: string;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputMeta: EvalCaseMeta;
  expectedOutput: EvalExpectedFinding;
  sourceFindingId: string;
  expectation: EvalExpectation;
  target: EvalTarget;
  fingerprint: string;
}

export interface NewRun {
  id: string;
  workspaceId: string;
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
  | { ok: false; reason: 'already_running'; runId: string | null };

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
  casesTotal: number;
}

/** What the evals service needs from persistence. */
export interface EvalsStore {
  findingSource(workspaceId: string, findingId: string): Promise<FindingSource | undefined>;
  prFilePatch(prId: string, path: string): Promise<string | null>;
  countCases(workspaceId: string, agentId: string): Promise<number>;
  insertCaseIfAbsent(row: NewCase): Promise<{ case: EvalCase; created: boolean }>;
  listCases(workspaceId: string, agentId: string): Promise<EvalCase[]>;
  getCase(workspaceId: string, id: string): Promise<EvalCase | undefined>;
  deleteCase(workspaceId: string, id: string): Promise<boolean>;
  insertRunningRun(row: NewRun): Promise<InsertRunResult>;
  insertCaseResult(row: NewCaseResult): Promise<void>;
  finishRun(id: string, patch: RunPatch): Promise<void>;
  failStaleRunning(
    workspaceId: string,
    agentId: string | null,
    activeIds: readonly string[],
    reason: string,
  ): Promise<void>;
  listRuns(
    workspaceId: string,
    agentId: string,
    opts: { limit: number; statuses?: readonly EvalSuiteRun['status'][]; order?: 'asc' | 'desc' },
  ): Promise<EvalSuiteRun[]>;
  getRun(workspaceId: string, id: string): Promise<EvalSuiteRun | undefined>;
  getRunWithResults(workspaceId: string, id: string): Promise<EvalSuiteRunDetail | undefined>;
  caseStatusesForRun(runId: string): Promise<{ caseId: string; status: 'passed' | 'failed' | 'errored' }[]>;
  latestCompletedRuns(workspaceId: string, agentId: string, n: number): Promise<EvalSuiteRun[]>;
  agentsWithCases(workspaceId: string): Promise<AgentWithCases[]>;
  recentRuns(workspaceId: string, limit: number): Promise<EvalSuiteRun[]>;
}
