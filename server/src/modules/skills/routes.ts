import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_B64_CHARS, MAX_UPLOAD_BYTES } from './constants.js';
import { SkillsService } from './service.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * A1 — skills module.
 *   GET    /skills                        → list (workspace-scoped)
 *   GET    /skills/:id                    → one skill
 *   POST   /skills                        → create                        201
 *   PUT    /skills/:id                    → update (body change ⇒ version bump)
 *   DELETE /skills/:id                    → { ok: true }
 *   GET    /skills/:id/versions           → version history (newest first)
 *   GET    /skills/:id/versions/:version  → one snapshot
 *   POST   /skills/:id/restore            → append version max+1 from a past one
 *   GET    /skills/:id/agents             → agents this skill is linked to
 *   GET    /skills/:id/stats              → usage aggregates (agent-attributed)
 *   POST   /skills/import/preview         → parse .md/.zip, write nothing
 *   POST   /skills/import                 → parse + create                201
 *   POST   /skills/import/url/preview     → fetch (guarded) + parse, write nothing
 *   POST   /skills/import/url             → fetch + parse + create        201
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
});

const RestoreBody = z.object({
  version: z.number().int().positive(),
  note: z.string().optional(),
});

/** Base64 in JSON, not multipart — see `specs/03-skills.md` for why. */
const ImportBody = z.object({
  filename: z.string().min(1).max(255),
  content_base64: z.string().min(1).max(MAX_B64_CHARS),
  // Preview-editable metadata, applied on commit only — the parse itself is
  // never trusted from the client.
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
});

/** The URL is validated for shape here; the SSRF/size rules live in the adapter. */
const UrlPreviewBody = z.object({
  url: z.string().url().max(2048),
});

const UrlImportBody = UrlPreviewBody.extend({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
});

function decodeUpload(base64: string): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `File too large (${bytes.byteLength} bytes, max ${MAX_UPLOAD_BYTES})`,
    );
  }
  return bytes;
}

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: RestoreBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restore(
        workspaceId,
        req.params.id,
        req.body.version,
        req.body.note,
      );
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agents = await service.agentsUsing(workspaceId, req.params.id);
    if (!agents) throw new NotFoundError('Skill not found');
    return agents;
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  app.post(
    '/skills/import/preview',
    { schema: { body: ImportBody } },
    async (req) => {
      await getContext(app.container, req); // auth only — preview writes nothing
      const bytes = decodeUpload(req.body.content_base64);
      return service.previewImport(req.body.filename, bytes);
    },
  );

  app.post('/skills/import', { schema: { body: ImportBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const bytes = decodeUpload(req.body.content_base64);
    const skill = await service.commitImport(workspaceId, req.body.filename, bytes, {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
    });
    reply.status(201);
    return skill;
  });

  app.post(
    '/skills/import/url/preview',
    { schema: { body: UrlPreviewBody } },
    async (req) => {
      await getContext(app.container, req); // auth only — preview writes nothing
      return service.previewUrlImport(req.body.url);
    },
  );

  app.post('/skills/import/url', { schema: { body: UrlImportBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.commitUrlImport(workspaceId, req.body.url, {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
    });
    reply.status(201);
    return skill;
  });
}
