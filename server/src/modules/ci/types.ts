import type {
  CiFailOn,
  CiInstallation,
  CiPostAs,
  CiRun,
  CiTrigger,
  RunTrace,
} from '@devdigest/shared';

/**
 * Plain data shapes exchanged between the CI service (ring 2) and its ring-3
 * readers. The repositories map rows to these and to the wire contracts, so
 * the service never sees a Drizzle row.
 */

/** What an installation remembers about the export that created it. */
export interface CiExportMeta {
  model: string;
  provider: string;
  skills: string[];
  ci_fail_on: CiFailOn;
  triggers: CiTrigger[];
  post_as: CiPostAs;
  manifest_path: string;
  runner_sha256: string;
}

export interface RunnerBundle {
  files: { name: string; contents: string }[];
  /** Hex sha256 of `index.js`. */
  sha256: string;
}

/** The locally built `agent-runner/dist/`, or `null` when it was not built. */
export interface RunnerBundleSource {
  read(): Promise<RunnerBundle | null>;
}

export interface CiAgentRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: string;
  ciFailOn: CiFailOn;
  version: number;
}

export interface CiSkillRow {
  name: string;
  source: string;
  body: string;
}

export interface CiRepoRow {
  id: string;
  fullName: string;
  defaultBranch: string;
}

export interface StoredInstallation {
  installation: CiInstallation;
  githubRepoId: number | null;
  meta: CiExportMeta | null;
  agentName: string;
}

export interface UpsertInstallation {
  agentId: string;
  repo: string;
  agentVersion: number;
  exportMeta: CiExportMeta;
  /** Left untouched on an existing row when omitted. */
  githubRepoId?: number;
}

export interface NewCiRun {
  workspaceId: string;
  installationId: string;
  agentId: string;
  githubRunId: number;
  prNumber: number | null;
  prTitle: string;
  headSha: string | null;
  ranAt: Date;
  githubUrl: string;
  status: 'succeeded' | 'no_findings' | 'failed';
  findingsCount: number | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  costUsd: number | null;
  durationMs: number | null;
  provider: string;
  model: string;
  blockers: number | null;
  /** `result_rejected` / `no_result` on a failed run, else null. */
  error: string | null;
  trace: RunTrace;
}

export interface CiStore {
  getAgent(workspaceId: string, id: string): Promise<CiAgentRow | null>;
  enabledSkills(agentId: string): Promise<CiSkillRow[]>;
  findRepo(workspaceId: string, fullName: string): Promise<CiRepoRow | null>;
  getRepoById(workspaceId: string, id: string): Promise<CiRepoRow | null>;
  repoMemory(workspaceId: string, repoId: string): Promise<{ kind: string; content: string }[]>;
  installationForRepo(workspaceId: string, fullName: string): Promise<StoredInstallation | null>;
  listInstallations(workspaceId: string, agentId?: string): Promise<StoredInstallation[]>;
  upsertInstallation(input: UpsertInstallation): Promise<StoredInstallation>;
  setGithubRepoId(installationId: string, githubRepoId: number): Promise<void>;
  knownRunIds(installationId: string): Promise<Set<number>>;
  /** Stores a run once; `false` when that GitHub run id was already stored. */
  recordRun(input: NewCiRun): Promise<boolean>;
  listRuns(workspaceId: string, filters: { agentId?: string; repo?: string }): Promise<CiRun[]>;
}
