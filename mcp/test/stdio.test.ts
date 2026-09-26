import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Real spawn: `node` + the tsx CLI + `src/index.ts`, exactly as `.mcp.json`
 * launches it (no `npm`/`npx` — see INSIGHTS.md:232 and step 11). This is
 * also the proof, in CI, that tsx honours the `@devdigest/shared`/`zod` path
 * aliases without `server/node_modules` being installed at all.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = path.resolve(__dirname, '..');

function tsxArgs(): string[] {
  return [
    path.join(MCP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    '--tsconfig',
    path.join(MCP_ROOT, 'tsconfig.json'),
    path.join(MCP_ROOT, 'src', 'index.ts'),
  ];
}

/** `process.env` with every `undefined` value dropped, plus overrides — the
 *  shape `StdioServerParameters.env` (`Record<string, string>`) requires. */
function envWith(overrides: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  return { ...base, ...overrides };
}

function startFakeHttpApi(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/agents') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'no fake route' } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe('stdio spawn (real node + tsx process)', () => {
  it('lists exactly five tools and answers list_agents against a real HTTP API', async () => {
    const fakeApi = await startFakeHttpApi();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: tsxArgs(),
      env: envWith({ DEVDIGEST_API_URL: fakeApi.url }),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-spawn-test', version: '0.0.0' });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'get_blast_radius',
        'get_conventions',
        'get_findings',
        'list_agents',
        'run_agent_on_pr',
      ]);

      const result = await client.callTool({ name: 'list_agents', arguments: {} });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
    } finally {
      await client.close();
      await fakeApi.close();
    }
  }, 20_000);

  it('gives an actionable isError mentioning "not reachable" against an unused port', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: tsxArgs(),
      // Port 1 is a real TCP port nothing here listens on — a fast, real
      // ECONNREFUSED, not a mock.
      env: envWith({ DEVDIGEST_API_URL: 'http://127.0.0.1:1' }),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-spawn-test-2', version: '0.0.0' });

    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'list_agents', arguments: {} });
      expect((result as { isError?: boolean }).isError).toBe(true);
      const text = (result as { content: { text: string }[] }).content[0]!.text;
      expect(text).toContain('not reachable');
    } finally {
      await client.close();
    }
  }, 20_000);
});
