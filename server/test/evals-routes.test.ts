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

type Req = { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: Record<string, unknown> };

const rejected: [string, Req][] = [
  ['create-case: id is not a uuid', { method: 'POST', url: '/findings/not-a-uuid/eval-case', payload: {} }],
  ['create-case: extra body key', { method: 'POST', url: `/findings/${UUID}/eval-case`, payload: { extra: 1 } }],
  ['list-cases: id is not a uuid', { method: 'GET', url: '/agents/not-a-uuid/eval-cases' }],
  ['delete-case: id is not a uuid', { method: 'DELETE', url: '/eval-cases/not-a-uuid' }],
  ['start-run: id is not a uuid', { method: 'POST', url: '/agents/not-a-uuid/eval-runs', payload: {} }],
  ['start-run: a run start carries no body fields', { method: 'POST', url: `/agents/${UUID}/eval-runs`, payload: { model: 'x' } }],
  ['list-runs: limit above 100', { method: 'GET', url: `/agents/${UUID}/eval-runs?limit=101` }],
  ['list-runs: limit below 1', { method: 'GET', url: `/agents/${UUID}/eval-runs?limit=0` }],
  ['compare: a is not a uuid', { method: 'GET', url: `/agents/${UUID}/eval-runs/compare?a=nope&b=${UUID}` }],
  ['compare: b is missing', { method: 'GET', url: `/agents/${UUID}/eval-runs/compare?a=${UUID}` }],
  ['compare: unknown query key', { method: 'GET', url: `/agents/${UUID}/eval-runs/compare?a=${UUID}&b=${UUID}&c=1` }],
  ['get-run: id is not a uuid', { method: 'GET', url: '/eval-runs/not-a-uuid' }],
  ['agent dashboard: id is not a uuid', { method: 'GET', url: '/agents/not-a-uuid/eval-dashboard' }],
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
