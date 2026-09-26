import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunSummary } from '@devdigest/shared';
import { clip, safe, ToolError } from '../errors.js';
import { shapeReviews, toTextResult } from '../format.js';
import { createResolver } from '../resolve.js';
import type { ServerDeps } from '../server.js';
import { TERMINAL_STATUSES, waitForRuns } from '../wait.js';
import { pr, repo, responseFormat } from './params.js';
// zod/v4 for the tool's own input schema — see params.ts.
import { z } from 'zod/v4';

const DESCRIPTION =
  'Run a DevDigest review agent (or "all") on an imported pull request and wait for its verdict, score and findings. Slow (minutes) and spends LLM tokens: to read an existing review use get_findings. If the wait limit passes it returns status "running" with run ids — call get_findings with run_id later, do not re-run.';

function progressMessage(
  runs: RunSummary[],
  runIds: string[],
  elapsedMs: number,
  waitMs: number,
): string {
  const relevant = runIds.map((id) => runs.find((r) => r.run_id === id));
  const total = runIds.length;
  const done = relevant.filter((r) => r && r.status !== null && TERMINAL_STATUSES.has(r.status)).length;
  const pendingNames = relevant
    .filter((r) => !r || r.status === null || !TERMINAL_STATUSES.has(r.status))
    .map((r) => r?.agent_name ?? 'an agent');
  const elapsedS = Math.round(elapsedMs / 1000);
  const waitS = Math.round(waitMs / 1000);
  return `${done}/${total} agents finished — waiting on ${pendingNames.join(', ')} (${elapsedS}s of ${waitS}s)`;
}

export function register(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      description: DESCRIPTION,
      inputSchema: {
        repo,
        pr,
        agent: z
          .string()
          .min(1)
          .describe('Agent name from list_agents (case-insensitive), its id, or "all".'),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args, extra) =>
      safe(async () => {
        const resolver = createResolver(deps.api);
        const resolvedRepo = await resolver.resolveRepo(args.repo);
        const resolvedPr = await resolver.resolvePr(resolvedRepo, args.pr);
        const resolvedAgent = await resolver.resolveAgent(args.agent, { enabledOnly: true });

        const existingRuns = await deps.api.listRuns(resolvedPr.id);
        const runningRuns = existingRuns.filter((r) => r.status === 'running');

        let runIds: string[];
        let attached = false;

        if (resolvedAgent.kind === 'one') {
          const existing = runningRuns.find((r) => r.agent_id === resolvedAgent.id);
          if (existing) {
            runIds = [existing.run_id];
            attached = true;
          } else {
            const started = await deps.api.startReview(resolvedPr.id, { agentId: resolvedAgent.id });
            if (started.runs.length === 0) {
              throw new ToolError(
                'No enabled agents to run — enable one in the DevDigest studio, then call list_agents.',
              );
            }
            runIds = started.runs.map((r) => r.run_id);
          }
        } else {
          if (runningRuns.length > 0) {
            runIds = runningRuns.map((r) => r.run_id);
            attached = true;
          } else {
            const started = await deps.api.startReview(resolvedPr.id, { all: true });
            if (started.runs.length === 0) {
              throw new ToolError(
                'No enabled agents to run — enable one in the DevDigest studio, then call list_agents.',
              );
            }
            runIds = started.runs.map((r) => r.run_id);
          }
        }

        const waitResult = await waitForRuns({
          api: deps.api,
          prId: resolvedPr.id,
          runIds,
          clock: deps.clock,
          waitMs: deps.config.waitMs,
          pollMs: deps.config.pollMs,
          signal: extra.signal,
          onTick: async (pollIndex, runs, elapsedMs) => {
            const progressToken = extra._meta?.progressToken;
            if (progressToken === undefined) return;
            await extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: pollIndex,
                message: progressMessage(runs, runIds, elapsedMs, deps.config.waitMs),
              },
            });
          },
        });

        if (waitResult.state === 'timeout' || waitResult.state === 'aborted') {
          return toTextResult({
            pr: resolvedPr.label,
            status: 'running',
            run_ids: runIds,
            waited_s: Math.round(waitResult.elapsedMs / 1000),
            hint: 'Review still running. Call get_findings with run_id later; do not call run_agent_on_pr again.',
          });
        }

        // ---- terminal: fetch reviews, pair each requested run with its outcome ----
        const allReviews = await deps.api.listReviews(resolvedPr.id);
        const matchingReviews = allReviews.filter(
          (r) => r.kind === 'review' && r.run_id !== null && runIds.includes(r.run_id),
        );
        const representedRunIds = new Set(matchingReviews.map((r) => r.run_id));

        const failedEntries: Record<string, unknown>[] = [];
        for (const runId of runIds) {
          if (representedRunIds.has(runId)) continue;
          const run = waitResult.runs.find((r) => r.run_id === runId);
          failedEntries.push({
            agent_name: run?.agent_name ?? null,
            run_id: runId,
            run_status: run?.status ?? 'missing',
            error: run?.error ? clip(run.error, 300) : null,
          });
        }

        const doneCount = matchingReviews.length;
        const totalCount = runIds.length;
        const status = doneCount === totalCount ? 'done' : doneCount === 0 ? 'failed' : 'partial';

        const shaped = shapeReviews(matchingReviews, waitResult.runs, args.response_format);

        if (status === 'failed') {
          // Untrusted text egress: `run.error` is pipeline/model-adjacent text,
          // so it stays a data field inside `reviews[]` — never interpolated
          // into an MCP-authored sentence. The hint carries only our own words.
          const body = toTextResult({
            pr: resolvedPr.label,
            status,
            reviews: failedEntries,
            hint: "Review failed for every agent. Check the agent's provider key/model in DevDigest Settings.",
          });
          return { ...body, isError: true as const };
        }

        return toTextResult({
          pr: resolvedPr.label,
          status,
          ...(attached ? { attached: true } : {}),
          reviews: [...shaped.reviews, ...failedEntries],
          ...(shaped.truncated ? { truncated: shaped.truncated } : {}),
        });
      }),
  );
}
