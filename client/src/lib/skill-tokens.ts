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
