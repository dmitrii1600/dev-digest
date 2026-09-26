import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState, REPO_PAYMENTS_ID } from './helpers/fixtures.js';

function textOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return JSON.parse((content[0] as { text: string }).text) as Record<string, unknown>;
}

function setup() {
  const fake = createFakeApi(createFixtureState());
  const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
  return { fake, api };
}

describe('get_conventions', () => {
  it('defaults to "any": returns both accepted and pending, sorted accepted-first then by confidence', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });
    const payload = textOf(result);
    expect(payload.repo).toBe('acme/payments-api');
    const candidates = payload.candidates as Record<string, unknown>[];
    expect(candidates).toHaveLength(3);
    expect(candidates[0]!.status).toBe('accepted');
    expect(candidates[1]!.status).toBe('pending');
    expect(candidates[2]!.status).toBe('pending');
    // Never the raw snippet — evidence is "path:line" only.
    expect(candidates.every((c) => !('evidence_snippet' in c))).toBe(true);
    expect(candidates[0]!.evidence).toBe('src/api/users.ts:45');
    expect(payload.rejected_count).toBe(1);
  });

  it('filters by status', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/payments-api', status: 'accepted' },
    });
    const payload = textOf(result);
    const candidates = payload.candidates as Record<string, unknown>[];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.status).toBe('accepted');
  });

  it('gives a read-only "no scan" message for a repo with none', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/web' },
    });
    const payload = textOf(result);
    expect(payload.scan).toBeNull();
    expect(payload.candidates).toEqual([]);
    expect(payload.message).toContain('No convention scan exists for acme/web yet');
  });

  it('adds a running hint when a scan is in progress', async () => {
    const { fake, api } = setup();
    fake.state.conventions[REPO_PAYMENTS_ID]!.scan = {
      ...fake.state.conventions[REPO_PAYMENTS_ID]!.scan!,
      status: 'running',
    };
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });
    const payload = textOf(result);
    expect(payload.hint).toBe('A scan is running — call get_conventions again in a minute.');
  });

  it('includes the clipped scan error when a scan failed', async () => {
    const { fake, api } = setup();
    fake.state.conventions[REPO_PAYMENTS_ID]!.scan = {
      ...fake.state.conventions[REPO_PAYMENTS_ID]!.scan!,
      status: 'failed',
      error: 'model timed out',
    };
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });
    const payload = textOf(result);
    const scan = payload.scan as Record<string, unknown>;
    expect(scan.status).toBe('failed');
    expect(scan.error).toBe('model timed out');
  });

  it('never issues a POST', async () => {
    const { fake, api } = setup();
    const { client } = await connect({ api });
    await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/payments-api' } });
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
