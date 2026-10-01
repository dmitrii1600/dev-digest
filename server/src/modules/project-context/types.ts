import type { ContextAttachments, ContextFileList, SpecFile } from '@devdigest/shared';

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
}

export interface ProjectContextDeps {
  repo: ProjectContextStore;
  listMarkdown: (clonePath: string | null) => Promise<{
    cloned: boolean;
    total: number;
    files: { path: string; size: number; mtime: string }[];
  }>;
  readDoc: (clonePath: string, relPath: string) => Promise<{ text: string; truncated: boolean } | null>;
  countTokens: (text: string) => number;
}
