import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * The PR's blast-radius scope: which repo it belongs to and which files it
 * touches (persisted `pr_files.path`, written only by `GET /pulls/:id` —
 * see `modules/pulls/routes.ts:241-252`).
 */
export interface PrScope {
  prId: string;
  repoId: string;
  files: string[];
}

/**
 * Ring 3 — the only Drizzle in this module. Reads the PR's scope; never
 * `$inferSelect` in the return type (rule 5 — a row shape is not a domain
 * type). `container.reviewRepo.getPull`/`getPrFiles` are deliberately not
 * reused here: they return row types, which would leak into a ring-2 (`service.ts`,
 * `helpers.ts`) signature.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  async getPrScope(workspaceId: string, prId: string): Promise<PrScope | null> {
    const [pr] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) return null;

    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, pr.id));
    const files = [...new Set(rows.map((r) => r.path))].sort();

    return { prId: pr.id, repoId: pr.repoId, files };
  }
}
