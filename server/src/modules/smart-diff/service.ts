import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff, latestReviewPerAgent } from './helpers.js';
import type { SmartDiffRepository } from './repository.js';

/**
 * The Smart Diff (L03) service — pure code, no LLM call, no `Container`.
 * `[tree-adapt]`: takes the one port it needs (`SmartDiffRepository`), not
 * the whole `Container` — a *new* service taking `Container` is Onion Rule 9
 * (`.claude/skills/onion-architecture/rules.md:210`), the same shape
 * `intent/service.ts` takes (`IntentDeps`).
 */
export class SmartDiffService {
  constructor(private readonly repo: SmartDiffRepository) {}

  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const exists = await this.repo.pullExists(workspaceId, prId);
    if (!exists) throw new NotFoundError('Pull request not found');

    const [files, reviews] = await Promise.all([
      this.repo.getPrFiles(prId),
      this.repo.reviewsWithFindings(prId),
    ]);

    const findings = latestReviewPerAgent(reviews).flatMap((review) => review.findings);
    return buildSmartDiff(files, findings);
  }
}
