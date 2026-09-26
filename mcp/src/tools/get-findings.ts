// zod/v4 for the tool's own input schema — see params.ts.
import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReviewRecord, RunSummary } from '@devdigest/shared';
import { clip, safe, ToolError } from '../errors.js';
import { shapeReviews, toTextResult } from '../format.js';
import { createResolver } from '../resolve.js';
import type { ServerDeps } from '../server.js';
import { pr, repo, responseFormat } from './params.js';

const DESCRIPTION =
  'Read the latest saved DevDigest review of a pull request, one entry per agent: verdict, score and findings sorted by severity. Never starts a review (use run_agent_on_pr). Narrow with agent or run_id.';

/** Dedup key: which reviews belong to "the same agent" across re-runs. */
function agentKey(r: ReviewRecord): string {
  return r.agent_id ?? r.agent_name ?? r.id;
}

/** Newest-per-agent: the API returns reviews newest first, so the first
 *  occurrence of a key IS the latest review for that agent. */
function latestPerAgent(reviews: ReviewRecord[]): ReviewRecord[] {
  const seen = new Set<string>();
  const out: ReviewRecord[] = [];
  for (const r of reviews) {
    const key = agentKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function computeInProgress(
  runs: RunSummary[],
  finalReviews: ReviewRecord[],
  agentFilter: { id: string; name: string } | undefined,
): { agent_name: string | null; run_id: string }[] {
  const representedRunIds = new Set(finalReviews.map((r) => r.run_id));
  return runs
    .filter((r) => r.status === 'running')
    .filter((r) => !agentFilter || r.agent_id === agentFilter.id)
    .filter((r) => !representedRunIds.has(r.run_id))
    .map((r) => ({ agent_name: r.agent_name, run_id: r.run_id }));
}

export function register(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_findings',
    {
      description: DESCRIPTION,
      inputSchema: {
        repo,
        pr,
        agent: z.string().min(1).optional().describe('Only this agent (name or id).'),
        run_id: z
          .string()
          .uuid()
          .optional()
          .describe('Only the review from this run (returned by run_agent_on_pr).'),
        response_format: responseFormat,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      safe(async () => {
        const resolver = createResolver(deps.api);
        const resolvedRepo = await resolver.resolveRepo(args.repo);
        const resolvedPr = await resolver.resolvePr(resolvedRepo, args.pr);

        let agentFilter: { id: string; name: string } | undefined;
        if (args.agent !== undefined) {
          const resolved = await resolver.resolveAgent(args.agent, { enabledOnly: false });
          if (resolved.kind === 'one') agentFilter = { id: resolved.id, name: resolved.name };
        }

        const [allReviews, runs] = await Promise.all([
          deps.api.listReviews(resolvedPr.id),
          deps.api.listRuns(resolvedPr.id),
        ]);

        const latest = latestPerAgent(allReviews.filter((r) => r.kind === 'review'));
        const afterAgentFilter = agentFilter
          ? latest.filter((r) => r.agent_id === agentFilter!.id)
          : latest;

        // ---- run_id filter (also covers the three non-review run states) ----
        let filtered = afterAgentFilter;
        if (args.run_id !== undefined) {
          const match = afterAgentFilter.find((r) => r.run_id === args.run_id);
          if (match) {
            filtered = [match];
          } else {
            const run = runs.find((r) => r.run_id === args.run_id);
            if (!run) {
              throw new ToolError(`Run '${clip(args.run_id, 100)}' not found on ${resolvedPr.label}.`);
            }
            if (run.status === 'running' || run.status === null) {
              return toTextResult({
                pr: resolvedPr.label,
                status: 'running',
                run_id: args.run_id,
                hint: 'Review still running — call get_findings again in a minute.',
              });
            }
            if (run.status === 'failed' || run.status === 'cancelled') {
              return toTextResult({
                status: run.status,
                run_id: args.run_id,
                agent_name: run.agent_name,
                error: run.error ? clip(run.error, 300) : null,
              });
            }
            // status === 'done' but no matching review is an unexpected race;
            // surface it the same way as an unknown run rather than a silent empty result.
            throw new ToolError(`Run '${clip(args.run_id, 100)}' not found on ${resolvedPr.label}.`);
          }
        }

        if (filtered.length === 0) {
          return toTextResult({
            pr: resolvedPr.label,
            reviews: [],
            hint: `No review yet for ${resolvedPr.label} — call run_agent_on_pr.`,
          });
        }

        const inProgress = computeInProgress(runs, filtered, agentFilter);
        const shaped = shapeReviews(filtered, runs, args.response_format);

        return toTextResult({
          pr: resolvedPr.label,
          reviews: shaped.reviews,
          ...(inProgress.length > 0 ? { in_progress: inProgress } : {}),
          ...(shaped.truncated ? { truncated: shaped.truncated } : {}),
        });
      }),
  );
}
