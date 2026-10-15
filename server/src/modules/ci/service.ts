import {
  CI_MAX_BYTES,
  type AgentCi,
  type CiExport,
  type CiExportInput,
  type CiFile,
  type CiPostAs,
  type CiPreview,
  type CiRefreshResult,
  type CiRun,
  type CiTrigger,
  type CiUpdateResult,
  type GitHubClient,
  type RepoRef,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { SCANNED_SOURCES, securityReport } from '../_shared/injection-scan.js';
import {
  ARTIFACT_NAME,
  CI_BRANCH,
  GITATTRIBUTES_PATH,
  MANIFEST_DIR,
  PR_BODY,
  PR_TITLE,
  PR_TITLE_MAX,
  REFRESH_RUNS_PER_REPO,
  RESULT_FILE,
  WORKFLOW_FILE,
} from './constants.js';
import {
  assembleFiles,
  buildCiTrace,
  buildManifestYaml,
  buildMemoryJsonl,
  buildWorkflowYaml,
  buildZipBase64,
  countBlockers,
  runStatus,
  slugify,
  uniqueSlugs,
  validateWorkflowYaml,
  verifyRun,
} from './helpers.js';
import type {
  CiAgentRow,
  CiExportMeta,
  CiRepoRow,
  CiStore,
  RunnerBundle,
  RunnerBundleSource,
  StoredInstallation,
} from './types.js';

export interface CiServiceDeps {
  store: CiStore;
  bundle: RunnerBundleSource;
  /** Resolved lazily so the preview and a zip install work without a token. */
  github: () => Promise<GitHubClient>;
}

interface Generated {
  files: CiFile[];
  skipped: string[];
  skillSlugs: string[];
  manifestPath: string;
  bundle: RunnerBundle | null;
}

interface GenerateOpts {
  triggers: CiTrigger[];
  postAs: CiPostAs;
  workflowYaml?: string;
}

function repoRef(fullName: string): RepoRef {
  const [owner = '', name = ''] = fullName.split('/');
  return { owner, name };
}

function bundleMissing(): AppError {
  return new AppError(
    'ci_bundle_missing',
    'Runner bundle not built — run pnpm build in agent-runner',
    422,
  );
}

function githubFailed(err: unknown): AppError {
  return new AppError('ci_github_failed', err instanceof Error ? err.message : String(err), 502);
}

export class CiService {
  constructor(private readonly deps: CiServiceDeps) {}

  /** The file set an export would write; nothing is written. */
  async preview(
    workspaceId: string,
    agentId: string,
    input: { repo: string; triggers: CiTrigger[]; postAs: CiPostAs },
  ): Promise<CiPreview> {
    const { agent, repo } = await this.load(workspaceId, agentId, input.repo);
    const manifestPath = await this.manifestPathFor(workspaceId, agent, repo);
    const gen = await this.generate(workspaceId, agent, repo, manifestPath, input);
    return { files: gen.files, skipped_skills: gen.skipped, bundle_missing: gen.bundle === null };
  }

  async export(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const { agent, repo } = await this.load(workspaceId, agentId, input.repo);
    const taken = await this.deps.store.installationForRepo(workspaceId, repo.fullName);
    if (taken && taken.installation.agent_id !== agent.id) {
      throw new AppError(
        'ci_repo_taken',
        `${taken.agentName} is already installed in ${repo.fullName}`,
        409,
        { agent_name: taken.agentName },
      );
    }
    const manifestPath = await this.manifestPathFor(workspaceId, agent, repo);
    const gen = await this.generate(workspaceId, agent, repo, manifestPath, {
      triggers: input.triggers,
      postAs: input.post_as,
      workflowYaml: input.workflow_yaml,
    });
    if (!gen.bundle) throw bundleMissing();
    const meta = this.metaFor(agent, gen, input.triggers, input.post_as, gen.bundle);

    let prUrl: string | null = null;
    let githubRepoId: number | undefined;
    if (input.action === 'open_pr') {
      try {
        prUrl = await this.commitAndOpenPr(repo, gen.files);
        githubRepoId = await (await this.deps.github()).getRepoId(repoRef(repo.fullName));
      } catch (err) {
        throw githubFailed(err);
      }
    }
    const stored = await this.deps.store.upsertInstallation({
      agentId: agent.id,
      repo: repo.fullName,
      agentVersion: agent.version,
      exportMeta: meta,
      githubRepoId,
    });
    return {
      installation: stored.installation,
      files: gen.files,
      pr_url: prUrl,
      zip_base64: input.action === 'files' ? buildZipBase64(gen.files) : null,
    };
  }

  /** Regenerate and recommit every installation of the agent from its stored settings. */
  async updateAll(workspaceId: string, agentId: string): Promise<CiUpdateResult> {
    const agent = await this.deps.store.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const installs = await this.deps.store.listInstallations(workspaceId, agentId);
    if (installs.length > 0 && !(await this.deps.bundle.read())) throw bundleMissing();
    const results: CiUpdateResult['results'] = [];
    for (const inst of installs) {
      const repo = await this.deps.store.findRepo(workspaceId, inst.installation.repo);
      if (!repo) {
        results.push({ repo: inst.installation.repo, pr_url: null, error: 'Repository is no longer imported' });
        continue;
      }
      const triggers = inst.meta?.triggers ?? ['opened', 'synchronize'];
      const postAs = inst.meta?.post_as ?? 'github_review';
      try {
        const manifestPath = await this.manifestPathFor(workspaceId, agent, repo);
        const gen = await this.generate(workspaceId, agent, repo, manifestPath, { triggers, postAs });
        if (!gen.bundle) throw bundleMissing();
        const prUrl = await this.commitAndOpenPr(repo, gen.files);
        await this.deps.store.upsertInstallation({
          agentId: agent.id,
          repo: repo.fullName,
          agentVersion: agent.version,
          exportMeta: this.metaFor(agent, gen, triggers, postAs, gen.bundle),
        });
        results.push({ repo: repo.fullName, pr_url: prUrl, error: null });
      } catch (err) {
        results.push({
          repo: inst.installation.repo,
          pr_url: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  }

  async agentCi(workspaceId: string, agentId: string): Promise<AgentCi> {
    const agent = await this.deps.store.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const [installs, runs] = await Promise.all([
      this.deps.store.listInstallations(workspaceId, agentId),
      this.deps.store.listRuns(workspaceId, { agentId }),
    ]);
    return { installations: installs.map((i) => i.installation), runs };
  }

  async listRuns(
    workspaceId: string,
    filters: { agentId?: string; repoId?: string },
  ): Promise<CiRun[]> {
    let repo: string | undefined;
    if (filters.repoId) {
      const row = await this.deps.store.getRepoById(workspaceId, filters.repoId);
      if (!row) throw new NotFoundError('Repository not found');
      repo = row.fullName;
    }
    return this.deps.store.listRuns(workspaceId, { agentId: filters.agentId, repo });
  }

  /**
   * Pull completed workflow runs back with the studio's own token, verify each
   * against its installation and store it once. No LLM call.
   */
  async refresh(workspaceId: string, opts: { agentId?: string }): Promise<CiRefreshResult> {
    const installs = await this.deps.store.listInstallations(workspaceId, opts.agentId);
    let ingested = 0;
    const agents = new Map<string, CiAgentRow | null>();
    for (const inst of installs) {
      try {
        ingested += await this.refreshInstallation(workspaceId, inst, agents);
      } catch (err) {
        throw githubFailed(err);
      }
    }
    return { ingested };
  }

  // ---- internals -----------------------------------------------------------

  private async refreshInstallation(
    workspaceId: string,
    inst: StoredInstallation,
    agents: Map<string, CiAgentRow | null>,
  ): Promise<number> {
    const gh = await this.deps.github();
    const ref = repoRef(inst.installation.repo);
    let githubRepoId = inst.githubRepoId;
    if (githubRepoId == null) {
      githubRepoId = await gh.getRepoId(ref);
      await this.deps.store.setGithubRepoId(inst.installation.id, githubRepoId);
    }
    const agentId = inst.installation.agent_id;
    if (!agents.has(agentId)) agents.set(agentId, await this.deps.store.getAgent(workspaceId, agentId));
    const agent = agents.get(agentId);
    if (!agent) return 0;
    const meta = inst.meta;
    const model = meta?.model ?? agent.model;
    const provider = meta?.provider ?? agent.provider;

    const known = await this.deps.store.knownRunIds(inst.installation.id);
    const runs = await gh.listWorkflowRuns(ref, WORKFLOW_FILE, REFRESH_RUNS_PER_REPO);
    let count = 0;
    for (const run of runs) {
      if (run.conclusion === 'skipped' || known.has(run.id)) continue;
      const dl = await gh.downloadRunArtifact(ref, run.id, {
        name: ARTIFACT_NAME,
        fileName: RESULT_FILE,
        maxBytes: CI_MAX_BYTES,
      });
      const verdict = verifyRun({ githubRepoId }, run, dl);
      const artifact = verdict.kind === 'accepted' ? verdict.artifact : null;
      const prNumber = artifact?.pr_number ?? run.pull_requests[0] ?? null;
      const stored = await this.deps.store.recordRun({
        workspaceId,
        installationId: inst.installation.id,
        agentId,
        githubRunId: run.id,
        prNumber,
        prTitle: run.display_title.slice(0, PR_TITLE_MAX),
        headSha: run.head_sha,
        ranAt: new Date(run.updated_at),
        githubUrl: run.html_url,
        status: artifact ? runStatus(artifact) : 'failed',
        findingsCount: artifact?.findings_count ?? null,
        critical: artifact ? (artifact.critical ?? 0) : null,
        warning: artifact ? (artifact.warning ?? 0) : null,
        suggestion: artifact ? (artifact.suggestion ?? 0) : null,
        costUsd: artifact?.cost_usd ?? null,
        durationMs: artifact?.duration_ms ?? null,
        provider,
        model,
        blockers: artifact ? countBlockers(artifact, meta?.ci_fail_on ?? agent.ciFailOn) : null,
        error: verdict.kind === 'rejected' ? 'result_rejected' : verdict.kind === 'no_result' ? 'no_result' : null,
        trace: buildCiTrace({
          agentName: agent.name,
          agentVersion: inst.installation.agent_version,
          model,
          provider,
          prNumber,
          artifact,
          headSha: run.head_sha ?? '',
          skills: meta?.skills ?? [],
          runnerSha256: meta?.runner_sha256 ?? '',
          jobUrl: run.html_url,
        }),
      });
      if (stored) count++;
    }
    return count;
  }

  private async load(
    workspaceId: string,
    agentId: string,
    fullName: string,
  ): Promise<{ agent: CiAgentRow; repo: CiRepoRow }> {
    const agent = await this.deps.store.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const repo = await this.deps.store.findRepo(workspaceId, fullName);
    if (!repo) throw new NotFoundError('Repository not found');
    return { agent, repo };
  }

  /** Reuse the manifest path of an earlier install: the runner hard-fails on a second manifest. */
  private async manifestPathFor(
    workspaceId: string,
    agent: CiAgentRow,
    repo: CiRepoRow,
  ): Promise<string> {
    const installs = await this.deps.store.listInstallations(workspaceId, agent.id);
    const prior = installs.find((i) => i.installation.repo === repo.fullName)?.meta?.manifest_path;
    return prior ?? `${MANIFEST_DIR}/${slugify(agent.name)}.yaml`;
  }

  private async generate(
    workspaceId: string,
    agent: CiAgentRow,
    repo: CiRepoRow,
    manifestPath: string,
    opts: GenerateOpts,
  ): Promise<Generated> {
    const all = await this.deps.store.enabledSkills(agent.id);
    const skipped: string[] = [];
    const kept = all.filter((s) => {
      if (SCANNED_SOURCES.has(s.source) && securityReport(s.body).status === 'flagged') {
        skipped.push(s.name);
        return false;
      }
      return true;
    });
    const slugs = uniqueSlugs(kept.map((s) => s.name));
    const memory = await this.deps.store.repoMemory(workspaceId, repo.id);
    const bundle = await this.deps.bundle.read();
    const workflowYaml = opts.workflowYaml ?? buildWorkflowYaml({ triggers: opts.triggers, postAs: opts.postAs });
    if (opts.workflowYaml !== undefined) {
      const check = validateWorkflowYaml(opts.workflowYaml);
      if (!check.ok) throw new AppError('ci_workflow_invalid', check.error, 422);
    }
    const files = assembleFiles({
      manifestPath,
      manifestYaml: buildManifestYaml(agent, slugs),
      skills: kept.map((s, i) => ({ slug: slugs[i]!, body: s.body })),
      memoryJsonl: buildMemoryJsonl(memory),
      runner: bundle?.files ?? [],
      includeGitattributes: await this.shouldWriteGitattributes(repo),
      workflowYaml,
    });
    return { files, skipped, skillSlugs: slugs, manifestPath, bundle };
  }

  /**
   * Write our `.gitattributes` only when the default branch has none. When
   * existence cannot be established (no token, network, rate limit) the file is
   * omitted, so an existing one is never overwritten — and never merged.
   */
  private async shouldWriteGitattributes(repo: CiRepoRow): Promise<boolean> {
    try {
      const gh = await this.deps.github();
      return !(await gh.pathExists(repoRef(repo.fullName), GITATTRIBUTES_PATH, repo.defaultBranch));
    } catch {
      return false;
    }
  }

  private metaFor(
    agent: CiAgentRow,
    gen: Generated,
    triggers: CiTrigger[],
    postAs: CiPostAs,
    bundle: RunnerBundle,
  ): CiExportMeta {
    return {
      model: agent.model,
      provider: agent.provider,
      skills: gen.skillSlugs,
      ci_fail_on: agent.ciFailOn,
      triggers,
      post_as: postAs,
      manifest_path: gen.manifestPath,
      runner_sha256: bundle.sha256,
    };
  }

  /** Commit to the CI branch, then reuse the open PR or open one. Returns the PR URL. */
  private async commitAndOpenPr(repo: CiRepoRow, files: CiFile[]): Promise<string> {
    const gh = await this.deps.github();
    const ref = repoRef(repo.fullName);
    await gh.commitFiles(ref, {
      branch: CI_BRANCH,
      base: repo.defaultBranch,
      message: PR_TITLE,
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });
    const existing = await gh.findOpenPr(ref, CI_BRANCH);
    if (existing) return existing.url;
    const opened = await gh.openPullRequest(ref, {
      title: PR_TITLE,
      head: CI_BRANCH,
      base: repo.defaultBranch,
      body: PR_BODY,
    });
    return opened.url;
  }
}
