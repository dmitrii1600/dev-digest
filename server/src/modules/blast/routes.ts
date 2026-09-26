import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import { BlastRepository } from './repository.js';
import { BlastService } from './service.js';

/**
 * Blast radius module — reads the repo-intel index only; never re-indexes.
 *   GET /pulls/:id/blast-radius → BlastRadius   changed symbols, callers,
 *                                                endpoints/crons, degraded flag
 * See `specs/07-blast-radius.md` and `README.md` in this folder.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new BlastService({
    prs: new BlastRepository(container.db),
    // Lazy port — reads `container.repoIntel` per call rather than capturing
    // it at plugin registration, so a test that patches the facade AFTER
    // `buildApp()` (server/INSIGHTS.md:17) is honoured.
    index: {
      getBlastRadius: (repoId, files) => container.repoIntel.getBlastRadius(repoId, files),
      getIndexState: (repoId) => container.repoIntel.getIndexState(repoId),
    },
    log: app.log,
    repoIntelEnabled: container.config.repoIntelEnabled,
    maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL,
  });

  app.get(
    '/pulls/:id/blast-radius',
    { schema: { params: IdParams, response: { 200: BlastRadius } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const out = await service.forPull(workspaceId, req.params.id);
      if (!out) throw new NotFoundError('Pull request not found');
      return out;
    },
  );
}
