import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect, createFakeClock, defaultTestConfig } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import {
  AGENT_GENERAL_ID,
  AGENT_PERFORMANCE_ID,
  AGENT_SECURITY_ID,
  createFixtureState,
  PR_480_ID,
} from './helpers/fixtures.js';

function textOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return JSON.parse((content[0] as { text: string }).text) as Record<string, unknown>;
}

function setup() {
  const fake = createFakeApi(createFixtureState());
  // Indirected so a test can reassign `fake.fetchImpl` (e.g. autoCompleteRuns)
  // AFTER the api client is created and still have it take effect.
  const api = createApiClient({
    baseUrl: 'http://localhost:3001',
    fetchImpl: ((input, init) => fake.fetchImpl(input, init)) as typeof fetch,
    timeoutMs: 5_000,
  });
  return { fake, api };
}

/** Marks every newly started run in `fake.state.runs[prId]` as done, one poll after it appears. */
function autoCompleteRuns(fake: ReturnType<typeof createFakeApi>, prId: string) {
  const seen = new Set<string>();
  const original = fake.fetchImpl;
  fake.fetchImpl = (async (input, init) => {
    const res = await original(input, init);
    for (const run of fake.state.runs[prId] ?? []) {
      if (!seen.has(run.run_id)) {
        seen.add(run.run_id);
        fake.scheduleRunStatuses(run.run_id, ['done']);
      }
    }
    return res;
  }) as typeof fake.fetchImpl;
}

describe('run_agent_on_pr', () => {
  it('starts a single agent (POST body {agentId}) and returns done', async () => {
    const { fake, api } = setup();
    autoCompleteRuns(fake, PR_480_ID);
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'General Reviewer' },
    });

    const postCall = fake.calls.find((c) => c.method === 'POST')!;
    expect(postCall.body).toEqual({ agentId: AGENT_GENERAL_ID });
    const payload = textOf(result);
    expect(payload.status).toBe('done');
  });

  it('starts "all" enabled agents (POST body {all:true})', async () => {
    const { fake, api } = setup();
    autoCompleteRuns(fake, PR_480_ID);
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'all' },
    });

    const postCall = fake.calls.find((c) => c.method === 'POST')!;
    expect(postCall.body).toEqual({ all: true });
  });

  it('sends progress notifications only when the client passes onprogress', async () => {
    const { fake, api } = setup();
    autoCompleteRuns(fake, PR_480_ID);
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    const progress: number[] = [];
    await client.callTool(
      { name: 'run_agent_on_pr', arguments: { repo: 'acme/payments-api', pr: 480, agent: 'General Reviewer' } },
      undefined,
      { onprogress: (p) => progress.push(p.progress) },
    );
    expect(progress.length).toBeGreaterThan(0);

    // Without onprogress, no notification handler is invoked (nothing to assert
    // beyond "it does not throw" — there is no listener to receive one).
    const result2 = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'Security Reviewer' },
    });
    expect((textOf(result2) as { status: string }).status).toBe('done');
  });

  it('returns status "running" plus run ids when the wait limit passes, without fetching reviews', async () => {
    const { fake, api } = setup();
    // Never schedule a terminal status — the run stays "running" forever.
    const clock = createFakeClock();
    const { client } = await connect({
      api,
      clock,
      config: defaultTestConfig({ waitMs: 5_000, pollMs: 1_000 }),
    });

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'General Reviewer' },
    });
    const payload = textOf(result);
    expect(payload.status).toBe('running');
    expect(payload.run_ids).toBeInstanceOf(Array);
    expect(fake.calls.some((c) => c.path.endsWith('/reviews'))).toBe(false);
  });

  it('reports "partial" when some agents succeed and some fail', async () => {
    const { fake, api } = setup();
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    // Intercept the POST to script BOTH resulting runs deterministically.
    const original = fake.fetchImpl;
    fake.fetchImpl = (async (input, init) => {
      const res = await original(input, init);
      const runs = fake.state.runs[PR_480_ID] ?? [];
      for (const run of runs) {
        if (run.agent_id === AGENT_SECURITY_ID) fake.scheduleRunStatuses(run.run_id, ['done']);
        else fake.scheduleRunStatuses(run.run_id, ['failed']);
      }
      return res;
    }) as typeof fake.fetchImpl;

    // Force just two agents to run "all" against by disabling the rest.
    fake.state.agents = fake.state.agents.filter(
      (a) => a.id === AGENT_SECURITY_ID || a.id === AGENT_PERFORMANCE_ID,
    );

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'all' },
    });
    const payload = textOf(result);
    expect(payload.status).toBe('partial');
    const reviews = payload.reviews as Record<string, unknown>[];
    expect(reviews.some((r) => r.run_status === 'failed')).toBe(true);
  });

  it('reports "failed" (isError) when every agent fails', async () => {
    const { fake, api } = setup();
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    const original = fake.fetchImpl;
    fake.fetchImpl = (async (input, init) => {
      const res = await original(input, init);
      for (const run of fake.state.runs[PR_480_ID] ?? []) {
        fake.scheduleRunStatuses(run.run_id, ['failed']);
      }
      return res;
    }) as typeof fake.fetchImpl;

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'General Reviewer' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    const payload = JSON.parse(text) as { pr: string; status: string; reviews: { error: unknown }[] };
    expect(payload.pr).toBe('acme/payments-api#480');
    expect(payload.status).toBe('failed');
    // run.error is a data field, never spliced into the MCP-authored sentence
    expect(payload.reviews.length).toBeGreaterThan(0);
    expect(text.startsWith('{')).toBe(true);
  });

  it('attaches to an in-flight run instead of starting a new one (zero POSTs)', async () => {
    const { fake, api } = setup();
    fake.state.runs[PR_480_ID] = [
      {
        run_id: 'in-flight-0000-4000-8000-000000000001',
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
      },
    ];
    // The tool's OWN "is anything already running" check is itself a
    // `GET .../runs` call and would otherwise consume a same-poll 'done'
    // transition before the attach decision is even made — schedule one
    // harmless 'running' first so that pre-check still sees 'running'.
    fake.scheduleRunStatuses('in-flight-0000-4000-8000-000000000001', ['running', 'done']);
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'General Reviewer' },
    });

    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
    const payload = textOf(result);
    expect(payload.attached).toBe(true);
  });

  it('errors when there are no enabled agents to run', async () => {
    const { fake, api } = setup();
    fake.state.agents = fake.state.agents.map((a) => ({ ...a, enabled: false }));
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'all' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('surfaces the API rate-limit message on a 429', async () => {
    const { fake, api } = setup();
    fake.failNext('POST', `/pulls/${PR_480_ID}/review`, 429);
    const clock = createFakeClock();
    const { client } = await connect({ api, clock, config: defaultTestConfig({ pollMs: 10 }) });

    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 480, agent: 'General Reviewer' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).toContain('rate limit');
  });
});
