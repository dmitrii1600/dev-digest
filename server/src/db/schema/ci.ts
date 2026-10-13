import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', {
      enum: ['gha', 'circle', 'jenkins', 'cli'],
    }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    agentVersion: integer('agent_version').notNull().default(1),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }),
    exportMeta: jsonb('export_meta'),
  },
  (t) => [uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo)],
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(
      () => ciInstallations.id,
      {
        onDelete: 'set null',
      },
    ),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    githubRunId: bigint('github_run_id', { mode: 'number' }),
    headSha: text('head_sha'),
    prTitle: text('pr_title'),
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('ci_runs_github_run_uq').on(t.githubRunId),
    index('ci_runs_agent_run_idx').on(t.agentRunId),
    index('ci_runs_installation_idx').on(t.ciInstallationId),
  ],
);
