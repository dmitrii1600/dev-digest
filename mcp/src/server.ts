import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from './api-client.js';
import type { Config } from './config.js';
import { register as registerListAgents } from './tools/list-agents.js';
import { register as registerGetBlastRadius } from './tools/get-blast-radius.js';
import { register as registerGetFindings } from './tools/get-findings.js';
import { register as registerGetConventions } from './tools/get-conventions.js';
import { register as registerRunAgentOnPr } from './tools/run-agent-on-pr.js';

/**
 * Wall-clock + sleep, injected so `run_agent_on_pr`'s wait loop is testable
 * with a fake clock that advances instantly instead of a real 10-minute wait.
 */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface ServerDeps {
  api: ApiClient;
  config: Config;
  clock: Clock;
}

export interface CreateServerDeps {
  api: ApiClient;
  config: Config;
  clock?: Clock;
}

/**
 * The server's one always-visible sentence — injected into the system prompt
 * whole, ahead of any per-tool description. Canonical text now lives in
 * `specs/09-blast-radius.md` → *MCP tool: final strings* (superseding the
 * original `specs/08-mcp-server.md` → *Final tool descriptions → Server
 * `instructions`*, which shipped before blast radius existed);
 * `test/tools-list-budget.test.ts` guards its length.
 */
export const SERVER_INSTRUCTIONS =
  'Local DevDigest PR-review studio: run review agents on imported pull requests, read findings, repo conventions and blast radius; repos are owner/name, PRs are numbers.';

const DEFAULT_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      // Remove the listener when the timer wins: a 10-minute wait is ~125
      // polls on one `extra.signal`, and leaked listeners trip Node's
      // MaxListenersExceededWarning after the 11th.
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

/**
 * Builds the `devdigest` MCP server and registers its five tools. No
 * `outputSchema` on any of them (schema bytes on every session, before the
 * homework's return shape even exists) and no `title` (the names are
 * self-explanatory and every byte in `tools/list` counts).
 */
export function createServer(deps: CreateServerDeps): McpServer {
  const serverDeps: ServerDeps = {
    api: deps.api,
    config: deps.config,
    clock: deps.clock ?? DEFAULT_CLOCK,
  };

  const server = new McpServer(
    { name: 'devdigest', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerListAgents(server, serverDeps);
  registerGetBlastRadius(server, serverDeps);
  registerGetFindings(server, serverDeps);
  registerGetConventions(server, serverDeps);
  registerRunAgentOnPr(server, serverDeps);

  return server;
}
