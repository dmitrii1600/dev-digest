import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { createResolver } from '../src/resolve.js';
import { ToolError } from '../src/errors.js';
import { createFakeApi } from './helpers/fake-api.js';
import {
  AGENT_APICONTRACT_ID,
  AGENT_TESTQUALITY_ID,
  createFixtureState,
  PR_480_ID,
  PR_482_ID,
  REPO_PAYMENTS_ID,
  REPO_WEB_ID,
} from './helpers/fixtures.js';

function setup() {
  const fake = createFakeApi(createFixtureState());
  const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
  const resolver = createResolver(api);
  return { fake, api, resolver };
}

describe('resolveRepo', () => {
  it('resolves by owner/name', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('acme/payments-api');
    expect(repo).toEqual({ id: REPO_PAYMENTS_ID, full_name: 'acme/payments-api' });
  });

  it('resolves by owner/name case-insensitively', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('ACME/Payments-API');
    expect(repo.id).toBe(REPO_PAYMENTS_ID);
  });

  it('resolves by uuid', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo(REPO_PAYMENTS_ID);
    expect(repo.full_name).toBe('acme/payments-api');
  });

  it('resolves by bare unique name', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('web');
    expect(repo.id).toBe(REPO_WEB_ID);
  });

  it('rejects a bare name that matches more than one repo', async () => {
    const { fake, resolver } = setup();
    fake.state.repos.push({
      id: '00000000-0000-4000-8000-000000000099',
      workspace_id: 'ws',
      owner: 'beta',
      name: 'web',
      full_name: 'beta/web',
      default_branch: 'main',
      clone_path: null,
      last_polled_at: null,
      created_by: null,
    });
    await expect(resolver.resolveRepo('web')).rejects.toThrow(ToolError);
    await expect(resolver.resolveRepo('web')).rejects.toThrow(/ambiguous: acme\/web, beta\/web/);
  });

  it('lists known repos (capped) when not found', async () => {
    const { resolver } = setup();
    await expect(resolver.resolveRepo('nope/nope')).rejects.toThrow(
      "Repo 'nope/nope' not found. Known repos: acme/payments-api, acme/web. Add a repo in the DevDigest studio first.",
    );
  });

  it("says so when there are no repos at all", async () => {
    const { fake, resolver } = setup();
    fake.state.repos.length = 0;
    await expect(resolver.resolveRepo('anything')).rejects.toThrow(
      'No repos imported yet — add one in the DevDigest studio.',
    );
  });

  it('memoises listRepos across two resolutions in the same resolver', async () => {
    const { fake, resolver } = setup();
    await resolver.resolveRepo('acme/payments-api');
    await resolver.resolveRepo('acme/web');
    expect(fake.calls.filter((c) => c.path === '/repos')).toHaveLength(1);
  });
});

describe('resolvePr', () => {
  it('resolves by number', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('acme/payments-api');
    const pr = await resolver.resolvePr(repo, 482);
    expect(pr).toEqual({ id: PR_482_ID, number: 482, label: 'acme/payments-api#482' });
  });

  it('resolves by numeric string', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('acme/payments-api');
    const pr = await resolver.resolvePr(repo, '482');
    expect(pr.id).toBe(PR_482_ID);
  });

  it('resolves by "#482"', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('acme/payments-api');
    const pr = await resolver.resolvePr(repo, '#482');
    expect(pr.id).toBe(PR_482_ID);
  });

  it('resolves by uuid', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('acme/payments-api');
    const pr = await resolver.resolvePr(repo, PR_480_ID);
    expect(pr.number).toBe(480);
  });

  it('reports not found with known PR numbers', async () => {
    const { resolver } = setup();
    const repo = await resolver.resolveRepo('acme/payments-api');
    await expect(resolver.resolvePr(repo, 999)).rejects.toThrow(
      'PR #999 not found in acme/payments-api. Known PRs: #482, #480. Import PRs in the DevDigest studio.',
    );
  });

  it('rejects a PR with no DevDigest id yet', async () => {
    const { fake, resolver } = setup();
    fake.state.pulls[REPO_PAYMENTS_ID]!.push({
      id: null,
      number: 999,
      title: 'no id yet',
      author: 'x',
      branch: 'x',
      base: 'main',
      head_sha: 'x',
      additions: 0,
      deletions: 0,
      files_count: 0,
      status: 'open',
    });
    const repo = await resolver.resolveRepo('acme/payments-api');
    await expect(resolver.resolvePr(repo, 999)).rejects.toThrow(
      'PR #999 has no DevDigest id yet — open the repo in the studio to import it, then retry.',
    );
  });
});

describe('resolveAgent', () => {
  it('resolves "all" case-insensitively without listing agents', async () => {
    const { fake, resolver } = setup();
    const result = await resolver.resolveAgent('ALL', { enabledOnly: true });
    expect(result).toEqual({ kind: 'all' });
    expect(fake.calls.filter((c) => c.path === '/agents')).toHaveLength(0);
  });

  it('resolves an exact name', async () => {
    const { resolver } = setup();
    const result = await resolver.resolveAgent('Security Reviewer', { enabledOnly: true });
    expect(result).toEqual({ kind: 'one', id: expect.any(String), name: 'Security Reviewer' });
  });

  it('resolves a unique case-insensitive substring', async () => {
    const { resolver } = setup();
    const result = await resolver.resolveAgent('security', { enabledOnly: true });
    expect(result).toMatchObject({ kind: 'one', name: 'Security Reviewer' });
  });

  it('resolves by uuid', async () => {
    const { resolver } = setup();
    const result = await resolver.resolveAgent(AGENT_APICONTRACT_ID, { enabledOnly: true });
    expect(result).toMatchObject({ kind: 'one', name: 'API Contract Reviewer' });
  });

  it('rejects an ambiguous substring', async () => {
    const { resolver } = setup();
    // "reviewer" matches all five seeded agent names.
    await expect(resolver.resolveAgent('reviewer', { enabledOnly: true })).rejects.toThrow(
      /matches several agents/,
    );
  });

  it('rejects an unknown agent', async () => {
    const { resolver } = setup();
    await expect(resolver.resolveAgent('nonexistent', { enabledOnly: true })).rejects.toThrow(
      "Agent 'nonexistent' not found — call list_agents for valid names.",
    );
  });

  it('rejects a disabled agent when enabledOnly', async () => {
    const { resolver } = setup();
    await expect(resolver.resolveAgent(AGENT_TESTQUALITY_ID, { enabledOnly: true })).rejects.toThrow(
      "Agent 'Test Quality Reviewer' is disabled — enable it in the DevDigest studio or pick one from list_agents.",
    );
  });

  it('allows a disabled agent when enabledOnly is false', async () => {
    const { resolver } = setup();
    const result = await resolver.resolveAgent(AGENT_TESTQUALITY_ID, { enabledOnly: false });
    expect(result).toMatchObject({ kind: 'one', name: 'Test Quality Reviewer' });
  });

  it('memoises listAgents across two resolutions', async () => {
    const { fake, resolver } = setup();
    await resolver.resolveAgent('Security Reviewer', { enabledOnly: true });
    await resolver.resolveAgent('General Reviewer', { enabledOnly: true });
    expect(fake.calls.filter((c) => c.path === '/agents')).toHaveLength(1);
  });
});
