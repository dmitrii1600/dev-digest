import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project Context
// Ordered (owner, repo, path) attachments of clone Markdown files. Binding
// tables like `agent_skills`: no workspace_id — tenancy is checked in the
// service against the owner and the repo.

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull(),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    // agent_id leads the PK; repo_id cascades from `repos` and feeds used-by.
    repoIdx: index('agent_context_docs_repo_idx').on(t.repoId),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull(),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    repoIdx: index('skill_context_docs_repo_idx').on(t.repoId),
  }),
);
