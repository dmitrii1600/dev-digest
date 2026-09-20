import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  integer,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One row per conventions extraction run (L02 second half). The page reads
 * "Run Scan" vs "ReScan" and the "last scan … · N sample files" line from here,
 * so a scan that grounded zero candidates still counts as a scan.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    sampledFiles: jsonb('sampled_files').$type<string[]>().notNull().default([]),
    candidatesTotal: integer('candidates_total').notNull().default(0),
    candidatesGrounded: integer('candidates_grounded').notNull().default(0),
    droppedUngrounded: integer('dropped_ungrounded').notNull().default(0),
    droppedDuplicate: integer('dropped_duplicate').notNull().default(0),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: doublePrecision('cost_usd'), // null = unknown, never 0
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.repoId) }),
);

/**
 * Convention candidates. `status` is a three-way decision (pending / accepted /
 * rejected) — a rejection is a state that survives a rescan, not the absence of
 * acceptance. `evidence_line` is the line the snippet was FOUND on during
 * grounding, not the one the model claimed. `skill_id` marks the skill that
 * absorbed an accepted candidate.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'set null' }),
    category: text('category', {
      enum: [
        'naming',
        'structure',
        'imports',
        'typing',
        'async',
        'error_handling',
        'testing',
        'api',
        'style',
        'other',
      ],
    })
      .notNull()
      .default('other'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceLine: integer('evidence_line'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    edited: boolean('edited').notNull().default(false),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoIdx: index('conventions_repo_idx').on(t.repoId),
    wsIdx: index('conventions_ws_idx').on(t.workspaceId),
  }),
);
