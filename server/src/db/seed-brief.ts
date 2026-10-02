import type { PrBriefRecord } from '@devdigest/shared';
import { BriefRepository } from '../modules/brief/repository.js';
import type { Db } from './client.js';

/**
 * Demo PR Brief for the seeded PR #482 (L06), so the Overview tab's brief
 * section renders on a fresh clone — and the e2e flow (`16-pr-brief`) has a
 * brief to click through without a model call.
 *
 * Written through `BriefRepository.saveBrief` (never a raw insert; `db/**` is
 * ring 3 and may import `modules/**`, the `seed-blast.ts` precedent), which
 * merges only the `brief` key, so the Prior PRs `history` the blast seed wrote
 * is left alone. Idempotent: skipped once the PR already has a brief.
 *
 * `src/server.ts` is a blast-map caller, not a changed file: the third review-
 * focus item exercises the "blast-only file" path (EC-6).
 */
const SEED_BRIEF: PrBriefRecord = {
  summary: 'Adds a token-bucket rate limiter to the public API and mounts it on the webhook routes.',
  risks: [
    {
      kind: 'security',
      severity: 'high',
      title: 'Limiter keyed on a spoofable header',
      explanation:
        'The bucket key falls back to a client-supplied header, so one caller can rotate keys to bypass the limit.',
      file_refs: ['src/middleware/ratelimit.ts:12-30'],
    },
    {
      kind: 'breaking_api',
      severity: 'medium',
      title: 'Public webhooks can now answer 429',
      explanation: 'Webhook senders that do not retry on 429 will drop events.',
      file_refs: ['src/api/public/webhooks.ts:8', 'src/server.ts:31'],
    },
  ],
  review_focus: [
    { file: 'src/middleware/ratelimit.ts', line: 12, reason: 'Token refill math and the bucket key' },
    { file: 'src/api/public/webhooks.ts', line: 8, reason: '429 path for unauthenticated senders' },
    { file: 'src/server.ts', line: 31, reason: 'Where the limiter is mounted (blast map only)' },
  ],
  missing_facts: [
    { fact: 'project_context', status: 'absent', detail: null },
    { fact: 'linked_issue', status: 'absent', detail: null },
  ],
  head_sha: 'a1b2c3d4e5f6',
  provider: 'openai',
  model: 'gpt-4.1',
  input_tokens: 3120,
  tokens_in: 3120,
  tokens_out: 410,
  cost_usd: 0.0094,
  generated_at: '2026-04-02T09:30:00.000Z',
};

export async function seedBrief(db: Db, pr: { id: string; headSha: string }): Promise<void> {
  const repo = new BriefRepository(db);
  if (await repo.getBrief(pr.id)) return;
  await repo.saveBrief(pr.id, { ...SEED_BRIEF, head_sha: pr.headSha });
}
