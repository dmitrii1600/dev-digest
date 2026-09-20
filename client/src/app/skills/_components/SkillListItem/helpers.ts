import type { SkillSource } from "@devdigest/shared";

/** A skill that arrived from outside the workspace and hasn't been vetted yet.
 *  Matches `specs/02-skills-lab.md`: "An `imported_*` source with `enabled:
 *  false` shows a 'needs vetting' badge/state." — `manual`, `extracted` and
 *  `community` are not gated by this (only the two `imported_*` sources are). */
export function needsVetting(source: SkillSource, enabled: boolean): boolean {
  return source.startsWith("imported_") && !enabled;
}
