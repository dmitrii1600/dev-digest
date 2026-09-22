import type { AgentSkillLink, Skill } from "@devdigest/shared";

/** One row in the merged Skills-tab list: every workspace skill, whether or
    not it is linked to this agent yet. */
export interface SkillRow {
  skill: Skill;
  enabled: boolean;
}

/**
 * Merges every workspace skill with this agent's (possibly partial) set of
 * bindings into ONE ordered list. Linked skills come first, in
 * `AgentSkillLink.order`; skills never linked to this agent follow, in name
 * order. Position is independent of `enabled` — an unchecked linked skill
 * keeps its slot between checked ones.
 */
export function mergeSkillRows(skills: readonly Skill[], links: readonly AgentSkillLink[]): SkillRow[] {
  const linkBySkillId = new Map(links.map((l) => [l.skill_id, l]));
  const skillById = new Map(skills.map((sk) => [sk.id, sk]));

  const linked = [...links]
    .sort((a, b) => a.order - b.order)
    .map((l) => skillById.get(l.skill_id))
    .filter((sk): sk is Skill => sk != null);

  const linkedIds = new Set(linked.map((sk) => sk.id));
  const unlinked = skills.filter((sk) => !linkedIds.has(sk.id)).slice().sort((a, b) => a.name.localeCompare(b.name));

  return [...linked, ...unlinked].map((skill) => ({
    skill,
    enabled: linkBySkillId.get(skill.id)?.enabled ?? false,
  }));
}

/** Case-insensitive substring filter on skill name. Narrows which rows are
    shown; it never changes the underlying order used for drag/keyboard
    reordering (that always operates on the full merged list). */
export function filterRows(rows: readonly SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) => row.skill.name.toLowerCase().includes(q));
}

/** Moves the item at `from` to `to` in the FULL row list, returning a new
    array. Used by both native drag-and-drop and arrow-key reordering so both
    paths produce the same `skill_ids` order sent to the server. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}
