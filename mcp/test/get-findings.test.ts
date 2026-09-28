import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { AGENT_GENERAL_ID, createFixtureState, PR_482_ID, RUN_GENERAL_ID } from './helpers/fixtures.js';

function textOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return JSON.parse((content[0] as { text: string }).text) as Record<string, unknown>;
}

function setup() {
  const fake = createFakeApi(createFixtureState());
  const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
  return { fake, api };
}

describe('get_findings', () => {
  it('returns one entry per agent (latest review), sorted by severity', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482 },
    });
    const payload = textOf(result);
    expect(payload.pr).toBe('acme/payments-api#482');
    const reviews = payload.reviews as Record<string, unknown>[];
    expect(reviews).toHaveLength(2);
    const general = reviews.find((r) => r.agent_name === 'General Reviewer')!;
    const findings = general.findings as Record<string, unknown>[];
    expect(findings.map((f) => f.severity)).toEqual(['CRITICAL', 'WARNING', 'SUGGESTION']);
    expect(general.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 1 });
  });

  it('filters by agent (substring name)', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, agent: 'security' },
    });
    const payload = textOf(result);
    const reviews = payload.reviews as Record<string, unknown>[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.agent_name).toBe('Security Reviewer');
  });

  it('filters by run_id to a done review', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, run_id: RUN_GENERAL_ID },
    });
    const payload = textOf(result);
    const reviews = payload.reviews as Record<string, unknown>[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.run_id).toBe(RUN_GENERAL_ID);
  });

  it('run_id on a running run (no review yet) returns a running hint, not an error', async () => {
    const { fake, api } = setup();
    const runningId = 'dddddddd-0000-4000-8000-000000000009';
    fake.state.runs[PR_482_ID]!.push({
      run_id: runningId,
      agent_id: AGENT_GENERAL_ID,
      agent_name: 'General Reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'running',
      error: null,
      duration_ms: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      findings_count: null,
      findings_counts: null,
      grounding: null,
      ran_at: new Date().toISOString(),
      score: null,
      blockers: null,
    });
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, run_id: runningId },
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = textOf(result);
    expect(payload.status).toBe('running');
    expect(payload.run_id).toBe(runningId);
  });

  it('run_id on a failed run returns a normal result with the clipped error', async () => {
    const { fake, api } = setup();
    const failedId = 'eeeeeeee-0000-4000-8000-000000000009';
    fake.state.runs[PR_482_ID]!.push({
      run_id: failedId,
      agent_id: AGENT_GENERAL_ID,
      agent_name: 'General Reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'failed',
      error: 'boom',
      duration_ms: 100,
      tokens_in: 10,
      tokens_out: 0,
      cost_usd: null,
      findings_count: null,
      findings_counts: null,
      grounding: null,
      ran_at: new Date().toISOString(),
      score: null,
      blockers: null,
    });
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, run_id: failedId },
    });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const payload = textOf(result);
    expect(payload.status).toBe('failed');
    expect(payload.error).toBe('boom');
  });

  it('an unknown run_id is a ToolError', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, run_id: 'ffffffff-0000-4000-8000-00000000000a' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain('not found on acme/payments-api#482');
  });

  it('gives a "no review yet" hint for a PR with no reviews', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 480 },
    });
    const payload = textOf(result);
    expect(payload.reviews).toEqual([]);
    expect(payload.hint).toContain('No review yet for acme/payments-api#480');
  });

  it('detailed format adds rationale/model/summary and keeps run_status per review', async () => {
    const { api } = setup();
    const { client } = await connect({ api });
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 482, response_format: 'detailed' },
    });
    const payload = textOf(result);
    const reviews = payload.reviews as Record<string, unknown>[];
    const general = reviews.find((r) => r.agent_name === 'General Reviewer')!;
    expect(general.summary).toBeDefined();
    expect(general.model).toBe('gpt-4.1');
    expect(general.run_status).toBe('done');
    const findings = general.findings as Record<string, unknown>[];
    expect(findings[0]!.rationale).toBeDefined();
    expect(findings[0]!.id).toBeDefined();
  });
});
