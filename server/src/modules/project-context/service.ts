import { wrapProjectDoc } from '@devdigest/reviewer-core';
import { join } from 'node:path';
import type {
  ContextAttachments,
  ContextFileCreate,
  ContextFileDeleteQuery,
  ContextFileList,
  ContextFileSave,
  ContextFileUpload,
  SpecFile,
} from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  FILE_TEMPLATE,
  FOLDER_SPEC_NAME,
  FOLDER_TEMPLATE,
  MAX_DOC_BYTES,
  SPECS_ROOT,
} from './constants.js';
import {
  contentRule,
  countUsedBy,
  entryNameRule,
  isUnderSpecsRoot,
  kindForPath,
  newPaths,
  nextFreeName,
  orderForInjection,
  readOnlyReason,
  specsPathRule,
  toLf,
  uploadBytesRule,
} from './helpers.js';
import type {
  ProjectContextDeps,
  ProjectContextPort,
  ResolvedProjectContext,
} from './types.js';

const emptyResolved = (): ResolvedProjectContext => ({ docs: [], skipped: [], truncated: [], tokens: 0 });

export class ProjectContextService implements ProjectContextPort {
  /** Per-repo write queue (NFR-4): writes to one clone never interleave in this process. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(private deps: ProjectContextDeps) {}

  private async requireRepo(ws: string, repoId: string) {
    const repo = await this.deps.repo.getRepo(ws, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private async locked<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(repoId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(repoId, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(repoId) === tail) this.locks.delete(repoId);
    }
  }

  /** Lower-cased tracked paths under the authoring root; `null` when git cannot say (fail closed). */
  private async trackedPaths(clonePath: string): Promise<Set<string> | null> {
    try {
      const paths = await this.deps.listTracked(clonePath, SPECS_ROOT);
      return new Set(paths.map((p) => p.toLowerCase()));
    } catch {
      return null;
    }
  }

  /** The one read-only decision, shared by the listing, the single-file read and the writes. */
  private reasonFor(path: string, tracked: Set<string> | null, size: number) {
    const isTracked = isUnderSpecsRoot(path) && (tracked === null || tracked.has(path.toLowerCase()));
    return readOnlyReason({ path, tracked: isTracked, size });
  }

  async list(ws: string, repoId: string): Promise<ContextFileList> {
    const repo = await this.requireRepo(ws, repoId);
    const listing = await this.deps.listMarkdown(repo.clonePath);
    if (!listing.cloned || !repo.clonePath) return { cloned: false, total: 0, files: [] };
    const clonePath = repo.clonePath;
    const usedBy = countUsedBy(await this.deps.repo.usedByPairs(ws, repoId));
    const tracked = await this.trackedPaths(clonePath);
    const files: SpecFile[] = [];
    for (const f of listing.files) {
      const doc = await this.deps.readDoc(clonePath, f.path);
      const reason = this.reasonFor(f.path, tracked, f.size);
      files.push({
        path: f.path,
        size: f.size,
        updated_at: f.mtime,
        kind: kindForPath(f.path),
        tokens: doc ? this.deps.countTokens(wrapProjectDoc(f.path, doc.text)) : null,
        used_by: usedBy.get(f.path) ?? 0,
        version: doc?.version ?? null,
        editable: doc !== null && reason === null,
        read_only_reason: reason,
      });
    }
    return { cloned: true, total: listing.total, files };
  }

  /**
   * EC-11: a path under `.devdigest/specs/` that passes the path rule, the layout walk
   * and exists on disk is reachable whether or not it made the capped listing.
   */
  private async rootFile(clonePath: string | null, path: string): Promise<{ abs: string } | null> {
    if (!clonePath || specsPathRule(path) !== null) return null;
    const realRoot = await this.deps.writes.resolveRealRoot(clonePath);
    if (!realRoot) return null;
    const res = await this.deps.writes.checkLayout(realRoot, path, { createDirs: false });
    return res.ok && res.exists ? { abs: res.abs } : null;
  }

  async file(ws: string, repoId: string, path: string): Promise<SpecFile> {
    const repo = await this.requireRepo(ws, repoId);
    const root = await this.rootFile(repo.clonePath, path);
    let size: number;
    let mtime: string;
    if (root) {
      const cur = await this.deps.writes.readCurrent(root.abs);
      if (!cur) throw new NotFoundError('Document not readable');
      ({ size, mtime } = cur);
    } else {
      const listing = await this.deps.listMarkdown(repo.clonePath);
      const entry = listing.files.find((f) => f.path === path);
      if (!entry || !repo.clonePath) {
        throw new ValidationError('Path is not in the repo listing', { field: 'path' });
      }
      ({ size, mtime } = entry);
    }
    if (!repo.clonePath) throw new NotFoundError('Document not readable');
    const doc = await this.deps.readDoc(repo.clonePath, path);
    if (!doc) throw new NotFoundError('Document not readable');
    const tracked = isUnderSpecsRoot(path) ? await this.trackedPaths(repo.clonePath) : new Set<string>();
    const reason = this.reasonFor(path, tracked, size);
    return {
      path,
      content: doc.text,
      size,
      updated_at: mtime,
      kind: kindForPath(path),
      version: doc.version,
      editable: reason === null,
      read_only_reason: reason,
    };
  }

  // ---- Authoring: every write is serialised per repo and fails closed ----

  private notCloned() {
    return new AppError('repo_not_cloned', 'This repository has no local clone', 409);
  }

  /** Error order 1-2: unknown repo -> 404, no usable clone -> 409. Touches nothing. */
  private async writeCtx(ws: string, repoId: string) {
    const repo = await this.requireRepo(ws, repoId);
    if (!repo.clonePath) throw this.notCloned();
    const realRoot = await this.deps.writes.resolveRealRoot(repo.clonePath);
    if (!realRoot) throw this.notCloned();
    return { clonePath: repo.clonePath, realRoot };
  }

  private invalid(field: string, rule: string, message: string): never {
    throw new ValidationError(message, { field, rule });
  }

  /** The path rule plus the name rule on every segment below the root (EC-3). */
  private assertPath(path: string): void {
    const rule = specsPathRule(path);
    if (rule) this.invalid('path', rule, 'Path is not a valid file under .devdigest/specs/');
    const segments = path.slice(SPECS_ROOT.length + 1).split('/');
    segments.forEach((seg, i) => {
      const r = entryNameRule(seg, i === segments.length - 1 ? 'file' : 'folder');
      if (r) this.invalid('path', r, 'Path contains a name that cannot be used');
    });
  }

  private async trackedOrFail(clonePath: string): Promise<Set<string>> {
    const tracked = await this.trackedPaths(clonePath);
    if (!tracked) this.invalid('path', 'tracked', 'Could not tell whether this file is tracked by git');
    return tracked;
  }

  private conflict(reason: 'changed' | 'deleted', currentVersion: string | null): never {
    throw new AppError('version_conflict', `File ${reason} on disk`, 409, {
      reason,
      current_version: currentVersion,
    });
  }

  private async specFromDisk(path: string, abs: string): Promise<SpecFile> {
    const cur = await this.deps.writes.readCurrent(abs);
    if (!cur) throw new NotFoundError('Document not readable');
    const text = Buffer.from(cur.bytes).toString('utf8');
    return {
      path,
      content: text,
      size: cur.size,
      updated_at: cur.mtime,
      kind: kindForPath(path),
      tokens: this.deps.countTokens(wrapProjectDoc(path, text)),
      used_by: 0,
      version: cur.version,
      editable: true,
      read_only_reason: null,
    };
  }

  /** Create a uniquely named file (or folder + spec.md) in the root; never overwrites (EC-2). */
  private async createUnique(
    ctx: { clonePath: string; realRoot: string },
    name: string,
    kind: 'file' | 'folder',
    bytes: Uint8Array,
  ): Promise<SpecFile> {
    const { writes } = this.deps;
    const peek = await writes.checkDir(ctx.realRoot, SPECS_ROOT, { createDirs: false });
    if (!peek.ok) this.invalid('path', peek.rule, 'The .devdigest/specs folder is not a plain directory');
    const tracked = await this.trackedOrFail(ctx.clonePath);
    const root = await writes.checkDir(ctx.realRoot, SPECS_ROOT, { createDirs: true });
    if (!root.ok) this.invalid('path', root.rule, 'The .devdigest/specs folder is not a plain directory');

    // A tracked path is "taken" even when the working tree no longer has it.
    const trackedTop = new Set<string>();
    for (const p of tracked) trackedTop.add(p.slice(SPECS_ROOT.length + 1).split('/')[0] ?? '');

    for (let attempt = 0; attempt < 50; attempt++) {
      const taken = new Set((await writes.listNames(root.abs)).map((n) => n.toLowerCase()));
      for (const n of trackedTop) taken.add(n);
      const chosen = nextFreeName(name, kind, taken);
      const abs = join(root.abs, chosen);
      const path = `${SPECS_ROOT}/${chosen}`;
      try {
        if (kind === 'file') {
          await writes.createExclusive(abs, bytes);
          return await this.specFromDisk(path, abs);
        }
        await writes.mkdirExclusive(abs);
        const specAbs = join(abs, FOLDER_SPEC_NAME);
        await writes.createExclusive(specAbs, bytes);
        return await this.specFromDisk(`${path}/${FOLDER_SPEC_NAME}`, specAbs);
      } catch (e) {
        if ((e as { code?: string }).code === 'EEXIST') continue; // lost a race; take the next free name
        throw e;
      }
    }
    throw new AppError('name_unavailable', 'Could not find a free name', 409);
  }

  create(ws: string, repoId: string, input: ContextFileCreate): Promise<SpecFile> {
    return this.locked(repoId, async () => {
      const ctx = await this.writeCtx(ws, repoId);
      const rule = entryNameRule(input.name, input.kind);
      if (rule) this.invalid('name', rule, 'That name cannot be used');
      const bytes = Buffer.from(input.kind === 'file' ? FILE_TEMPLATE : FOLDER_TEMPLATE, 'utf8');
      return this.createUnique(ctx, input.name, input.kind, bytes);
    });
  }

  upload(ws: string, repoId: string, input: ContextFileUpload): Promise<SpecFile> {
    return this.locked(repoId, async () => {
      const ctx = await this.writeCtx(ws, repoId);
      const nameRule = entryNameRule(input.name, 'file');
      if (nameRule) this.invalid('name', nameRule, 'That name cannot be used');
      const bytes = Buffer.from(input.content_base64, 'base64');
      const contentProblem = uploadBytesRule(bytes);
      if (contentProblem) this.invalid('content', contentProblem, 'That file cannot be uploaded');
      return this.createUnique(ctx, input.name, 'file', bytes); // bytes unchanged (AC-3)
    });
  }

  save(ws: string, repoId: string, input: ContextFileSave): Promise<SpecFile> {
    return this.locked(repoId, async () => {
      const ctx = await this.writeCtx(ws, repoId);
      const { writes } = this.deps;
      this.assertPath(input.path);
      const text = toLf(input.content);
      const contentProblem = contentRule(text);
      if (contentProblem) this.invalid('content', contentProblem, 'That text cannot be saved');
      const bytes = Buffer.from(text, 'utf8');

      const peek = await writes.checkLayout(ctx.realRoot, input.path, { createDirs: false });
      if (!peek.ok) this.invalid('path', peek.rule, 'The path crosses a link or a non-directory');
      const tracked = await this.trackedOrFail(ctx.clonePath);
      if (tracked.has(input.path.toLowerCase())) this.invalid('path', 'tracked', 'File is tracked by git');

      const cur = peek.exists ? await writes.readCurrent(peek.abs) : null;
      if (cur && cur.size > MAX_DOC_BYTES) this.invalid('path', 'too_large', 'File is over 64 KB');

      if (input.version === null) {
        if (cur) this.conflict('changed', cur.version);
        const made = await writes.checkLayout(ctx.realRoot, input.path, { createDirs: true });
        if (!made.ok) this.invalid('path', made.rule, 'The path crosses a link or a non-directory');
        try {
          await writes.createExclusive(made.abs, bytes);
        } catch (e) {
          if ((e as { code?: string }).code !== 'EEXIST') throw e;
          this.conflict('changed', (await writes.readCurrent(made.abs))?.version ?? null);
        }
        return this.specFromDisk(input.path, made.abs);
      }

      if (!cur) this.conflict('deleted', null);
      if (cur.version !== input.version) this.conflict('changed', cur.version);
      await writes.replaceAtomic(peek.abs, bytes);
      return this.specFromDisk(input.path, peek.abs);
    });
  }

  remove(
    ws: string,
    repoId: string,
    input: ContextFileDeleteQuery,
  ): Promise<{ path: string; bytes: number }> {
    return this.locked(repoId, async () => {
      const ctx = await this.writeCtx(ws, repoId);
      const { writes } = this.deps;
      this.assertPath(input.path);
      const layout = await writes.checkLayout(ctx.realRoot, input.path, { createDirs: false });
      if (!layout.ok) this.invalid('path', layout.rule, 'The path crosses a link or a non-directory');
      const tracked = await this.trackedOrFail(ctx.clonePath);
      if (tracked.has(input.path.toLowerCase())) this.invalid('path', 'tracked', 'File is tracked by git');

      const cur = layout.exists ? await writes.readCurrent(layout.abs) : null;
      if (!cur) this.conflict('deleted', null);
      if (cur.size > MAX_DOC_BYTES) this.invalid('path', 'too_large', 'File is over 64 KB');
      if (cur.version !== input.version) this.conflict('changed', cur.version);
      await writes.removeAndPrune(ctx.realRoot, layout.abs);
      return { path: input.path, bytes: cur.size };
    });
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
    const bad: string[] = [];
    for (const p of fresh) {
      if (listed.has(p)) continue;
      // EC-11: an existing file under .devdigest/specs/ is attachable even past the 500 cap.
      if (await this.rootFile(repo.clonePath, p)) continue;
      bad.push(p);
    }
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
    if (!input.clonePath) return emptyResolved();
    return this.readAll(input.clonePath, await this.orderedPathsFor(input.agentId, input.repoId));
  }

  async resolveForRepo(input: {
    workspaceId: string;
    repoId: string;
    clonePath: string | null;
  }): Promise<ResolvedProjectContext> {
    if (!input.clonePath) return emptyResolved();
    const seen = new Set<string>();
    const union: string[] = [];
    for (const agentId of await this.deps.repo.enabledAgentIds(input.workspaceId)) {
      for (const path of await this.orderedPathsFor(agentId, input.repoId)) {
        if (seen.has(path)) continue;
        seen.add(path);
        union.push(path);
      }
    }
    return this.readAll(input.clonePath, union);
  }

  /** One agent's injection order: its own documents, then its enabled skills'. */
  private async orderedPathsFor(agentId: string, repoId: string): Promise<string[]> {
    const { agentPaths, skills } = await this.deps.repo.pathsForRun(agentId, repoId);
    return orderForInjection(
      agentPaths,
      skills.map((s) => s.paths),
    );
  }

  /** Reads each path once, in order; a missing/unreadable one lands in `skipped`. */
  private async readAll(clonePath: string, paths: string[]): Promise<ResolvedProjectContext> {
    const out = emptyResolved();
    for (const path of paths) {
      const doc = await this.deps.readDoc(clonePath, path);
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
