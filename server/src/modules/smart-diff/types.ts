import type { SmartDiff } from '@devdigest/shared';

/**
 * The Smart Diff port. Other modules (the PR brief) reach `SmartDiffService`
 * ONLY through `Container['smartDiff']` — a type-only edge, never by importing
 * `modules/smart-diff/*` (`no-cross-module-reach-in`). `SmartDiffService`
 * implements it in `service.ts`.
 */
export interface SmartDiffPort {
  /** Throws `NotFoundError` when the PR does not exist in this workspace. */
  get(workspaceId: string, prId: string): Promise<SmartDiff>;
}
