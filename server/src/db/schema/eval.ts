import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { findings } from './reviews';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    // How the case came to be: frozen from a decided finding, or authored by hand.
    source: text('source', { enum: ['finding', 'manual'] })
      .notNull()
      .default('finding'),
    // Link to the source finding; the case outlives it (set null), its frozen inputs stay.
    sourceFindingId: uuid('source_finding_id').references(() => findings.id, {
      onDelete: 'set null',
    }),
    expectation: text('expectation', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    targetFile: text('target_file').notNull(),
    targetStartLine: integer('target_start_line').notNull(),
    targetEndLine: integer('target_end_line').notNull(),
    // sha256 of the frozen inputs + expectation + target; tells two runs an edited case apart.
    fingerprint: text('fingerprint').notNull(),
    createdAt: now(),
  },
  (t) => ({
    ownerIdx: index('eval_cases_owner_idx').on(t.ownerKind, t.ownerId),
    // Cascade target; Postgres does not index a foreign key on its own.
    wsIdx: index('eval_cases_ws_idx').on(t.workspaceId),
    // One case per source finding per owner. NULLs do not collide, so manual cases are free.
    ownerSourceUq: uniqueIndex('eval_cases_owner_source_uq').on(t.ownerId, t.sourceFindingId),
    // Set-null target for the source finding FK.
    sourceFindingIdx: index('eval_cases_source_finding_idx').on(t.sourceFindingId),
  }),
);

/** One row per eval RUN (header); the per-case results live in `eval_run_cases`. */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['suite', 'single'] })
      .notNull()
      .default('suite'),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    // The agent that ran (for a skill-owned run, its host agent). Deleting it removes its runs.
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status', { enum: ['running', 'completed', 'partial', 'failed'] }).notNull(),
    error: text('error'),
    // [{ skill_id, name, version }] in prompt order — the skill snapshot of this run.
    skills: jsonb('skills').notNull().default([]),
    // [{ case_id, fingerprint }] — the case set this run covered.
    caseRefs: jsonb('case_refs').notNull().default([]),
    // The case a `single` run covers; null for suite runs and once the case is deleted.
    singleCaseId: uuid('single_case_id').references(() => evalCases.id, { onDelete: 'set null' }),
    casesTotal: integer('cases_total').notNull().default(0),
    casesPassed: integer('cases_passed').notNull().default(0),
    casesErrored: integer('cases_errored').notNull().default(0),
    // `ran_at` is the start time.
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    agentRanIdx: index('eval_runs_agent_ran_idx').on(t.agentId, t.ranAt),
    wsIdx: index('eval_runs_ws_idx').on(t.workspaceId),
    // At most one running suite per owner — race-safe backing for the 409 (EC-6). Keyed on
    // `owner_id` (= agent_id for an agent-owned run) so a skill suite hosted on agent H does
    // not collide with H's own suite.
    oneRunningSuiteUq: uniqueIndex('eval_runs_one_running_suite_uq')
      .on(t.ownerId)
      .where(sql`${t.status} = 'running' and ${t.kind} = 'suite'`),
    // At most one running single-case run per case — race-safe backing for the 409.
    oneRunningSingleUq: uniqueIndex('eval_runs_one_running_single_uq')
      .on(t.singleCaseId)
      .where(sql`${t.status} = 'running' and ${t.kind} = 'single'`),
    // Set-null target for the single_case_id FK.
    singleCaseIdx: index('eval_runs_single_case_idx').on(t.singleCaseId),
  }),
);

/** Per-case outcome of one run. `case_id` goes null when the case is deleted; the row stays. */
export const evalRunCases = pgTable(
  'eval_run_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evalRuns.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id').references(() => evalCases.id, { onDelete: 'set null' }),
    caseName: text('case_name').notNull(),
    expectation: text('expectation', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    targetFile: text('target_file').notNull(),
    targetStartLine: integer('target_start_line').notNull(),
    targetEndLine: integer('target_end_line').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status', { enum: ['passed', 'failed', 'errored'] }).notNull(),
    error: text('error'),
    produced: integer('produced').notNull().default(0),
    kept: integer('kept').notNull().default(0),
    matched: integer('matched').notNull().default(0),
    // Kept findings that matched a must_not_flag target — feeds precision.
    nmfHits: integer('nmf_hits').notNull().default(0),
    findings: jsonb('findings').notNull().default([]),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    runIdx: index('eval_run_cases_run_idx').on(t.runId),
    caseIdx: index('eval_run_cases_case_idx').on(t.caseId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
