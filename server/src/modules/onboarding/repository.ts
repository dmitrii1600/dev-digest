import { and, eq } from 'drizzle-orm';
import { Onboarding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** What the service needs to know about a repo — read here, not from the repos module. */
export interface RepoBasics {
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

/**
 * Onboarding data-access: the one `onboarding` row per repo (PK `repo_id`,
 * cascade-deleted with the repo) and a workspace-scoped read of `repos` basics.
 */
export class OnboardingRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoBasics | null> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        name: t.repos.name,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row ?? null;
  }

  /** The stored tour, or `null` when none — or when the row is a legacy shape that no longer parses. */
  async getTour(repoId: string): Promise<Onboarding | null> {
    const [row] = await this.db
      .select({ json: t.onboarding.json })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    if (!row) return null;
    const parsed = Onboarding.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  /** Replace the repo's one tour (NFR-11). */
  async saveTour(repoId: string, tour: Onboarding): Promise<void> {
    const generatedAt = new Date(tour.generated_at);
    await this.db
      .insert(t.onboarding)
      .values({ repoId, json: tour, generatedAt })
      .onConflictDoUpdate({ target: t.onboarding.repoId, set: { json: tour, generatedAt } });
  }
}
