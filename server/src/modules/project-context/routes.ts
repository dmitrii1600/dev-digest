import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ContextAttachments,
  ContextAttachmentsInput,
  ContextFileList,
  ContextFileQuery,
  ContextRepoQuery,
  SpecFile,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * Project Context module — clone Markdown files attached to agents and skills.
 *   GET      /repos/:id/context             → ContextFileList
 *   GET      /repos/:id/context/file?path=  → SpecFile (one capped document)
 *   GET|PUT  /agents/:id/context?repoId=    → ContextAttachments
 *   GET|PUT  /skills/:id/context?repoId=    → ContextAttachments
 * No route calls a model.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: ContextFileList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.list(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: ContextFileQuery, response: { 200: SpecFile } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.file(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, querystring: ContextRepoQuery, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.getAgent(workspaceId, req.params.id, req.query.repoId);
    },
  );

  app.put(
    '/agents/:id/context',
    {
      schema: {
        params: IdParams,
        querystring: ContextRepoQuery,
        body: ContextAttachmentsInput,
        response: { 200: ContextAttachments },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.putAgent(
        workspaceId,
        req.params.id,
        req.query.repoId,
        req.body.paths,
      );
    },
  );

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, querystring: ContextRepoQuery, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.getSkill(workspaceId, req.params.id, req.query.repoId);
    },
  );

  app.put(
    '/skills/:id/context',
    {
      schema: {
        params: IdParams,
        querystring: ContextRepoQuery,
        body: ContextAttachmentsInput,
        response: { 200: ContextAttachments },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.putSkill(
        workspaceId,
        req.params.id,
        req.query.repoId,
        req.body.paths,
      );
    },
  );
}
