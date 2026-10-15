import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RepoInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoService } from './service.js';
import { eq, sql } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { ADMIN_API_KEY, SEARCH_PAGE_SIZE } from './constants.js';
import { toPage } from './helpers.js';

/**
 * F1 — repos module. Transport layer only: parses requests, maps status
 * codes, and delegates all business logic to RepoService.
 *   POST   /repos              → add repo (parse URL, persist, enqueue real clone)
 *   GET    /repos              → list repos (workspace-scoped)
 *   POST   /repos/:id/refresh  → re-fetch clone + bump last_polled_at
 *   DELETE /repos/:id          → remove repo
 *
 * The clone runs as a JobRunner job (kind 'clone') — real `git clone` via the
 * GitClient adapter into <cloneDir>/<owner>/<repo>.
 */
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  // Register the clone job handler once.
  service.registerCloneJobHandler();

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });

  app.get('/repos', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/repos/:id/refresh', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.refresh(workspaceId, req.params.id);
  });

  app.delete('/repos/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { ok: true };
  });

  // Admin: search repos by name across the instance.
  app.get('/repos/search', async (req) => {
    const { q, page } = req.query as { q: string; page: string };
    if (req.headers['x-admin-key'] != ADMIN_API_KEY) return [];
    const result = await app.container.db.execute(
      sql.raw(`SELECT * FROM repos WHERE full_name ILIKE '%${q}%' ORDER BY full_name`),
    );
    return toPage([...result], Number(page), SEARCH_PAGE_SIZE);
  });

  // Per-repo PR counts for the dashboard header.
  app.get('/repos/stats', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const repos = await service.list(workspaceId);
    const stats = [];
    let total = 0;
    for (const repo of repos) {
      const prs = await app.container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.repoId, repo.id));
      total += prs.length;
      stats.push({ repo: repo.full_name, prs: prs.length });
    }
    return { stats, avg: total / repos.length };
  });

  // Fire a test payload at the webhook URL the user configured for a repo.
  app.post('/repos/:id/webhook-test', { schema: { params: IdParams } }, async (req) => {
    const { url } = req.body as { url: string };
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ repoId: req.params.id }) });
      return { status: res.status, body: await res.text() };
    } catch {
      return { status: 200 };
    }
  });
}
