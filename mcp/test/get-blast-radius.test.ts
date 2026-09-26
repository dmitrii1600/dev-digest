import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState, PR_482_ID, REPO_PAYMENTS_ID } from './helpers/fixtures.js';

function textOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return JSON.parse((content[0] as { text: string }).text) as Record<string, unknown>;
}

function setup() {
  const fake = createFakeApi(createFixtureState());
  const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
  return { fake, api };
}

describe('get_blast_radius', () => {
  it('resolves repo and PR, refreshes the file list, then reads the index — in that exact call order', async () => {
    const { fake, api } = setup();
    const { client } = await connect({ api });

    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /repos',
      `GET /repos/${REPO_PAYMENTS_ID}/pulls`,
      `GET /pulls/${PR_482_ID}`,
      `GET /pulls/${PR_482_ID}/blast-radius`,
    ]);

    const payload = textOf(result);
    expect(payload.pr).toBe('acme/payments-api#482');
    expect(payload.summary).toBe('2 changed symbols; 3 callers in 3 files; 2 endpoints; 1 cron.');
    const downstream = payload.downstream as Record<string, unknown>[];
    expect(downstream[0]!.callers).toEqual([
      'src/api/public/webhooks.ts:42 registerPublicRoutes',
      'src/api/users.ts:118 createUser',
    ]);
    expect(payload.degraded).toBeUndefined();
  });

  it('returns a normal (non-error) degraded result for an unindexed repo', async () => {
    const { api } = setup();
    const { client } = await connect({ api });

    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 480 },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = textOf(result);
    expect(payload.degraded).toBe(true);
    expect(payload.reason).toBe('no_data');
    expect(payload.hint).toBe('Index no_data: callers may be missing. Re-index the repo from the DevDigest studio.');
    expect(payload.changed_symbols).toEqual([]);
    expect(payload.downstream).toEqual([]);
  });

  it('errors on an unknown PR with the resolver\'s actionable text, and never calls the blast route', async () => {
    const { fake, api } = setup();
    const { client } = await connect({ api });

    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 999 },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain('PR #999 not found in acme/payments-api');
    expect(text).toContain('Known PRs');
    expect(fake.calls.some((c) => c.path.endsWith('/blast-radius'))).toBe(false);
  });

  it('errors when the blast route 404s', async () => {
    const { fake, api } = setup();
    fake.failNext('GET', `/pulls/${PR_482_ID}/blast-radius`, 404);
    const { client } = await connect({ api });

    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain(`found nothing at GET /pulls/${PR_482_ID}/blast-radius (404)`);
  });

  it('never issues a POST', async () => {
    const { fake, api } = setup();
    const { client } = await connect({ api });
    await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/payments-api', pr: 482 } });
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
