import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safe } from '../errors.js';
import { shapeBlastRadius, toTextResult } from '../format.js';
import { createResolver } from '../resolve.js';
import type { ServerDeps } from '../server.js';
import { pr, repo } from './params.js';

const DESCRIPTION =
  'List the symbols a pull request changes, their callers (file:line) and the HTTP endpoints and crons that depend on them, read from the DevDigest repo index (no LLM, no re-analysis). If the index is partial, failed or off, it says degraded with a reason.';

/**
 * Blast radius (course lesson L04 — see specs/09-blast-radius.md). Resolves
 * repo/PR, refreshes the PR's changed-file list via `GET /pulls/:id` (the
 * same call the studio makes on open), then reads
 * `GET /pulls/:id/blast-radius` — a repo-intel index READ, never a
 * re-index. Degraded or empty is a normal result, not `isError`.
 */
export function register(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      description: DESCRIPTION,
      inputSchema: { repo, pr },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      safe(async () => {
        const resolver = createResolver(deps.api);
        const resolvedRepo = await resolver.resolveRepo(args.repo);
        const resolvedPr = await resolver.resolvePr(resolvedRepo, args.pr);

        const detail = await deps.api.getPull(resolvedPr.id);
        const blast = await deps.api.getBlastRadius(resolvedPr.id);

        return toTextResult(
          shapeBlastRadius(blast, { label: resolvedPr.label, headSha: detail.head_sha }),
        );
      }),
  );
}
