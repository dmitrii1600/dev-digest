import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState } from './helpers/fixtures.js';

/**
 * stdout is the JSON-RPC channel end to end: a single stray `console.log` or
 * `process.stdout.write` would corrupt every message after it. This asserts
 * zero writes across every tool AND every error path (ToolError, an
 * unreachable API, and a genuine internal bug) — not just the happy path.
 */
describe('stdout hygiene', () => {
  it('writes nothing to stdout across every tool and error path', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fake = createFakeApi(createFixtureState());
    // Indirected so the internal-error case below can swap fetchImpl mid-test.
    const api = createApiClient({
      baseUrl: 'http://localhost:3001',
      fetchImpl: ((input, init) => fake.fetchImpl(input, init)) as typeof fetch,
      timeoutMs: 5_000,
    });
    const { client } = await connect({ api });

    // ---- happy paths, all five tools ----
    await client.listTools();
    await client.callTool({ name: 'list_agents', arguments: {} });
    await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });
    await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });
    await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/payments-api' } });

    // ---- ToolError path: an unknown repo ----
    const toolErrorResult = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'nope/nope', pr: 1 },
    });
    expect((toolErrorResult as { isError?: boolean }).isError).toBe(true);

    // ---- unreachable-API path ----
    fake.setUnreachable(true);
    const unreachableResult = await client.callTool({ name: 'list_agents', arguments: {} });
    expect((unreachableResult as { isError?: boolean }).isError).toBe(true);
    fake.setUnreachable(false);

    // ---- internal-error path: fetchImpl throws something that is neither
    // a network TypeError nor an ApiError-mapped status ----
    const originalFetch = fake.fetchImpl;
    fake.fetchImpl = (() => {
      throw new Error('unexpected bug');
    }) as unknown as typeof fake.fetchImpl;
    const internalResult = await client.callTool({ name: 'list_agents', arguments: {} });
    expect((internalResult as { isError?: boolean }).isError).toBe(true);
    const internalText = (internalResult as { content: { text: string }[] }).content[0]!.text;
    expect(internalText).toContain('Internal error in the devdigest MCP server');
    fake.fetchImpl = originalFetch;

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
