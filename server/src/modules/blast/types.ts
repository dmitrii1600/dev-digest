import type { BlastRadius } from '@devdigest/shared';

/**
 * The blast-radius port. Other modules (the PR brief) reach `BlastService`
 * ONLY through `Container['blast']` — a type-only edge, never by importing
 * `modules/blast/*` (`no-cross-module-reach-in`). `BlastService` implements it
 * in `service.ts`; the composition root is the only other file that imports it.
 */
export interface BlastPort {
  /** `null` when the PR does not exist in this workspace. */
  forPull(workspaceId: string, prId: string): Promise<BlastRadius | null>;
}
