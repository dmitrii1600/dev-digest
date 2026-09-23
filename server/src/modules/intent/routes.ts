import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { INTENT_RATE_LIMIT } from './constants.js';

/**
 * Intent Layer (L03) module.
 *   GET  /pulls/:id/intent   → PrIntentResponse   404 pull_not_found
 *   POST /pulls/:id/intent   → PrIntentRecord     404 pull_not_found · 422 intent_failed
 *
 * Neither route takes a body — "optional body is not a thing on this stack"
 * ([server/INSIGHTS.md:192]); `POST /runs/:id/cancel` is the no-body precedent.
 * See `modules/intent/README.md` for the sources, the confidence formula, the
 * prompt, and the "links are recorded, never fetched" rule.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const derived = await container.intent.get(workspaceId, req.params.id);
    return { derived };
  });

  // Tight per-route limit: every press is a full model call.
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams }, config: { rateLimit: INTENT_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.intent.derive(workspaceId, req.params.id);
    },
  );
}
