import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * Demo conventions for the seeded repo (L02 second half): one finished scan
 * and the three candidates from the course mock, so `/repos/:id/conventions`
 * is not empty on a fresh clone and `e2e/` has something to read.
 *
 * The evidence is fictional — `acme/payments-api` has no clone — and that is
 * fine: grounding runs only during extraction, never on read. Idempotent by
 * `(repo_id, rule)`; the scan row is inserted only when the repo has none.
 */

const SEED_CANDIDATES = [
  {
    category: 'async' as const,
    rule: 'Always use async/await instead of .then() chains',
    evidencePath: 'src/api/users.ts',
    evidenceLine: 23,
    evidenceSnippet: 'const user = await db.users.find(id);',
    confidence: 0.91,
  },
  {
    category: 'api' as const,
    rule: 'All public route handlers return typed Result<T, ApiError>',
    evidencePath: 'src/api/public/index.ts',
    evidenceLine: 14,
    evidenceSnippet: 'function handler(): Result<Item[], ApiError> {',
    confidence: 0.78,
  },
  {
    category: 'structure' as const,
    rule: 'Redis access goes through the src/lib/redis.ts singleton',
    evidencePath: 'src/lib/redis.ts',
    evidenceLine: 1,
    evidenceSnippet: 'export const redis = new Redis(config.redisUrl);',
    confidence: 0.85,
  },
];

export async function seedConventions(
  db: Db,
  workspaceId: string,
  repoId: string,
): Promise<void> {
  let [scan] = await db
    .select({ id: t.conventionScans.id })
    .from(t.conventionScans)
    .where(eq(t.conventionScans.repoId, repoId));
  if (!scan) {
    const sampled = [...new Set(SEED_CANDIDATES.map((c) => c.evidencePath))];
    [scan] = await db
      .insert(t.conventionScans)
      .values({
        workspaceId,
        repoId,
        status: 'done',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        sampledFiles: sampled,
        candidatesTotal: SEED_CANDIDATES.length,
        candidatesGrounded: SEED_CANDIDATES.length,
        tokensIn: 18_400,
        tokensOut: 620,
        costUsd: 0.004,
        finishedAt: new Date(),
      })
      .returning({ id: t.conventionScans.id });
  }

  for (const c of SEED_CANDIDATES) {
    const [existing] = await db
      .select({ id: t.conventions.id })
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), eq(t.conventions.rule, c.rule)));
    if (existing) continue;
    await db.insert(t.conventions).values({
      workspaceId,
      repoId,
      scanId: scan!.id,
      ...c,
      status: 'pending',
    });
  }
}
