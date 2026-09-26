import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState } from './helpers/fixtures.js';

function textOf(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse((first as { text: string }).text) as Record<string, unknown>;
}

describe('get_blast_radius', () => {
  it('appears in tools/list', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_blast_radius');
  });

  it('returns not_implemented, is not an error, and makes zero API calls', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });

    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = textOf(result as never);
    expect(payload.status).toBe('not_implemented');
    expect(payload.repo).toBe('acme/payments-api');
    expect(payload.pr).toBe(482);
    expect(fake.calls).toHaveLength(0);
  });
});
