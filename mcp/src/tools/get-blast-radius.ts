import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safe } from '../errors.js';
import { toTextResult } from '../format.js';
import type { ServerDeps } from '../server.js';
import { pr, repo } from './params.js';

const DESCRIPTION =
  'Not implemented yet — always returns status "not_implemented"; do not call it to answer a real question. Will list the symbols a pull request changes and the code that depends on them.';

/**
 * Homework seam (course lesson L04 — Blast Radius). This tool is a stub on
 * purpose: it keeps the final input shape stable so the real implementation
 * is a drop-in. Building it means:
 *   1. `createResolver(api)` → `resolveRepo`, `resolvePr` (see resolve.ts).
 *   2. `GET /pulls/:id` → `PrDetail.files[].path` (server/src/vendor/shared/
 *      contracts/platform.ts:211), via a new `api.getPull` method.
 *   3. A NEW server route (e.g. `GET /pulls/:id/blast-radius`) backed by
 *      `RepoIntel.getBlastRadius(repoId, changedFiles)`
 *      (server/src/modules/repo-intel/types.ts:147), returning `BlastRadius`
 *      (server/src/vendor/shared/contracts/brief.ts:39). This MCP process
 *      cannot call RepoIntel directly — it only ever talks HTTP to the API.
 *   4. Shape concise output from `changed_symbols` / `downstream` with the
 *      caps in `format.ts`.
 */
export function register(server: McpServer, _deps: ServerDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      description: DESCRIPTION,
      inputSchema: { repo, pr },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      safe(async () => {
        // Zero API calls — the stub never touches the network.
        return toTextResult({
          status: 'not_implemented',
          repo: args.repo,
          pr: args.pr,
          message:
            'Blast radius is not implemented yet (course lesson L04 homework). Use get_findings for review results.',
        });
      }),
  );
}
