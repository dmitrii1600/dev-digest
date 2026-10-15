import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentCi,
  CiExport,
  CiExportInput,
  CiPostAs,
  CiPreview,
  CiRefreshInput,
  CiRefreshResult,
  CiRun,
  CiTrigger,
  CiUpdateResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiRepository } from './repository.js';
import { CiService } from './service.js';

const EmptyBody = z.object({}).strict();

const PreviewQuery = z
  .object({
    repo: CiExportInput.shape.repo,
    post_as: CiPostAs.default('github_review'),
    triggers: z
      .string()
      .default('opened,synchronize')
      .transform((s) => s.split(',').filter(Boolean))
      .pipe(z.array(CiTrigger).min(1)),
  })
  .strict();

const RunsQuery = z
  .object({ agent_id: z.string().uuid().optional(), repo_id: z.string().uuid().optional() })
  .strict();

/**
 * Export-to-CI — turns an agent into a PR (or zip) for a repository's GitHub
 * Actions, and pulls verified workflow runs back as CI Runs.
 *   GET  /agents/:id/ci                       → AgentCi
 *   GET  /agents/:id/export-ci/preview?repo=&post_as=&triggers=a,b → CiPreview   404 unknown agent / repo
 *   POST /agents/:id/export-ci                → CiExport     body CiExportInput
 *                                                              404 · 409 ci_repo_taken (details.agent_name)
 *                                                              422 ci_bundle_missing | ci_workflow_invalid
 *                                                              502 ci_github_failed
 *   POST /agents/:id/ci/update                → CiUpdateResult  body `{}`; 422 ci_bundle_missing
 *   GET  /ci/runs?agent_id=&repo_id=          → CiRun[]      newest first
 *   POST /ci/runs/refresh                     → CiRefreshResult  body CiRefreshInput; 502 ci_github_failed
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new CiService({
    store: new CiRepository(container.db),
    // Lazy: read per call, so a test that patches the container after buildApp() is honoured.
    bundle: { read: () => container.runnerBundle.read() },
    github: () => container.github(),
  });

  app.get(
    '/agents/:id/ci',
    { schema: { params: IdParams, response: { 200: AgentCi } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.agentCi(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/export-ci/preview',
    { schema: { params: IdParams, querystring: PreviewQuery, response: { 200: CiPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const q = req.query;
      return service.preview(workspaceId, req.params.id, {
        repo: q.repo,
        triggers: q.triggers,
        postAs: q.post_as,
      });
    },
  );

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.export(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci/update',
    { schema: { params: IdParams, body: EmptyBody, response: { 200: CiUpdateResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateAll(workspaceId, req.params.id);
    },
  );

  app.get(
    '/ci/runs',
    { schema: { querystring: RunsQuery, response: { 200: z.array(CiRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, {
        agentId: req.query.agent_id,
        repoId: req.query.repo_id,
      });
    },
  );

  app.post(
    '/ci/runs/refresh',
    { schema: { body: CiRefreshInput, response: { 200: CiRefreshResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.refresh(workspaceId, { agentId: req.body.agent_id });
    },
  );
}
