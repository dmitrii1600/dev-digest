import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingGenerateBody, OnboardingPage } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { GENERATE_RATE_LIMIT, GENERATION_STALE_MS, GENERATION_TIMEOUT_MS } from './constants.js';
import { OnboardingRepository } from './repository.js';
import { readExcerpts, readRunSources } from './repository-files.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding generator module — a five-part tour of an unfamiliar repo.
 *   GET  /repos/:id/onboarding           → OnboardingPage   the stored tour (or null) +
 *                                                           `generating` + `stale`; no LLM call
 *   POST /repos/:id/onboarding/generate  → OnboardingPage   sync; body `{}`;
 *                                                           404 unknown repo
 *                                                           409 generation_running
 *                                                           422 repo_not_cloned
 *                                                           422 repo_not_indexed  details.reason:
 *                                                               flag_off | never_indexed | index_failed | no_ranked_files
 *                                                           422 provider_key_missing  details.provider
 *                                                           502 generation_failed  details.reason:
 *                                                               timeout | invalid_output | llm_error
 * The client page lives at /repos/:repoId/tour; the API segment stays `onboarding`.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new OnboardingService({
    repo: new OnboardingRepository(container.db),
    // Lazy ports — read `container.*` per call rather than capturing at plugin
    // registration, so a test that patches the facade AFTER `buildApp()`
    // (server/INSIGHTS.md:17) is honoured.
    index: {
      getIndexState: (repoId) => container.repoIntel.getIndexState(repoId),
      getTopFilesByRank: (repoId, n, opts) => container.repoIntel.getTopFilesByRank(repoId, n, opts),
      getCriticalPaths: (repoId) => container.repoIntel.getCriticalPaths(repoId),
      getFileRank: (repoId, paths) => container.repoIntel.getFileRank(repoId, paths),
      getRepoMap: (repoId, budget) => container.repoIntel.getRepoMap(repoId, budget),
    },
    files: { readRunSources, readExcerpts },
    resolveModel: (workspaceId) => resolveFeatureModel(container, workspaceId, 'onboarding'),
    llm: (provider) => container.llm(provider),
    countTokens: (text) => container.tokenizer.count(text),
    log: app.log,
    repoIntelEnabled: container.config.repoIntelEnabled,
    timeoutMs: GENERATION_TIMEOUT_MS,
    staleMs: GENERATION_STALE_MS,
  });

  app.get(
    '/repos/:id/onboarding',
    { schema: { params: IdParams, response: { 200: OnboardingPage } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const page = await service.page(workspaceId, req.params.id);
      if (!page) throw new NotFoundError('Repo not found');
      return page;
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      schema: { params: IdParams, body: OnboardingGenerateBody, response: { 200: OnboardingPage } },
      config: { rateLimit: GENERATE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const page = await service.generate(workspaceId, req.params.id);
      if (!page) throw new NotFoundError('Repo not found');
      return page;
    },
  );
}
