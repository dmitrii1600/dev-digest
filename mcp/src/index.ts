import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { createServer } from './server.js';

/**
 * Entry point. No "am I the main module" guard (INSIGHTS.md:43 — the
 * backslash-vs-`file://` comparison never matches on Windows): this file is
 * only ever run as an entry, never imported, so the guard would be dead code
 * that happens to also be a trap. No banner either — stdout is the JSON-RPC
 * channel end to end.
 */

process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException', { message: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log('error', 'unhandledRejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});

const config = loadConfig();
// No start-up health check: a down API surfaces as `unreachable` per tool
// call, so `tools/list` still succeeds and the server "lists fine" even when
// the API is not running yet.
const api = createApiClient({ baseUrl: config.apiUrl, timeoutMs: config.httpTimeoutMs });
const server = createServer({ api, config });

await server.connect(new StdioServerTransport());
log('info', `devdigest MCP ready (api ${new URL(config.apiUrl).origin})`);
