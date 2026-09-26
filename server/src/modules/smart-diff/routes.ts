import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffRepository } from './repository.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff (L03) module.
 *   GET /pulls/:id/smart-diff   → SmartDiffResponse   404 pull_not_found
 *
 * Pure, ordered, path-based classifier + builder — no model call, and it
 * never reaches into the reviews module (see `modules/smart-diff/README.md`).
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const service = new SmartDiffService(new SmartDiffRepository(container.db));
      return service.get(workspaceId, req.params.id);
    },
  );
}
