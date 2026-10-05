import type {
  ContextAttachments,
  ContextFileCreate,
  ContextFileDeleteQuery,
  ContextFileList,
  ContextFileSave,
  ContextFileUpload,
  SpecFile,
} from '@devdigest/shared';

/**
 * The Project Context port — the `IntentPort` precedent. `run-executor.ts`
 * reaches this ONLY through `Container['projectContext']` (a type-only edge),
 * never by importing `modules/project-context/*` (`no-cross-module-reach-in`).
 */

export interface ResolvedProjectContext {
  /** In injection order; full text up to the per-document cap. */
  docs: { path: string; content: string }[];
  /** Attached paths that were missing or unreadable at run start. */
  skipped: string[];
  /** Paths whose text was cut at the per-document cap. */
  truncated: string[];
  /** Sum of the wrapped blocks' tokens. */
  tokens: number;
}

export interface ProjectContextPort {
  list(workspaceId: string, repoId: string): Promise<ContextFileList>;
  file(workspaceId: string, repoId: string, path: string): Promise<SpecFile>;
  create(workspaceId: string, repoId: string, input: ContextFileCreate): Promise<SpecFile>;
  upload(workspaceId: string, repoId: string, input: ContextFileUpload): Promise<SpecFile>;
  save(workspaceId: string, repoId: string, input: ContextFileSave): Promise<SpecFile>;
  /** Resolves with the removed file's path and size (for the route's log line). */
  remove(
    workspaceId: string,
    repoId: string,
    input: ContextFileDeleteQuery,
  ): Promise<{ path: string; bytes: number }>;
  getAgent(workspaceId: string, agentId: string, repoId: string): Promise<ContextAttachments>;
  putAgent(
    workspaceId: string,
    agentId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachments>;
  getSkill(workspaceId: string, skillId: string, repoId: string): Promise<ContextAttachments>;
  putSkill(
    workspaceId: string,
    skillId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachments>;
  /** Never throws for a missing clone or file; reads each document once. */
  resolveForRun(input: {
    repoId: string;
    clonePath: string | null;
    agentId: string;
  }): Promise<ResolvedProjectContext>;
  /**
   * The union of what every ENABLED agent of the workspace would inject, for
   * features that are not tied to one agent (the PR brief). Agents are taken
   * in `created_at asc, id asc` order; within an agent its own documents come
   * first, then its enabled skills'. The first occurrence of a path wins.
   * Never throws for a missing clone or file.
   */
  resolveForRepo(input: {
    workspaceId: string;
    repoId: string;
    clonePath: string | null;
  }): Promise<ResolvedProjectContext>;
}

/** What the service needs from persistence (implemented by `repository.ts`). */
export interface ProjectContextStore {
  getRepo(ws: string, repoId: string): Promise<{ id: string; clonePath: string | null } | null>;
  agentExists(ws: string, id: string): Promise<boolean>;
  skillExists(ws: string, id: string): Promise<boolean>;
  agentPaths(agentId: string, repoId: string): Promise<string[]>;
  skillPaths(skillId: string, repoId: string): Promise<string[]>;
  replaceAgentPaths(agentId: string, repoId: string, paths: string[]): Promise<void>;
  replaceSkillPaths(skillId: string, repoId: string, paths: string[]): Promise<void>;
  pathsForRun(
    agentId: string,
    repoId: string,
  ): Promise<{ agentPaths: string[]; skills: { skillId: string; paths: string[] }[] }>;
  usedByPairs(ws: string, repoId: string): Promise<{ agentId: string; path: string }[]>;
  /** Enabled agents of the workspace, ordered `created_at asc, id asc`. */
  enabledAgentIds(ws: string): Promise<string[]>;
}

export interface ProjectContextDeps {
  repo: ProjectContextStore;
  listMarkdown: (clonePath: string | null) => Promise<{
    cloned: boolean;
    total: number;
    files: { path: string; size: number; mtime: string }[];
  }>;
  readDoc: (
    clonePath: string,
    relPath: string,
  ) => Promise<{ text: string; truncated: boolean; version: string } | null>;
  countTokens: (text: string) => number;
  /** The clone writer (`repository-writes.ts`), typed structurally so the service never imports ring 3. */
  writes: ProjectContextWrites;
  /** Repo-relative POSIX paths tracked at HEAD under `underDir`; throws when git cannot say. */
  listTracked: (clonePath: string, underDir: string) => Promise<string[]>;
}

export type LayoutResult =
  | { ok: true; abs: string; exists: boolean }
  | { ok: false; rule: 'layout' };

export interface ProjectContextWrites {
  resolveRealRoot(clonePath: string): Promise<string | null>;
  checkDir(realRoot: string, relDir: string, opts: { createDirs: boolean }): Promise<LayoutResult>;
  checkLayout(realRoot: string, relPath: string, opts: { createDirs: boolean }): Promise<LayoutResult>;
  readCurrent(
    abs: string,
  ): Promise<{ bytes: Uint8Array; version: string; size: number; mtime: string } | null>;
  listNames(absDir: string): Promise<string[]>;
  createExclusive(abs: string, bytes: Uint8Array): Promise<void>;
  mkdirExclusive(abs: string): Promise<void>;
  replaceAtomic(abs: string, bytes: Uint8Array): Promise<void>;
  removeAndPrune(realRoot: string, abs: string): Promise<void>;
  versionOf(bytes: Uint8Array): string;
}
