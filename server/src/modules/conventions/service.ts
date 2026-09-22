import {
  ConventionExtraction,
  type ConventionCandidate,
  type ConventionSkillDraft,
  type ConventionsPage,
  type SkillType,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { DEFAULT_SKILL_NAME, MAX_SAMPLE_FILES, SCAN_STALE_MS } from './constants.js';
import {
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  buildConventionSkillBody,
  buildExtractionMessages,
  evidenceFilesOf,
  groundCandidates,
  normaliseRule,
  toCandidateDto,
  toScanDto,
  type SkillBodyCandidate,
} from './helpers.js';
import { ConventionsRepository, type ConventionRow, type UpdateCandidate } from './repository.js';
import { collectSamples } from './repository-samples.js';

/**
 * Conventions extractor (L02 second half). Sample selection is code, the model
 * proposes, code verifies every citation, a human decides, and the accepted
 * survivors become one `repo-conventions` skill bound to the chosen agents.
 * See `specs/03-conventions-module.md`.
 */

export interface CreateConventionSkillInput {
  candidate_ids?: string[];
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  agent_ids: string[];
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  /** The newest scan (any status) + every non-rejected candidate + how many are hidden. */
  async page(workspaceId: string, repoId: string): Promise<ConventionsPage | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const [scan, rows, rejected] = await Promise.all([
      this.repo.latestScan(repoId),
      this.repo.listVisible(repoId),
      this.repo.countByStatus(repoId, 'rejected'),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: rows.map(toCandidateDto),
      rejected_count: rejected,
    };
  }

  /**
   * One synchronous extraction: samples (code) → model → grounding (code) →
   * replace the pending set. Decisions from earlier scans survive.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionsPage | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    await this.repo.sweepStaleRunning(repoId, new Date(Date.now() - SCAN_STALE_MS));
    if (await this.repo.runningScan(repoId)) {
      throw new AppError('scan_running', 'A conventions scan is already running for this repo', 409);
    }
    if (!repo.clonePath) {
      throw new AppError('repo_not_cloned', 'The repo has no local clone yet', 422);
    }
    const codePaths = await this.container.repoIntel.getConventionSamples(repoId, MAX_SAMPLE_FILES);
    if (codePaths.length === 0) {
      throw new AppError(
        'repo_not_indexed',
        'The repo is not indexed yet — conventions are sampled from the ranked index',
        422,
      );
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const scan = await this.repo.insertScan({ workspaceId, repoId, provider, model });

    try {
      const tokenizer = this.container.tokenizer;
      const set = await collectSamples(repo.clonePath, codePaths, (s) => tokenizer.count(s));
      if (set.samples.length === 0) {
        throw new AppError('repo_not_cloned', 'None of the sampled files could be read from the clone', 422);
      }
      const llm = await this.container.llm(provider);
      const result = await llm.completeStructured({
        model,
        schema: ConventionExtraction,
        schemaName: CONVENTION_EXTRACTION_SCHEMA_NAME,
        messages: buildExtractionMessages(repo.fullName, set),
        temperature: 0,
        maxRetries: 2,
      });

      const decided = new Set((await this.repo.decidedRules(repoId)).map(normaliseRule));
      const grounded = groundCandidates(result.data.candidates, set, decided);
      await this.repo.replacePending(workspaceId, repoId, scan.id, grounded.kept);
      await this.repo.finishScan(scan.id, {
        status: 'done',
        sampledFiles: set.sampledFiles,
        candidatesTotal: result.data.candidates.length,
        candidatesGrounded: grounded.kept.length,
        droppedUngrounded: grounded.droppedUngrounded,
        droppedDuplicate: grounded.droppedDuplicate,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      });
    } catch (err) {
      await this.repo.finishScan(scan.id, {
        status: 'failed',
        error: (err as Error).message ?? String(err),
      });
      throw err;
    }

    return this.page(workspaceId, repoId);
  }

  /** Accept / reject / edit. A rule or category change marks the row `edited`. */
  async updateCandidate(
    workspaceId: string,
    repoId: string,
    id: string,
    patch: UpdateCandidate,
  ): Promise<ConventionCandidate | undefined> {
    const existing = await this.repo.getCandidate(workspaceId, repoId, id);
    if (!existing) return undefined;
    const row = await this.repo.updateCandidate(id, patch);
    return row ? toCandidateDto(row) : undefined;
  }

  /** The editable draft — accepted, unabsorbed candidates rendered as a skill body. Writes nothing. */
  async skillDraft(
    workspaceId: string,
    repoId: string,
    candidateIds?: string[],
  ): Promise<ConventionSkillDraft | undefined> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const rows = await this.resolveCandidates(repoId, candidateIds);
    const bodyCandidates = rows.map(toBodyCandidate);
    return {
      name: DEFAULT_SKILL_NAME,
      description: `${rows.length} house convention${rows.length === 1 ? '' : 's'} extracted from ${repo.fullName}`,
      type: 'convention',
      body: buildConventionSkillBody(repo.fullName, bodyCandidates),
      evidence_files: evidenceFilesOf(bodyCandidates),
      candidate_ids: rows.map((r) => r.id),
    };
  }

  /**
   * Create the skill from the (possibly edited) draft, bind it to each chosen
   * agent at the next free order, stamp the candidates. The body may come from
   * the client here — every line in it passed a human Accept and the whole
   * draft was shown editable; it is the same trust level as `POST /skills`.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    input: CreateConventionSkillInput,
  ): Promise<{ skill_id: string } | undefined> {
    const draft = await this.skillDraft(workspaceId, repoId, input.candidate_ids);
    if (!draft) return undefined;
    if (draft.candidate_ids.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill');
    }
    for (const agentId of input.agent_ids) {
      const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError(`Agent ${agentId} not found`);
    }

    const skill = await this.container.skillsRepo.insert({
      workspaceId,
      name: input.name?.trim() || draft.name,
      description: input.description ?? draft.description,
      type: input.type ?? draft.type,
      source: 'extracted',
      body: input.body ?? draft.body,
      enabled: input.enabled ?? true,
      evidenceFiles: draft.evidence_files,
    });

    for (const agentId of input.agent_ids) {
      const existing = await this.container.agentsRepo.linkedSkills(agentId);
      await this.container.agentsRepo.linkSkill(agentId, skill.id, existing.length, true);
    }
    await this.repo.markAbsorbed(draft.candidate_ids, skill.id);
    return { skill_id: skill.id };
  }

  /** Accepted + unabsorbed, optionally narrowed to `ids` — every id given must qualify. */
  private async resolveCandidates(repoId: string, ids?: string[]): Promise<ConventionRow[]> {
    const rows = await this.repo.acceptedUnabsorbed(repoId, ids);
    if (ids) {
      const found = new Set(rows.map((r) => r.id));
      const bad = ids.filter((id) => !found.has(id));
      if (bad.length > 0) {
        throw new ValidationError('Some candidates are not accepted, already in a skill, or unknown', {
          candidate_ids: bad,
        });
      }
    }
    return rows;
  }
}

function toBodyCandidate(row: ConventionRow): SkillBodyCandidate {
  return {
    category: row.category,
    rule: row.rule,
    confidence: row.confidence ?? null,
    evidencePath: row.evidencePath ?? null,
    evidenceLine: row.evidenceLine ?? null,
    evidenceSnippet: row.evidenceSnippet ?? null,
  };
}
