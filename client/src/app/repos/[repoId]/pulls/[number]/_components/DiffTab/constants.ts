import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Hand-kept mirror of `SmartDiffRole`'s five values, in the tab's display
 * order. NEVER `SmartDiffRole.options` in client source (client/INSIGHTS.md:
 * importing a runtime *value* from `vendor/shared` breaks the webpack
 * build) — `helpers.test.ts` is allowed to use it, and does, to catch drift
 * if the enum grows again.
 */
export const ROLE_ORDER = [
  "core",
  "tests",
  "wiring",
  "docs",
  "boilerplate",
] as const satisfies readonly SmartDiffRole[];

/** Groups collapsed on first render — everything else starts open. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<SmartDiffRole> = new Set(["docs", "boilerplate"]);
