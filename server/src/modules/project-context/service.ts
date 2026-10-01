import { wrapProjectDoc } from '@devdigest/reviewer-core';
import type { ContextAttachments, ContextFileList, SpecFile } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { countUsedBy, kindForPath, newPaths, orderForInjection } from './helpers.js';
import type {
  ProjectContextDeps,
  ProjectContextPort,
  ResolvedProjectContext,
} from './types.js';

export class ProjectContextService implements ProjectContextPort {
  constructor(private deps: ProjectContextDeps) {}

  private async requireRepo(ws: string, repoId: string) {
    const repo = await this.deps.repo.getRepo(ws, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  async list(ws: string, repoId: string): Promise<ContextFileList> {
    const repo = await this.requireRepo(ws, repoId);
    const listing = await this.deps.listMarkdown(repo.clonePath);
    if (!listing.cloned || !repo.clonePath) return { cloned: false, total: 0, files: [] };
    const clonePath = repo.clonePath;
    const usedBy = countUsedBy(await this.deps.repo.usedByPairs(ws, repoId));
    const files: SpecFile[] = [];
    for (const f of listing.files) {
      const doc = await this.deps.readDoc(clonePath, f.path);
      files.push({
        path: f.path,
        size: f.size,
        updated_at: f.mtime,
        kind: kindForPath(f.path),
        tokens: doc ? this.deps.countTokens(wrapProjectDoc(f.path, doc.text)) : null,
        used_by: usedBy.get(f.path) ?? 0,
      });
    }
    return { cloned: true, total: listing.total, files };
  }

  async file(ws: string, repoId: string, path: string): Promise<SpecFile> {
    const repo = await this.requireRepo(ws, repoId);
    const listing = await this.deps.listMarkdown(repo.clonePath);
    const entry = listing.files.find((f) => f.path === path);
    if (!entry || !repo.clonePath) {
      throw new ValidationError('Path is not in the repo listing', { field: 'path' });
    }
    const doc = await this.deps.readDoc(repo.clonePath, path);
    if (!doc) throw new NotFoundError('Document not readable');
    return {
      path,
      content: doc.text,
      size: entry.size,
      updated_at: entry.mtime,
      kind: kindForPath(path),
    };
  }

  async getAgent(ws: string, agentId: string, repoId: string): Promise<ContextAttachments> {
    await this.requireRepo(ws, repoId);
    if (!(await this.deps.repo.agentExists(ws, agentId))) throw new NotFoundError('Agent not found');
    return { repo_id: repoId, paths: await this.deps.repo.agentPaths(agentId, repoId) };
  }

  async getSkill(ws: string, skillId: string, repoId: string): Promise<ContextAttachments> {
    await this.requireRepo(ws, repoId);
    if (!(await this.deps.repo.skillExists(ws, skillId))) throw new NotFoundError('Skill not found');
    return { repo_id: repoId, paths: await this.deps.repo.skillPaths(skillId, repoId) };
  }

  /** Only paths not already persisted are checked against the listing (a kept "missing" row stays). */
  private async assertListed(ws: string, repoId: string, requested: string[], persisted: string[]) {
    const repo = await this.requireRepo(ws, repoId);
    const fresh = newPaths(requested, persisted);
    if (fresh.length === 0) return;
    const listed = new Set((await this.deps.listMarkdown(repo.clonePath)).files.map((f) => f.path));
    const bad = fresh.filter((p) => !listed.has(p));
    if (bad.length > 0) {
      throw new ValidationError('Paths are not in the repo listing', { field: 'paths', paths: bad });
    }
  }

  async putAgent(
    ws: string,
    agentId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachments> {
    await this.requireRepo(ws, repoId);
    if (!(await this.deps.repo.agentExists(ws, agentId))) throw new NotFoundError('Agent not found');
    await this.assertListed(ws, repoId, paths, await this.deps.repo.agentPaths(agentId, repoId));
    await this.deps.repo.replaceAgentPaths(agentId, repoId, paths);
    return { repo_id: repoId, paths: await this.deps.repo.agentPaths(agentId, repoId) };
  }

  async putSkill(
    ws: string,
    skillId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachments> {
    await this.requireRepo(ws, repoId);
    if (!(await this.deps.repo.skillExists(ws, skillId))) throw new NotFoundError('Skill not found');
    await this.assertListed(ws, repoId, paths, await this.deps.repo.skillPaths(skillId, repoId));
    await this.deps.repo.replaceSkillPaths(skillId, repoId, paths);
    return { repo_id: repoId, paths: await this.deps.repo.skillPaths(skillId, repoId) };
  }

  async resolveForRun(input: {
    repoId: string;
    clonePath: string | null;
    agentId: string;
  }): Promise<ResolvedProjectContext> {
    const out: ResolvedProjectContext = { docs: [], skipped: [], truncated: [], tokens: 0 };
    if (!input.clonePath) return out;
    const { agentPaths, skills } = await this.deps.repo.pathsForRun(input.agentId, input.repoId);
    const ordered = orderForInjection(
      agentPaths,
      skills.map((s) => s.paths),
    );
    for (const path of ordered) {
      const doc = await this.deps.readDoc(input.clonePath, path);
      if (!doc) {
        out.skipped.push(path);
        continue;
      }
      if (doc.truncated) out.truncated.push(path);
      out.docs.push({ path, content: doc.text });
      out.tokens += this.deps.countTokens(wrapProjectDoc(path, doc.text));
    }
    return out;
  }
}
