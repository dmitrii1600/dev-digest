/**
 * Skill type → CSS colour token, defined ONCE and shared by every feature that
 * shows a skill type badge (`/skills` list, the agent editor's Skills tab) —
 * `INSIGHTS.md` already warns against a third local `SEV_COLOR`-style copy.
 */
export const SKILL_TYPE_COLOR: Record<string, string> = {
  rubric: "var(--sugg)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--info)",
};

export const SKILL_TYPE_COLOR_FALLBACK = "var(--text-muted)";

/**
 * Convention category → CSS colour token, for the candidate card badge on the
 * Conventions page. Lives beside `SKILL_TYPE_COLOR` for the same reason: one
 * map, imported by every consumer, never a local copy.
 */
export const CONVENTION_CATEGORY_COLOR: Record<string, string> = {
  naming: "var(--info)",
  structure: "var(--accent)",
  imports: "var(--accent)",
  typing: "var(--sugg)",
  async: "var(--ok)",
  error_handling: "var(--crit)",
  testing: "var(--warn)",
  api: "var(--info)",
  style: "var(--text-muted)",
  other: "var(--text-muted)",
};
