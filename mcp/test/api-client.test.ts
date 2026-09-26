import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { ApiError } from '../src/errors.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState, PR_482_ID, REPO_PAYMENTS_ID } from './helpers/fixtures.js';

const TIMEOUT_MS = 30_000;

describe('createApiClient', () => {
  it('parses each endpoint with the shared schema', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });

    const repos = await api.listRepos();
    expect(repos).toHaveLength(2);
    expect(repos[0]!.full_name).toBe('acme/payments-api');

    const pulls = await api.listPulls(REPO_PAYMENTS_ID);
    expect(pulls.map((p) => p.number)).toEqual([482, 480]);

    const agents = await api.listAgents();
    expect(agents).toHaveLength(5);

    const runs = await api.listRuns(PR_482_ID);
    expect(runs).toHaveLength(2);

    const reviews = await api.listReviews(PR_482_ID);
    expect(reviews).toHaveLength(2);

    const conventions = await api.getConventions(REPO_PAYMENTS_ID);
    expect(conventions.candidates).toHaveLength(3);
  });

  it('percent-encodes path identifiers', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await api.listPulls('weird id/with slash');
    expect(fake.calls[0]!.path).toBe('/repos/weird%20id%2Fwith%20slash/pulls');
  });

  it('sends the POST body as JSON with content-type', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await api.startReview(PR_482_ID, { agentId: 'abc' });
    const call = fake.calls.find((c) => c.method === 'POST')!;
    expect(call.body).toEqual({ agentId: 'abc' });
  });

  it('maps a network failure to ApiError(unreachable) with a safe origin', async () => {
    const fake = createFakeApi(createFixtureState());
    fake.setUnreachable(true);
    const api = createApiClient({
      baseUrl: 'http://u:p@localhost:1',
      fetchImpl: fake.fetchImpl,
      timeoutMs: TIMEOUT_MS,
    });
    await expect(api.listAgents()).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.kind).toBe('unreachable');
      expect(apiErr.origin).toBe('http://localhost:1');
      expect(apiErr.origin).not.toContain('u:p');
      return true;
    });
  });

  it('maps 404 to ApiError(not_found)', async () => {
    const fake = createFakeApi(createFixtureState());
    fake.failNext('GET', '/agents', 404);
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await expect(api.listAgents()).rejects.toMatchObject({ kind: 'not_found', status: 404 });
  });

  it('maps 429 to ApiError(rate_limited)', async () => {
    const fake = createFakeApi(createFixtureState());
    fake.failNext('GET', '/agents', 429);
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await expect(api.listAgents()).rejects.toMatchObject({ kind: 'rate_limited', status: 429 });
  });

  it('maps 422 to ApiError(bad_request) with a clipped server message', async () => {
    const fake = createFakeApi(createFixtureState());
    fake.failNext('GET', '/agents', 422);
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await expect(api.listAgents()).rejects.toMatchObject({
      kind: 'bad_request',
      status: 422,
      serverMessage: 'forced failure',
    });
  });

  it('maps 5xx to ApiError(server) without leaking the response body', async () => {
    const fake = createFakeApi(createFixtureState());
    fake.failNext('GET', '/agents', 503);
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await expect(api.listAgents()).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.kind).toBe('server');
      expect(apiErr.status).toBe(503);
      expect(apiErr.message).not.toContain('forced failure');
      expect(apiErr.serverMessage).toBeUndefined();
      return true;
    });
  });

  it('maps a schema mismatch to ApiError(contract)', async () => {
    const fake = createFakeApi(createFixtureState());
    // Corrupt the fixture so it no longer matches the Agent schema.
    (fake.state.agents as unknown as { name?: unknown }[])[0]!.name = 123;
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: TIMEOUT_MS });
    await expect(api.listAgents()).rejects.toMatchObject({ kind: 'contract' });
  });
});
