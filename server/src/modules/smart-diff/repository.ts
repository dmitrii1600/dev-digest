import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * `smart-diff` data-access — ring 3, the only file in this module with a
 * query. It writes its own three queries rather than reaching into the
 * reviews module's repository, for two independent reasons:
 *   1. `no-cross-module-reach-in` (`server/INSIGHTS.md:138`) — a module gets
 *      exactly one importing folder, its own.
 *   2. `container.reviewRepo` returns `$inferSelect` rows (`PullRow`,
 *      `FindingRow` from `db/rows.ts`) — passing those into this module's
 *      ring-2 `service.ts`/`helpers.ts` would break Rule 5 (a row type must
 *      not appear in a ring-2 signature) even if reason 1 didn't apply.
 * The interfaces below are this repository's own narrow return shapes
 * (Rule 5): never a `$inferSelect` row, so `service.ts`/`helpers.ts` (ring 2)
 * can import them with `import type` without reaching into `db/rows.ts`.
 */

export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffFindingInput {
  file: string;
  startLine: number;
  dismissedAt: Date | null;
}

export interface SmartDiffReviewInput {
  agentId: string | null;
  createdAt: Date;
  findings: SmartDiffFindingInput[];
}

export class SmartDiffRepository {
  constructor(private db: Db) {}

  /** Scoped by workspace + id, as in `reviews/repository/pull.repo.ts:8-18`. */
  async pullExists(workspaceId: string, prId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row !== undefined;
  }

  /** Project only the three columns Smart Diff needs, as in
   *  `intent/repository.ts:68-75`. No ordering column on `pr_files`, so this
   *  is an unordered select — the same as the PR-detail read. */
  async getPrFiles(prId: string): Promise<SmartDiffFileInput[]> {
    return this.db
      .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /** `kind='review'` reviews for the PR, newest first, each with its
   *  non-dismissed-or-not findings (the service decides dismissal). Mirrors
   *  `reviews/repository/review.repo.ts:58-74` (one `inArray` for findings,
   *  not N+1). */
  async reviewsWithFindings(prId: string): Promise<SmartDiffReviewInput[]> {
    const reviews = await this.db
      .select({ id: t.reviews.id, agentId: t.reviews.agentId, createdAt: t.reviews.createdAt })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
    if (reviews.length === 0) return [];

    const ids = reviews.map((r) => r.id);
    const findings = await this.db
      .select({
        reviewId: t.findings.reviewId,
        file: t.findings.file,
        startLine: t.findings.startLine,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .where(inArray(t.findings.reviewId, ids));

    return reviews.map((review) => ({
      agentId: review.agentId,
      createdAt: review.createdAt,
      findings: findings
        .filter((f) => f.reviewId === review.id)
        .map((f) => ({ file: f.file, startLine: f.startLine, dismissedAt: f.dismissedAt })),
    }));
  }
}
