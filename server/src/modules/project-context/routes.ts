import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachments,
  ContextAttachmentsInput,
  ContextFileCreate,
  ContextFileDeleteQuery,
  ContextFileList,
  ContextFileQuery,
  ContextFileSave,
  ContextFileUpload,
  ContextRepoQuery,
  SpecFile,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

type WriteOutcome = 'created' | 'uploaded' | 'saved' | 'deleted';

/** What a write handler learned, read by the `onResponse` log hook. */
const writeInfo = new WeakMap<FastifyRequest, { path: string; bytes: number }>();
const writeErrorCode = new WeakMap<FastifyRequest, string>();

const bytesOf = (v: unknown): number => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : 0);

/** Best-effort path/bytes of a request that never reached (or failed in) the handler. */
function receivedInfo(req: FastifyRequest): { path: string; bytes: number } {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const path = [body.path, query.path, body.name].find((v) => typeof v === 'string') as string | undefined;
  return { path: path ?? '', bytes: bytesOf(body.content) || bytesOf(body.content_base64) };
}

/**
 * Project Context module — clone Markdown files attached to agents and skills.
 *   GET      /repos/:id/context             → ContextFileList
 *   GET      /repos/:id/context/file?path=  → SpecFile (one capped document)
 *   POST     /repos/:id/context/files       → 201 SpecFile (new file or folder; {kind, name})
 *   POST     /repos/:id/context/upload      → 201 SpecFile ({name, content_base64}; bytes written unchanged)
 *   PUT      /repos/:id/context/file        → SpecFile (save; {path, content, version|null})
 *   DELETE   /repos/:id/context/file?path=&version= → 204
 *   GET|PUT  /agents/:id/context?repoId=    → ContextAttachments
 *   GET|PUT  /skills/:id/context?repoId=    → ContextAttachments
 * The four writes touch only `.devdigest/specs/` in the clone, never Postgres; a stale
 * version is a 409 `version_conflict`. Each write request logs one line (never the content).
 * No route calls a model.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // NFR-9: exactly one line per write request, never the content. Only routes that
  // declare `config.writeOutcome` are logged; `onError` merely remembers the code
  // because both hooks fire on a failed request.
  app.addHook('onError', async (req, _reply, err) => {
    if (!(req.routeOptions.config as { writeOutcome?: WriteOutcome }).writeOutcome) return;
    writeErrorCode.set(req, (err as { code?: string }).code ?? '');
  });
  app.addHook('onResponse', async (req, reply) => {
    const configured = (req.routeOptions.config as { writeOutcome?: WriteOutcome }).writeOutcome;
    if (!configured) return;
    let outcome: string;
    if (reply.statusCode < 300) outcome = configured;
    else outcome = writeErrorCode.get(req) === 'version_conflict' ? 'conflict' : 'rejected';
    const info = writeInfo.get(req) ?? receivedInfo(req);
    app.log.info(
      { repoId: (req.params as { id?: string }).id, path: info.path, bytes: info.bytes, outcome },
      'project-context write',
    );
  });

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

  app.post(
    '/repos/:id/context/files',
    {
      schema: { params: IdParams, body: ContextFileCreate, response: { 201: SpecFile } },
      config: { writeOutcome: 'created' satisfies WriteOutcome },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const file = await container.projectContext.create(workspaceId, req.params.id, req.body);
      writeInfo.set(req, { path: file.path, bytes: file.size ?? 0 });
      return reply.code(201).send(file);
    },
  );

  app.post(
    '/repos/:id/context/upload',
    {
      schema: { params: IdParams, body: ContextFileUpload, response: { 201: SpecFile } },
      config: { writeOutcome: 'uploaded' satisfies WriteOutcome },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const file = await container.projectContext.upload(workspaceId, req.params.id, req.body);
      writeInfo.set(req, { path: file.path, bytes: file.size ?? 0 });
      return reply.code(201).send(file);
    },
  );

  app.put(
    '/repos/:id/context/file',
    {
      schema: { params: IdParams, body: ContextFileSave, response: { 200: SpecFile } },
      config: { writeOutcome: 'saved' satisfies WriteOutcome },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const file = await container.projectContext.save(workspaceId, req.params.id, req.body);
      writeInfo.set(req, { path: file.path, bytes: file.size ?? 0 });
      return file;
    },
  );

  app.delete(
    '/repos/:id/context/file',
    {
      schema: { params: IdParams, querystring: ContextFileDeleteQuery, response: { 204: z.undefined() } },
      config: { writeOutcome: 'deleted' satisfies WriteOutcome },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const removed = await container.projectContext.remove(workspaceId, req.params.id, req.query);
      writeInfo.set(req, removed);
      return reply.code(204).send();
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
