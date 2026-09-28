import { randomUUID } from 'node:crypto';
import type { Agent, ReviewRecord, ReviewRunResponse, RunRequest, RunSummary } from '@devdigest/shared';
import type { FixtureState } from './fixtures.js';

/**
 * A fake DevDigest API — as a `fetchImpl`, so `createApiClient` talks to it
 * exactly the way it talks to the real server (same URL parsing, same JSON
 * body, same status-code mapping). No server, no Docker, no `undici`
 * MockAgent: it is a plain async function routed on `pathname` + method.
 */

export interface FakeCall {
  method: string;
  path: string;
  body?: unknown;
}

export interface FakeApi {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
  state: FixtureState;
  /** The next request to `method path` answers with `status` and a generic error envelope, once. */
  failNext(method: string, path: string, status: number): void;
  /** Every request throws a network-level `TypeError` (as a real "API is down" would). */
  setUnreachable(value: boolean): void;
  /** Schedules the statuses a run cycles through: each subsequent `GET /pulls/:id/runs`
   *  call advances that run to the next scripted status, then holds at the last one. */
  scheduleRunStatuses(runId: string, statuses: string[]): void;
}

export function createFakeApi(initialState: FixtureState): FakeApi {
  const state: FixtureState = structuredClone(initialState);
  const calls: FakeCall[] = [];
  const failQueue = new Map<string, number>();
  const runsScript = new Map<string, string[]>();
  let unreachable = false;

  function key(method: string, path: string): string {
    return `${method} ${path}`;
  }

  function errorBody(message: string) {
    return { error: { code: 'fake_error', message } };
  }

  async function fetchImpl(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (unreachable) throw new TypeError('fetch failed');

    const u = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path: u.pathname, ...(body !== undefined ? { body } : {}) });

    const forced = failQueue.get(key(method, u.pathname));
    if (forced !== undefined) {
      failQueue.delete(key(method, u.pathname));
      return new Response(JSON.stringify(errorBody('forced failure')), {
        status: forced,
        headers: { 'content-type': 'application/json' },
      });
    }

    const parts = u.pathname.split('/').filter(Boolean);

    // GET /repos
    if (method === 'GET' && u.pathname === '/repos') {
      return json(state.repos);
    }
    // GET /agents
    if (method === 'GET' && u.pathname === '/agents') {
      return json(state.agents satisfies Agent[]);
    }
    // GET /repos/:id/pulls
    if (method === 'GET' && parts[0] === 'repos' && parts[2] === 'pulls' && parts.length === 3) {
      const repoId = parts[1]!;
      return json(state.pulls[repoId] ?? []);
    }
    // GET /repos/:id/conventions
    if (
      method === 'GET' &&
      parts[0] === 'repos' &&
      parts[2] === 'conventions' &&
      parts.length === 3
    ) {
      const repoId = parts[1]!;
      return json(state.conventions[repoId] ?? { scan: null, candidates: [], rejected_count: 0 });
    }
    // GET /pulls/:id
    if (method === 'GET' && parts[0] === 'pulls' && parts.length === 2) {
      const prId = parts[1]!;
      const detail = state.pullDetails[prId];
      if (!detail) {
        return new Response(JSON.stringify(errorBody(`fake-api: no pull ${prId}`)), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return json(detail);
    }
    // GET /pulls/:id/blast-radius
    if (method === 'GET' && parts[0] === 'pulls' && parts[2] === 'blast-radius' && parts.length === 3) {
      const prId = parts[1]!;
      const blast = state.blast[prId];
      if (!blast) {
        return new Response(JSON.stringify(errorBody(`fake-api: no blast radius for ${prId}`)), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return json(blast);
    }
    // POST /pulls/:id/review
    if (method === 'POST' && parts[0] === 'pulls' && parts[2] === 'review' && parts.length === 3) {
      const prId = parts[1]!;
      return json(startReview(state, prId, body as RunRequest));
    }
    // GET /pulls/:id/runs
    if (method === 'GET' && parts[0] === 'pulls' && parts[2] === 'runs' && parts.length === 3) {
      const prId = parts[1]!;
      applyRunsScript(state, prId, runsScript);
      return json(state.runs[prId] ?? []);
    }
    // GET /pulls/:id/reviews
    if (method === 'GET' && parts[0] === 'pulls' && parts[2] === 'reviews' && parts.length === 3) {
      const prId = parts[1]!;
      return json(state.reviews[prId] ?? []);
    }

    return new Response(JSON.stringify(errorBody(`fake-api: no route for ${method} ${u.pathname}`)), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  function json(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return {
    fetchImpl,
    calls,
    state,
    failNext(method, path, status) {
      failQueue.set(key(method.toUpperCase(), path), status);
    },
    setUnreachable(value) {
      unreachable = value;
    },
    scheduleRunStatuses(runId, statuses) {
      runsScript.set(runId, [...statuses]);
    },
  };
}

function startReview(state: FixtureState, prId: string, body: RunRequest): ReviewRunResponse {
  const targets = body.all
    ? state.agents.filter((a) => a.enabled)
    : body.agentId
      ? state.agents.filter((a) => a.id === body.agentId)
      : [];

  const runs = targets.map((agent) => {
    const run: RunSummary = {
      run_id: randomUUID(),
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
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
    };
    const existing = state.runs[prId] ?? [];
    state.runs[prId] = [run, ...existing];
    return { run_id: run.run_id, agent_id: agent.id, agent_name: agent.name };
  });

  return { pr_id: prId, runs, reviews: [] };
}

/**
 * A run that scripts its way to 'done' needs a matching `ReviewRecord` for
 * `get_findings`/`run_agent_on_pr` to have anything to read — the real API
 * always persists the review before it marks the run 'done' (run-executor.ts).
 * Synthesizes a minimal one, once, the first time a run reaches 'done'.
 */
function synthesizeReview(state: FixtureState, prId: string, run: RunSummary): void {
  const reviews = state.reviews[prId] ?? (state.reviews[prId] = []);
  if (reviews.some((r) => r.run_id === run.run_id)) return;
  const review: ReviewRecord = {
    id: randomUUID(),
    pr_id: prId,
    agent_id: run.agent_id,
    run_id: run.run_id,
    agent_name: run.agent_name,
    kind: 'review',
    verdict: 'comment',
    summary: 'Fixture-synthesized review (fake-api auto-completion).',
    score: 90,
    model: run.model,
    grounding: 'ok',
    created_at: new Date().toISOString(),
    findings: [],
  };
  reviews.unshift(review);
}

function applyRunsScript(
  state: FixtureState,
  prId: string,
  runsScript: Map<string, string[]>,
): void {
  const runs = state.runs[prId] ?? [];
  for (const run of runs) {
    const script = runsScript.get(run.run_id);
    if (!script || script.length === 0) continue;
    const next = script.shift()!;
    run.status = next;
    if (next === 'done') synthesizeReview(state, prId, run);
  }
}
