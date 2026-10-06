import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * Evals routes, hermetic lane: declarative validation only. Every request here
 * is rejected by the zod `params` / `querystring` / `body` schema BEFORE the
 * handler runs, so the DB (postgres-js connects lazily) is never touched and no
 * Docker is needed. It pins UI-1 (ids are uuids), UI-2 (strict bodies) and UI-3
 * (compare takes two uuids) on every new route, and proves each route is
 * registered (an unregistered path would answer 404, not 422).
 * The success paths and the 404/409/422 business rules need rows, so they live
 * in `evals.it.test.ts` (and, on a fake store, in `evals-service.test.ts` /
 * `evals-create-case.test.ts`).
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const UUID = '00000000-0000-4000-8000-000000000000';

type Req = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: Record<string, unknown> };

const DIFF = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n x\n+y';
/** A valid manual-case body; each row below breaks exactly one thing. */
const caseBody = (over: Record<string, unknown> = {}) => ({
  name: 'A case',
  input_diff: DIFF,
  input_meta: { pr_title: 'T', pr_body: 'B' },
  expectation: 'must_find',
  target: { file: 'src/a.ts', start_line: 2, end_line: 2 },
  ...over,
});

const rejected: [string, Req][] = [
  ['create-case: id is not a uuid', { method: 'POST', url: '/findings/not-a-uuid/eval-case', payload: {} }],
  ['create-case: extra body key', { method: 'POST', url: `/findings/${UUID}/eval-case`, payload: { extra: 1 } }],
  ['list-cases: id is not a uuid', { method: 'GET', url: '/agents/not-a-uuid/eval-cases' }],
  ['delete-case: id is not a uuid', { method: 'DELETE', url: '/eval-cases/not-a-uuid' }],
  ['start-run: id is not a uuid', { method: 'POST', url: '/agents/not-a-uuid/eval-runs', payload: {} }],
  ['start-run: a run start carries no body fields', { method: 'POST', url: `/agents/${UUID}/eval-runs`, payload: { model: 'x' } }],
  ['list-runs: limit above 100', { method: 'GET', url: `/agents/${UUID}/eval-runs?limit=101` }],
  ['list-runs: limit below 1', { method: 'GET', url: `/agents/${UUID}/eval-runs?limit=0` }],
  ['list-runs: since is not a datetime', { method: 'GET', url: `/agents/${UUID}/eval-runs?since=yesterday` }],
  // Near-miss: `z.string().datetime()` requires a zone by default.
  ['list-runs: since without a time zone', { method: 'GET', url: `/agents/${UUID}/eval-runs?since=2026-10-01T00:00:00` }],
  ['run-all: extra body key', { method: 'POST', url: '/eval/run-all', payload: { agent_id: UUID } }],
  ['compare: a is not a uuid', { method: 'GET', url: `/agents/${UUID}/eval-runs/compare?a=nope&b=${UUID}` }],
  ['compare: b is missing', { method: 'GET', url: `/agents/${UUID}/eval-runs/compare?a=${UUID}` }],
  ['compare: unknown query key', { method: 'GET', url: `/agents/${UUID}/eval-runs/compare?a=${UUID}&b=${UUID}&c=1` }],
  ['get-run: id is not a uuid', { method: 'GET', url: '/eval-runs/not-a-uuid' }],
  ['agent dashboard: id is not a uuid', { method: 'GET', url: '/agents/not-a-uuid/eval-dashboard' }],

  // ---- case authoring: manual create / edit ------------------------------------------------
  ['agent create-case: id is not a uuid', { method: 'POST', url: '/agents/not-a-uuid/eval-cases', payload: caseBody() }],
  ['agent create-case: extra body key', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ owner_id: UUID }) }],
  ['agent create-case: empty name', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ name: '' }) }],
  ['agent create-case: blank name', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ name: '   ' }) }],
  ['agent create-case: diff of 65 537 bytes', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ input_diff: 'a'.repeat(65_537) }) }],
  ['agent create-case: start_line 0', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ target: { file: 'src/a.ts', start_line: 0, end_line: 2 } }) }],
  ['agent create-case: start after end', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ target: { file: 'src/a.ts', start_line: 5, end_line: 4 } }) }],
  ['agent create-case: unknown expectation', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ expectation: 'maybe' }) }],
  ['agent create-case: missing input_meta', { method: 'POST', url: `/agents/${UUID}/eval-cases`, payload: caseBody({ input_meta: undefined }) }],
  ['skill create-case: id is not a uuid', { method: 'POST', url: '/skills/not-a-uuid/eval-cases', payload: caseBody() }],
  ['skill create-case: extra body key', { method: 'POST', url: `/skills/${UUID}/eval-cases`, payload: caseBody({ extra: 1 }) }],
  ['skill create-case: empty name', { method: 'POST', url: `/skills/${UUID}/eval-cases`, payload: caseBody({ name: '' }) }],
  ['skill create-case: diff of 65 537 bytes', { method: 'POST', url: `/skills/${UUID}/eval-cases`, payload: caseBody({ input_diff: 'a'.repeat(65_537) }) }],
  ['skill list-cases: id is not a uuid', { method: 'GET', url: '/skills/not-a-uuid/eval-cases' }],
  ['update-case: id is not a uuid', { method: 'PUT', url: '/eval-cases/not-a-uuid', payload: caseBody() }],
  ['update-case: extra body key', { method: 'PUT', url: `/eval-cases/${UUID}`, payload: caseBody({ source: 'finding' }) }],
  ['update-case: empty name', { method: 'PUT', url: `/eval-cases/${UUID}`, payload: caseBody({ name: '' }) }],
  ['update-case: start_line 0', { method: 'PUT', url: `/eval-cases/${UUID}`, payload: caseBody({ target: { file: 'src/a.ts', start_line: 0, end_line: 1 } }) }],
  ['update-case: start after end', { method: 'PUT', url: `/eval-cases/${UUID}`, payload: caseBody({ target: { file: 'src/a.ts', start_line: 3, end_line: 2 } }) }],

  // ---- single-case runs --------------------------------------------------------------------
  ['case-run: id is not a uuid', { method: 'POST', url: '/eval-cases/not-a-uuid/runs', payload: {} }],
  ['case-run: extra body key', { method: 'POST', url: `/eval-cases/${UUID}/runs`, payload: { model: 'x' } }],
  ['case-run: host_agent_id is not a uuid', { method: 'POST', url: `/eval-cases/${UUID}/runs`, payload: { host_agent_id: 'nope' } }],
  ['case-run state: id is not a uuid', { method: 'GET', url: '/eval-cases/not-a-uuid/runs/latest' }],

  // ---- skill runs --------------------------------------------------------------------------
  ['skill start-run: id is not a uuid', { method: 'POST', url: '/skills/not-a-uuid/eval-runs', payload: { host_agent_id: UUID } }],
  ['skill start-run: no host_agent_id', { method: 'POST', url: `/skills/${UUID}/eval-runs`, payload: {} }],
  ['skill start-run: host_agent_id is not a uuid', { method: 'POST', url: `/skills/${UUID}/eval-runs`, payload: { host_agent_id: 'nope' } }],
  ['skill start-run: extra body key', { method: 'POST', url: `/skills/${UUID}/eval-runs`, payload: { host_agent_id: UUID, model: 'x' } }],
  ['skill list-runs: id is not a uuid', { method: 'GET', url: '/skills/not-a-uuid/eval-runs' }],
  ['skill list-runs: limit above 100', { method: 'GET', url: `/skills/${UUID}/eval-runs?limit=101` }],
  ['skill dashboard: id is not a uuid', { method: 'GET', url: '/skills/not-a-uuid/eval-dashboard' }],
];

describe('evals routes (no DB): validation rejects before any handler runs', () => {
  it.each(rejected)('%s → 422 validation_error', async (_name, req) => {
    const app = await buildApp({ config });
    try {
      const res = await app.inject(req);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    } finally {
      await app.close();
    }
  });
});
