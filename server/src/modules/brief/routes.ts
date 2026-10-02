import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ADAPTER_TIMEOUT_MS, BRIEF_RATE_LIMIT, BRIEF_STALE_MS, BRIEF_TIMEOUT_MS } from './constants.js';
import { BriefRepository } from './repository.js';
import { BriefService } from './service.js';

/**
 * PR Brief module — a summary, risk areas and a review-focus list for one PR.
 *   GET  /pulls/:id/brief  → PrBriefResponse  the stored brief (or null) + `stale` +
 *                                             `generating`; no model call
 *   POST /pulls/:id/brief  → PrBriefResponse  sync; takes no body (a body is ignored);
 *                                             404 not_found
 *                                             409 brief_running
 *                                             422 no_changed_files
 *                                             422 provider_key_missing   details.provider
 *                                             422 brief_input_too_large
 *                                             502 brief_failed           details.reason:
 *                                                 timeout | invalid_output | llm_error
 * See `README.md` in this folder.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new BriefService({
    repo: new BriefRepository(container.db),
    // Lazy ports — read `container.*` per call rather than capturing at plugin
    // registration, so a test that patches a facade AFTER `buildApp()`
    // (server/INSIGHTS.md:17) is honoured.
    intent: { get: (workspaceId, prId) => container.intent.get(workspaceId, prId) },
    blast: { forPull: (workspaceId, prId) => container.blast.forPull(workspaceId, prId) },
    smartDiff: { get: (workspaceId, prId) => container.smartDiff.get(workspaceId, prId) },
    projectContext: { resolveForRepo: (input) => container.projectContext.resolveForRepo(input) },
    github: { getIssue: async (repo, n) => (await container.github()).getIssue(repo, n) },
    resolveModel: (workspaceId) => resolveFeatureModel(container, workspaceId, 'risk_brief'),
    llm: (provider) => container.llm(provider, { singleShot: { timeoutMs: ADAPTER_TIMEOUT_MS } }),
    countTokens: (text) => container.tokenizer.count(text),
    log: app.log,
    timeoutMs: BRIEF_TIMEOUT_MS,
    adapterTimeoutMs: ADAPTER_TIMEOUT_MS,
    staleMs: BRIEF_STALE_MS,
  });

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const page = await service.page(workspaceId, req.params.id);
      if (!page) throw new NotFoundError('Pull request not found');
      return page;
    },
  );

  // No `body` schema on purpose: the POST takes none and ignores one (the intent POST is the precedent).
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: PrBriefResponse } },
      config: { rateLimit: BRIEF_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const page = await service.generate(workspaceId, req.params.id);
      if (!page) throw new NotFoundError('Pull request not found');
      return page;
    },
  );
}
