import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { parseImport, toSkillDto, toSkillStatsDto, toSkillVersionDto } from './helpers.js';

/**
 * A1 — skills service. Business logic for the Skills Lab: CRUD, versioning,
 * `.md`/`.zip` import, and the per-skill usage stats. A skill is TEXT ONLY —
 * it never executes; an imported skill is somebody else's instructions
 * landing in an agent's prompt, hence the "arrives disabled" rule below.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** "What changed" — recorded on `skill_versions` only when `body` actually changes. */
  note?: string;
}

export interface SkillUsage {
  agent_id: string;
  agent_name: string;
  order: number;
  enabled: boolean;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /** Delete a skill (and its versions/agent-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      source: 'manual',
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(
      workspaceId,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
      patch.note ?? null,
    );
    return row ? toSkillDto(row) : undefined;
  }

  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(id, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /** Append version max+1 with version `version`'s body — never rewinds history. */
  async restore(
    workspaceId: string,
    id: string,
    version: number,
    note?: string,
  ): Promise<Skill | undefined> {
    const row = await this.repo.restoreVersion(workspaceId, id, version, note ?? `Restored v${version}`);
    return row ? toSkillDto(row) : undefined;
  }

  async agentsUsing(workspaceId: string, id: string): Promise<SkillUsage[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.agentsUsing(id);
    return rows.map((r) => ({
      agent_id: r.agentId,
      agent_name: r.agentName,
      order: r.order,
      enabled: r.enabled,
    }));
  }

  async stats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const agg = await this.repo.statsFor(id);
    return toSkillStatsDto(agg);
  }

  /** Pure preview — parses the same deterministic way `commitImport` will, writes nothing. */
  previewImport(filename: string, bytes: Uint8Array): SkillImportPreview {
    return parseImport(filename, bytes);
  }

  /**
   * Re-runs the SAME parse over the SAME bytes rather than trusting anything
   * the client echoed back from the preview — a caller can't show one thing in
   * the preview and save another. Only name/description/type (the fields the
   * user edits in the preview form) are overridable.
   *
   * Imported skills always arrive `enabled: false` — untrusted content landing
   * in an agent's prompt must be vetted before it can run.
   */
  async commitImport(
    workspaceId: string,
    filename: string,
    bytes: Uint8Array,
    overrides: { name?: string; description?: string; type?: SkillType },
  ): Promise<Skill> {
    const preview = parseImport(filename, bytes);
    const hasCore = preview.entries.some((e) => e.kept);
    if (!hasCore) {
      throw new ValidationError('No markdown core found in the uploaded file', {
        warnings: preview.warnings,
      });
    }
    const row = await this.repo.insert({
      workspaceId,
      name: overrides.name ?? preview.name,
      description: overrides.description ?? preview.description,
      type: overrides.type ?? preview.type,
      source: preview.source,
      body: preview.body,
      enabled: false,
    });
    return toSkillDto(row);
  }
}
