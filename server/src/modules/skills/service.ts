import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import type { SkillsRepository, SkillRow } from './repository.js';
import {
  deriveImportFilename,
  isAcceptedContentType,
  parseImport,
  toSkillDto,
  toSkillStatsDto,
  toSkillVersionDto,
} from './helpers.js';
import { INJECTION_BLOCK_MESSAGE, MAX_UPLOAD_BYTES, SCANNED_SOURCES } from './constants.js';
import { scanSkillBody } from './injection-scan.js';

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
    // The composition root owns the repository; taking it from there (not
    // `new`-ing it over `container.db`) is what lets a unit test hand in a fake.
    this.repo = container.skillsRepo;
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const counts = await this.repo.agentCounts(rows.map((r) => r.id));
    return rows.map((r) => toSkillDto(r, counts.get(r.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? this.withAgentCount(row) : undefined;
  }

  /** One skill DTO with its live `agent_count`. */
  private async withAgentCount(row: SkillRow): Promise<Skill> {
    const counts = await this.repo.agentCounts([row.id]);
    return toSkillDto(row, counts.get(row.id) ?? 0);
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

  /**
   * The enable gate. An `imported_*` body that trips the injection scan may
   * be stored, viewed and edited, but never run: enabling it (or keeping it
   * enabled while saving a still-flagged body) is a 422 carrying the findings.
   * Manual and extracted bodies are not scanned — see `SCANNED_SOURCES`.
   */
  private assertEnableAllowed(existing: SkillRow, nextEnabled: boolean, nextBody: string): void {
    if (!nextEnabled || !SCANNED_SOURCES.has(existing.source)) return;
    const findings = scanSkillBody(nextBody);
    if (findings.length > 0) throw new ValidationError(INJECTION_BLOCK_MESSAGE, { findings });
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;
    this.assertEnableAllowed(existing, patch.enabled ?? existing.enabled, patch.body ?? existing.body);
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
    return row ? this.withAgentCount(row) : undefined;
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
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;
    const snapshot = await this.repo.getVersion(id, version);
    if (!snapshot) return undefined;
    // An enabled imported skill must not be rewound onto a flagged body.
    this.assertEnableAllowed(existing, existing.enabled, snapshot.body);
    const row = await this.repo.restoreVersion(workspaceId, id, version, note ?? `Restored v${version}`);
    return row ? this.withAgentCount(row) : undefined;
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

  // ---------------------------------------------------------------- URL import

  /**
   * Fetch through the container's guarded `UrlFetcher` (never a bare `fetch`
   * here — the adapter owns the SSRF and size rules) and hand the bytes to the
   * same parser the file path uses. The filename is derived from the final
   * URL so `.zip` links dispatch to the archive branch.
   */
  private async fetchForImport(url: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const res = await this.container.urlFetcher.fetch(url, { maxBytes: MAX_UPLOAD_BYTES });
    if (!isAcceptedContentType(res.contentType)) {
      throw new ValidationError(
        `Unsupported content type ${res.contentType} — link the raw markdown or a .zip, not an HTML page`,
      );
    }
    return { filename: deriveImportFilename(res.url, res.contentType), bytes: res.bytes };
  }

  /** Preview a URL import — fetches and parses, writes nothing. */
  async previewUrlImport(url: string): Promise<SkillImportPreview> {
    const { filename, bytes } = await this.fetchForImport(url);
    return parseImport(filename, bytes, 'imported_url');
  }

  /**
   * Same two-step contract as `commitImport`: the URL is fetched and parsed
   * AGAIN on commit rather than trusting a body echoed back from the preview.
   * Lands `enabled: false` like every imported skill; the injection scan is
   * computed on read and gates the later enable.
   */
  async commitUrlImport(
    workspaceId: string,
    url: string,
    overrides: { name?: string; description?: string; type?: SkillType },
  ): Promise<Skill> {
    const { filename, bytes } = await this.fetchForImport(url);
    const preview = parseImport(filename, bytes, 'imported_url');
    const hasCore = preview.entries.some((e) => e.kept);
    if (!hasCore) {
      throw new ValidationError('No markdown core found at the URL', { warnings: preview.warnings });
    }
    const row = await this.repo.insert({
      workspaceId,
      name: overrides.name ?? preview.name,
      description: overrides.description ?? preview.description,
      type: overrides.type ?? preview.type,
      source: 'imported_url',
      body: preview.body,
      enabled: false,
    });
    return toSkillDto(row);
  }
}
