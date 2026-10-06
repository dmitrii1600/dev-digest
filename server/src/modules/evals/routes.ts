import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import {
  EvalCase,
  EvalCaseCreateResult,
  EvalCaseInput,
  EvalCaseList,
  EvalCaseRunRequest,
  EvalCaseRunState,
  EvalDashboard,
  EvalRunComparison,
  EvalSkillRunRequest,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import {
  EVAL_ADAPTER_TIMEOUT_MS,
  EVAL_CASE_TIMEOUT_MS,
  EVAL_CONCURRENCY,
  RUNS_PAGE_SIZE,
} from './constants.js';
import { EvalsRepository } from './repository.js';
import { EvalsService } from './service.js';

const EmptyBody = z.object({}).strict();
const RunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(RUNS_PAGE_SIZE) });
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() }).strict();
const OkBody = z.object({ ok: z.literal(true) });

/**
 * Evals module — cases frozen from decided findings or written by hand, suite runs,
 * single-case runs, skill suites on a host agent, code-scored metrics, dashboards and a
 * two-run comparison.
 *   POST   /findings/:id/eval-case            → EvalCaseCreateResult  body `{}`; 201 created, 200 already existed
 *                                                                     404 unknown finding / no producing agent
 *                                                                     422 eval_case_rejected  details.reason:
 *                                                                         finding_undecided | case_limit | diff_unavailable |
 *                                                                         diff_too_large | target_outside_diff
 *   GET    /agents/:id/eval-cases             → EvalCaseList
 *   POST   /agents/:id/eval-cases             → EvalCase             body EvalCaseInput; 201 (manual case)
 *   GET    /skills/:id/eval-cases             → EvalCaseList
 *   POST   /skills/:id/eval-cases             → EvalCase             body EvalCaseInput; 201 (manual case)
 *                                                                     422 eval_case_rejected  details.reason (+ field):
 *                                                                         case_limit | diff_unparseable | diff_needs_git_headers |
 *                                                                         target_file_not_in_diff | target_outside_changes | name_taken
 *   PUT    /eval-cases/:id                    → EvalCase             body EvalCaseInput; edit in place, new fingerprint
 *   DELETE /eval-cases/:id                    → { ok: true }
 *   POST   /eval-cases/:id/runs               → EvalSuiteRun         body `{}` (agent case) or `{ host_agent_id }` (skill case);
 *                                                                     202, a `single` run, never in suite metrics
 *                                                                     409 eval_case_run_in_progress  details.run_id
 *                                                                     422 eval_host_invalid  details.reason:
 *                                                                         host_required | host_not_allowed | host_not_linked
 *   GET    /eval-cases/:id/runs/latest        → EvalCaseRunState     newest result (either kind) + a running single run
 *   POST   /agents/:id/eval-runs              → EvalSuiteRun         body `{}`; 202, the run is `running`
 *                                                                     409 eval_run_in_progress  details.run_id
 *                                                                     422 eval_set_empty
 *   GET    /agents/:id/eval-runs?limit=       → EvalSuiteRun[]
 *   GET    /agents/:id/eval-runs/compare?a=&b= → EvalRunComparison   422 eval_compare_invalid
 *   POST   /skills/:id/eval-runs              → EvalSuiteRun         body `{ host_agent_id }`; 202, the run is `running`
 *                                                                     409 eval_run_in_progress · 422 eval_set_empty | eval_host_invalid
 *   GET    /skills/:id/eval-runs?limit=       → EvalSuiteRun[]
 *   GET    /skills/:id/eval-dashboard         → EvalDashboard
 *   GET    /eval-runs/:id                     → EvalSuiteRunDetail   a run of any kind or owner
 *   GET    /eval/dashboard                    → EvalDashboard
 *   GET    /agents/:id/eval-dashboard         → EvalDashboard
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new EvalsService({
    repo: new EvalsRepository(container.db),
    // Lazy ports — read `container.*` per call rather than capturing at plugin
    // registration, so a test that patches the container AFTER `buildApp()`
    // (server/INSIGHTS.md:17) is honoured.
    agents: { getById: (workspaceId, id) => container.agentsRepo.getById(workspaceId, id) },
    skills: {
      blocksForAgent: (agentId) => container.skillsRepo.blocksForAgent(agentId),
      getById: async (workspaceId, id) => {
        const row = await container.skillsRepo.getById(workspaceId, id);
        return row
          ? { id: row.id, name: row.name, source: row.source, body: row.body, version: row.version }
          : undefined;
      },
      linkedAgentIds: async (skillId) => (await container.skillsRepo.agentsUsing(skillId)).map((r) => r.agentId),
    },
    git: async () => container.git,
    parseDiff: parseUnifiedDiff,
    llm: (provider) => container.llm(provider, { singleShot: { timeoutMs: EVAL_ADAPTER_TIMEOUT_MS } }),
    review: reviewPullRequest,
    log: app.log,
    caseTimeoutMs: EVAL_CASE_TIMEOUT_MS,
    adapterTimeoutMs: EVAL_ADAPTER_TIMEOUT_MS,
    concurrency: EVAL_CONCURRENCY,
  });

  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        body: EmptyBody,
        response: { 200: EvalCaseCreateResult, 201: EvalCaseCreateResult },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.createFromFinding(workspaceId, req.params.id);
      reply.code(result.created ? 201 : 200);
      return result;
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: EvalCaseList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.get(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: EvalCaseList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listSkillCases(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createManualCase(
        workspaceId,
        { kind: 'agent', id: req.params.id },
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createManualCase(
        workspaceId,
        { kind: 'skill', id: req.params.id },
        req.body,
      );
      reply.code(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/eval-cases/:id/runs',
    { schema: { params: IdParams, body: EvalCaseRunRequest, response: { 202: EvalSuiteRun } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const run = await service.startCaseRun(workspaceId, req.params.id, req.body.host_agent_id);
      reply.code(202);
      return run;
    },
  );

  app.get(
    '/eval-cases/:id/runs/latest',
    { schema: { params: IdParams, response: { 200: EvalCaseRunState } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.caseRunState(workspaceId, req.params.id);
    },
  );

  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: OkBody } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.deleteCase(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, body: EmptyBody, response: { 202: EvalSuiteRun } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const run = await service.startRun(workspaceId, req.params.id);
      reply.code(202);
      return run;
    },
  );

  app.post(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams, body: EvalSkillRunRequest, response: { 202: EvalSuiteRun } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const run = await service.startSkillRun(workspaceId, req.params.id, req.body.host_agent_id);
      reply.code(202);
      return run;
    },
  );

  app.get(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams, querystring: RunsQuery, response: { 200: z.array(EvalSuiteRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listSkillRuns(workspaceId, req.params.id, req.query.limit);
    },
  );

  app.get(
    '/skills/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.skillDashboard(workspaceId, req.params.id);
    },
  );

  // Registered before the `/eval-runs/:id` family so the static segment is never read as an id.
  app.get(
    '/agents/:id/eval-runs/compare',
    { schema: { params: IdParams, querystring: CompareQuery, response: { 200: EvalRunComparison } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, req.params.id, req.query.a, req.query.b);
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, querystring: RunsQuery, response: { 200: z.array(EvalSuiteRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, req.params.id, req.query.limit);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalSuiteRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  app.get('/eval/dashboard', { schema: { response: { 200: EvalDashboard } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.workspaceDashboard(workspaceId);
  });

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.agentDashboard(workspaceId, req.params.id);
    },
  );
}
