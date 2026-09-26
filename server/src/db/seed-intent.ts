import { eq } from 'drizzle-orm';
import type { IntentSource } from '@devdigest/shared';
import { deriveConfidence } from '../modules/intent/helpers.js';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * Demo intent for the seeded PR #482 (Intent Layer, L03): one row so the
 * Overview tab's `IntentCard` is not empty on a fresh clone. Idempotent by
 * `pr_id`. `head_sha` matches the seeded PR's own head (`seed.ts:119`) so the
 * card renders fresh, not stale.
 *
 * Sources demonstrate BOTH end states decision 5 asks for: an inline plan
 * that resolved (`plan_spec`/`inline`, available) and a linked doc that
 * didn't (`plan_spec`/`external_url`, unavailable · 404) — no network call
 * happens during `db:seed`, the 404 is just the recorded outcome. Confidence
 * is computed with the real `deriveConfidence()` so seed and runtime can
 * never disagree.
 */

const SEED_INTENT_TEXT =
  'Add rate limiting middleware to the public API endpoints so an unauthenticated ' +
  'client cannot abuse them.';
const SEED_IN_SCOPE = ['Rate limiting middleware', 'Public API endpoints'];
const SEED_OUT_OF_SCOPE = ['Authentication flow', 'Internal/admin endpoints'];

const SEED_SOURCES: IntentSource[] = [
  {
    kind: 'pr_title',
    origin: null,
    ref: 'Add rate limiting to public API endpoints',
    status: 'available',
    detail: null,
  },
  { kind: 'pr_body', origin: null, ref: '95 chars', status: 'available', detail: null },
  { kind: 'changed_files', origin: null, ref: '4 file(s)', status: 'available', detail: null },
  {
    kind: 'project_context',
    origin: null,
    ref: '0 spec chunk(s)',
    status: 'unavailable',
    detail: '0 spec chunks indexed',
  },
  {
    kind: 'plan_spec',
    origin: 'inline',
    ref: '## Plan',
    status: 'available',
    detail: null,
  },
  {
    kind: 'plan_spec',
    origin: 'external_url',
    ref: 'https://internal.acme.example/docs/rate-limit-rfc',
    status: 'unavailable',
    detail: '404',
  },
];

export async function seedIntent(db: Db, prId: string, headSha: string): Promise<void> {
  const [existing] = await db.select({ prId: t.prIntent.prId }).from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (existing) return;

  await db.insert(t.prIntent).values({
    prId,
    intent: SEED_INTENT_TEXT,
    inScope: SEED_IN_SCOPE,
    outOfScope: SEED_OUT_OF_SCOPE,
    headSha,
    confidence: deriveConfidence(SEED_SOURCES),
    sources: SEED_SOURCES,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    tokensIn: 1_850,
    tokensOut: 140,
    costUsd: 0.0006,
    error: null,
  });
}
