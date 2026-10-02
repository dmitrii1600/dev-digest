import { and, eq, sql } from 'drizzle-orm';
import { PrBriefRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** What the service needs to know about a PR: its text, head and repo — read here, not from the pulls module. */
export interface BriefPr {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

/**
 * PR Brief data-access. The brief lives under the `brief` key of the PR's one
 * `pr_brief.json` document (cascade-deleted with the PR); Prior PRs owns the
 * `history` key. Each writer merges its own key with a top-level `||`, so
 * neither ever rewrites the other's.
 */
export class BriefRepository {
  constructor(private db: Db) {}

  async getPr(workspaceId: string, prId: string): Promise<BriefPr | null> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)));
    return row ?? null;
  }

  /**
   * The stored brief, or `null` when there is none — a history-only document, a
   * missing row, or a legacy shape that no longer parses all read as "no brief yet".
   */
  async getBrief(prId: string): Promise<PrBriefRecord | null> {
    const [row] = await this.db
      .select({ brief: sql<unknown>`${t.prBrief.json} -> 'brief'` })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    if (!row || row.brief == null) return null;
    // A raw `->` expression bypasses the jsonb column mapper; accept a driver that hands back text.
    let raw: unknown = row.brief;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    const parsed = PrBriefRecord.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /** Replace the PR's one brief, in one statement; every other key of the document is kept. */
  async saveBrief(prId: string, record: PrBriefRecord): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: { brief: record } })
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: { json: sql`${t.prBrief.json} || excluded.json` },
      });
  }
}
