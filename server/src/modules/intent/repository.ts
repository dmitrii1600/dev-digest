import { and, eq } from 'drizzle-orm';
import type { IntentSource } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
export type { PullRow };

export type IntentRow = typeof t.prIntent.$inferSelect;

/** What the service needs to know about a repo — read here, not from the repos module. */
export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

export interface SpecChunk {
  path: string;
  content: string;
}

export interface UpsertIntentValues {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  headSha: string | null;
  confidence: number;
  sources: IntentSource[];
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

/**
 * `pr_intent` data-access — the sole owner of the table. Replaces the old
 * `upsertIntent`/`getIntent` on the reviews repository (deleted — verified
 * zero call sites across `src`, `test`, `e2e`, `client/src`).
 */
export class IntentRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  async getPrFiles(
    prId: string,
  ): Promise<{ path: string; additions: number; deletions: number }[]> {
    return this.db
      .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  async getIntentRow(prId: string): Promise<IntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  async upsertIntent(prId: string, values: UpsertIntentValues): Promise<void> {
    const set = {
      intent: values.intent,
      inScope: values.inScope,
      outOfScope: values.outOfScope,
      headSha: values.headSha,
      confidence: values.confidence,
      sources: values.sources,
      provider: values.provider,
      model: values.model,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      error: null,
      generatedAt: new Date(),
    };
    await this.db
      .insert(t.prIntent)
      .values({ prId, ...set })
      .onConflictDoUpdate({ target: t.prIntent.prId, set });
  }

  /**
   * A failed (re-)derivation touches ONLY `error` + `generated_at` — the
   * previous good intent/sources stay in place. A no-op UPDATE (0 rows) when
   * the PR was never successfully derived, which is fine: there is nothing to
   * preserve, and the route's 422 body already carries the reason.
   */
  async markFailed(prId: string, error: string): Promise<void> {
    await this.db
      .update(t.prIntent)
      .set({ error, generatedAt: new Date() })
      .where(eq(t.prIntent.prId, prId));
  }

  /** `code_chunks` where `source = 'spec'` — always `[]` on this tree (no
   *  writer yet; see specs/06-intent-layer.md's open question). */
  async getSpecChunks(repoId: string, limit: number): Promise<SpecChunk[]> {
    return this.db
      .select({ path: t.codeChunks.path, content: t.codeChunks.content })
      .from(t.codeChunks)
      .where(and(eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.source, 'spec')))
      .limit(limit);
  }
}
