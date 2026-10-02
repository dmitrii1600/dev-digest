import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadius, PrHistory } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import {
  MAX_HISTORY_COMMITS_PER_FILE,
  MAX_HISTORY_FILES,
  MAX_HISTORY_PRS,
  MAX_HISTORY_UNIQUE_COMMITS,
} from './constants.js';
import { BlastRepository } from './repository.js';
import { PrHistoryService } from './service.js';

/**
 * Blast radius module — reads the repo-intel index only; never re-indexes.
 *   GET /pulls/:id/blast-radius → BlastRadius   changed symbols, callers,
 *                                                endpoints/crons, degraded flag
 *   GET /pulls/:id/history      → PrHistory     prior merged PRs touching the
 *                                                same files, from GitHub (no
 *                                                LLM); cached in pr_brief.json
 * See `specs/09-blast-radius.md` and `README.md` in this folder.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const blastRepo = new BlastRepository(container.db);

  const historyService = new PrHistoryService({
    prs: blastRepo,
    // Lazy port — `container.github()` reads
    // `SecretsProvider` per call, and a test overrides it after `buildApp()`.
    github: {
      listCommitsForPath: async (repo, path, perPage) =>
        (await container.github()).listCommitsForPath(repo, path, perPage),
      listPullsForCommit: async (repo, sha) => (await container.github()).listPullsForCommit(repo, sha),
    },
    log: app.log,
    maxFiles: MAX_HISTORY_FILES,
    maxCommitsPerFile: MAX_HISTORY_COMMITS_PER_FILE,
    maxUniqueCommits: MAX_HISTORY_UNIQUE_COMMITS,
    maxPrs: MAX_HISTORY_PRS,
  });

  app.get(
    '/pulls/:id/blast-radius',
    { schema: { params: IdParams, response: { 200: BlastRadius } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // One shared BlastService on the container, so the PR brief and this route
      // share a single reindex-nudge throttle.
      const out = await container.blast.forPull(workspaceId, req.params.id);
      if (!out) throw new NotFoundError('Pull request not found');
      return out;
    },
  );

  app.get(
    '/pulls/:id/history',
    { schema: { params: IdParams, response: { 200: PrHistory } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const out = await historyService.forPull(workspaceId, req.params.id);
      if (!out) throw new NotFoundError('Pull request not found');
      return out;
    },
  );
}
