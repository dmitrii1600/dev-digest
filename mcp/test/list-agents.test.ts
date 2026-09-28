import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState } from './helpers/fixtures.js';

function textOf(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse((first as { text: string }).text) as Record<string, unknown>;
}

describe('list_agents', () => {
  it('appears in tools/list', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_agents');
  });

  it('returns only enabled agents, without system_prompt or output_schema', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });

    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    const payload = textOf(result as never);
    const agents = payload.agents as Record<string, unknown>[];

    expect(agents).toHaveLength(4); // 5 seeded, 1 disabled
    expect(agents.every((a) => a.enabled === true)).toBe(true);
    expect(agents.some((a) => a.name === 'Test Quality Reviewer')).toBe(false);
    for (const a of agents) {
      expect('system_prompt' in a).toBe(false);
      expect('output_schema' in a).toBe(false);
    }
  });

  it('returns a hint when no agent is enabled', async () => {
    const fake = createFakeApi(createFixtureState());
    for (const a of fake.state.agents) a.enabled = false;
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });

    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    const payload = textOf(result as never);
    expect(payload.agents).toEqual([]);
    expect(payload.hint).toBe('No enabled agents — enable one in the DevDigest studio.');
  });
});
