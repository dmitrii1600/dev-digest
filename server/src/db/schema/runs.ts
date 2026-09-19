import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** USD spent on this run (provider-reported `usage.cost`, else the price
        book). Null when unknown — the UI shows "—", never "$0.00". */
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
  },
  (t) => ({
    // Runs for one PR, newest first (run.repo.ts listRuns / findRunning) and
    // the PR-list rollup's `inArray(prId, …)`. Postgres scans a btree backwards,
    // so (pr_id, ran_at) serves ORDER BY ran_at DESC without a DESC index.
    prRanIdx: index('agent_runs_pr_ran_idx').on(t.prId, t.ranAt),
    // FK targets of ON DELETE cascade/set-null. Postgres does not index a
    // foreign key automatically, so without these a workspace or agent delete
    // seq-scans this table once per parent row.
    wsIdx: index('agent_runs_ws_idx').on(t.workspaceId),
    agentIdx: index('agent_runs_agent_idx').on(t.agentId),
    // Boot-time sweep for orphaned runs (run.repo.ts: where status='running').
    statusIdx: index('agent_runs_status_idx').on(t.status),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable(
  'multi_agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Both columns cascade from their parent; neither is indexed by the FK itself.
  (t) => ({
    wsIdx: index('multi_agent_runs_ws_idx').on(t.workspaceId),
    prIdx: index('multi_agent_runs_pr_idx').on(t.prId),
  }),
);
