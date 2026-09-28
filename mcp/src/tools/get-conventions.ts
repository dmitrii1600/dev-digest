// zod/v4 for the tool's own input schema — see params.ts.
import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ConventionCandidate } from '@devdigest/shared';
import { clip, safe } from '../errors.js';
import { MAX_LIST, toTextResult } from '../format.js';
import { createResolver } from '../resolve.js';
import type { ServerDeps } from '../server.js';
import { repo } from './params.js';

const DESCRIPTION =
  'Read the coding conventions DevDigest extracted from a repository: rule, category, confidence, status and evidence file:line. Read-only — if no scan exists it says so; scans are started from the DevDigest studio.';

const STATUS_WEIGHT: Record<string, number> = { accepted: 0, pending: 1 };

function evidence(c: ConventionCandidate): string {
  return c.evidence_line != null ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path;
}

export function register(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_conventions',
    {
      description: DESCRIPTION,
      inputSchema: {
        repo,
        status: z.enum(['accepted', 'pending', 'any']).default('any'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      safe(async () => {
        const resolver = createResolver(deps.api);
        const resolvedRepo = await resolver.resolveRepo(args.repo);

        // GET only — this tool never triggers a scan (POST …/extract).
        const page = await deps.api.getConventions(resolvedRepo.id);

        if (!page.scan && page.candidates.length === 0) {
          return toTextResult({
            repo: resolvedRepo.full_name,
            scan: null,
            candidates: [],
            message: `No convention scan exists for ${resolvedRepo.full_name} yet. Scans are started from the repo's Conventions page in the DevDigest studio; this tool is read-only.`,
          });
        }

        const filtered =
          args.status === 'any'
            ? page.candidates
            : page.candidates.filter((c) => c.status === args.status);

        const sorted = [...filtered].sort((a, b) => {
          const w = (STATUS_WEIGHT[a.status] ?? 2) - (STATUS_WEIGHT[b.status] ?? 2);
          if (w !== 0) return w;
          return b.confidence - a.confidence;
        });

        const total = sorted.length;
        const shown = sorted.slice(0, MAX_LIST);

        const candidates = shown.map((c) => ({
          category: c.category,
          rule: clip(c.rule, 300),
          confidence: c.confidence,
          status: c.status,
          evidence: evidence(c),
        }));

        const scan = page.scan
          ? {
              status: page.scan.status,
              ...(page.scan.finished_at ? { finished_at: page.scan.finished_at } : {}),
              model: page.scan.model,
              candidates_grounded: page.scan.candidates_grounded,
              ...(page.scan.status === 'failed' && page.scan.error
                ? { error: clip(page.scan.error, 300) }
                : {}),
            }
          : null;

        return toTextResult({
          repo: resolvedRepo.full_name,
          scan,
          candidates,
          rejected_count: page.rejected_count,
          ...(page.scan?.status === 'running'
            ? { hint: 'A scan is running — call get_conventions again in a minute.' }
            : {}),
          ...(shown.length < total
            ? {
                truncated: {
                  shown: shown.length,
                  total,
                  hint: 'Showing the highest-confidence conventions. Narrow with status.',
                },
              }
            : {}),
        });
      }),
  );
}
