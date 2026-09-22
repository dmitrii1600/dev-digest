import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCategory, ConventionStatus, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EXTRACT_RATE_LIMIT, MAX_RULE_CHARS } from './constants.js';
import { ConventionsService } from './service.js';

/**
 * Conventions extractor module.
 *   GET    /repos/:id/conventions                 → ConventionsPage
 *   POST   /repos/:id/conventions/extract         → ConventionsPage   sync; 409 scan_running; 422 repo_not_cloned | repo_not_indexed
 *   PATCH  /repos/:id/conventions/:candidateId    → ConventionCandidate  accept / reject / edit
 *   POST   /repos/:id/conventions/skill/preview   → ConventionSkillDraft writes nothing
 *   POST   /repos/:id/conventions/skill           → { skill_id }        201
 */

const RepoCandidateParams = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
});

const PatchCandidateBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().trim().min(1).max(MAX_RULE_CHARS).optional(),
    category: ConventionCategory.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

const SkillPreviewBody = z.object({
  candidate_ids: z.array(z.string().uuid()).optional(),
});

const CreateSkillBody = z.object({
  candidate_ids: z.array(z.string().uuid()).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  agent_ids: z.array(z.string().uuid()), // may be empty — bind later from the agent editor
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const page = await service.page(workspaceId, req.params.id);
    if (!page) throw new NotFoundError('Repo not found');
    return page;
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams }, config: { rateLimit: EXTRACT_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const page = await service.extract(workspaceId, req.params.id);
      if (!page) throw new NotFoundError('Repo not found');
      return page;
    },
  );

  app.patch(
    '/repos/:id/conventions/:candidateId',
    { schema: { params: RepoCandidateParams, body: PatchCandidateBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidate = await service.updateCandidate(
        workspaceId,
        req.params.id,
        req.params.candidateId,
        req.body,
      );
      if (!candidate) throw new NotFoundError('Candidate not found');
      return candidate;
    },
  );

  app.post(
    '/repos/:id/conventions/skill/preview',
    { schema: { params: IdParams, body: SkillPreviewBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const draft = await service.skillDraft(workspaceId, req.params.id, req.body.candidate_ids);
      if (!draft) throw new NotFoundError('Repo not found');
      return draft;
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createSkill(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Repo not found');
      reply.status(201);
      return created;
    },
  );
}
