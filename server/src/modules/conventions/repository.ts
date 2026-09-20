import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import type { GroundedCandidate } from './helpers.js';

import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
export type { ConventionRow, ConventionScanRow };

/** What the service needs to know about a repo — read here, not from the repos module. */
export interface RepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  provider: string;
  model: string;
}

export interface FinishScan {
  status: 'done' | 'failed';
  sampledFiles?: string[];
  candidatesTotal?: number;
  candidatesGrounded?: number;
  droppedUngrounded?: number;
  droppedDuplicate?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number | null;
  error?: string | null;
}

export interface UpdateCandidate {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
}

/**
 * Conventions data-access: `conventions`, `convention_scans`, and a read of
 * `repos` basics. Workspace-scoped throughout. The repo owns the "replace the
 * pending set" transaction because both tables are its own.
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  // ---- scans ----

  async latestScan(repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repoId))
      .orderBy(desc(t.conventionScans.startedAt))
      .limit(1);
    return row;
  }

  /** A `running` scan is a lock; one older than `staleBefore` is a crash, so it is failed first. */
  async sweepStaleRunning(repoId: string, staleBefore: Date): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error: 'stale — never finished', finishedAt: new Date() })
      .where(
        and(
          eq(t.conventionScans.repoId, repoId),
          eq(t.conventionScans.status, 'running'),
          lt(t.conventionScans.startedAt, staleBefore),
        ),
      );
  }

  async runningScan(repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(and(eq(t.conventionScans.repoId, repoId), eq(t.conventionScans.status, 'running')))
      .limit(1);
    return row;
  }

  async insertScan(values: InsertScan): Promise<ConventionScanRow> {
    const [row] = await this.db
      .insert(t.conventionScans)
      .values({ ...values, status: 'running' })
      .returning();
    return row!;
  }

  async finishScan(scanId: string, patch: FinishScan): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(t.conventionScans.id, scanId));
  }

  // ---- candidates ----

  /** Non-rejected candidates for the page: confidence desc, then oldest first. */
  async listVisible(repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), ne(t.conventions.status, 'rejected')))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.createdAt));
  }

  async countByStatus(repoId: string, status: ConventionStatus): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), eq(t.conventions.status, status)));
    return row?.n ?? 0;
  }

  /** Rules of every decided (accepted / rejected) candidate — the rescan dedupe set. */
  async decidedRules(repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ rule: t.conventions.rule })
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), ne(t.conventions.status, 'pending')));
    return rows.map((r) => r.rule);
  }

  /**
   * One transaction: delete the previous `pending` set, insert this scan's
   * survivors. Accepted and rejected rows are untouched.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    scanId: string,
    kept: GroundedCandidate[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(and(eq(t.conventions.repoId, repoId), eq(t.conventions.status, 'pending')));
      if (kept.length === 0) return [];
      return tx
        .insert(t.conventions)
        .values(
          kept.map((c) => ({
            workspaceId,
            repoId,
            scanId,
            category: c.category,
            rule: c.rule,
            evidencePath: c.evidencePath,
            evidenceLine: c.evidenceLine,
            evidenceSnippet: c.evidenceSnippet,
            confidence: c.confidence,
            status: 'pending' as const,
          })),
        )
        .returning();
    });
  }

  async getCandidate(
    workspaceId: string,
    repoId: string,
    id: string,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.id, id),
        ),
      );
    return row;
  }

  async updateCandidate(id: string, patch: UpdateCandidate): Promise<ConventionRow | undefined> {
    const edited = patch.rule !== undefined || patch.category !== undefined;
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(edited ? { edited: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(t.conventions.id, id))
      .returning();
    return row;
  }

  /** Accepted candidates not yet absorbed by a skill — optionally narrowed to `ids`. */
  async acceptedUnabsorbed(repoId: string, ids?: string[]): Promise<ConventionRow[]> {
    const where = [
      eq(t.conventions.repoId, repoId),
      eq(t.conventions.status, 'accepted'),
      isNull(t.conventions.skillId),
      ...(ids ? [inArray(t.conventions.id, ids)] : []),
    ];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(...where))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.createdAt));
  }

  async markAbsorbed(ids: string[], skillId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.conventions)
      .set({ skillId, updatedAt: new Date() })
      .where(inArray(t.conventions.id, ids));
  }
}
