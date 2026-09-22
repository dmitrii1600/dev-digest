import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over a skill's name + description — same shape as
 *  `AgentsListView/helpers.ts`'s `filterAgents`. */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) => `${sk.name} ${sk.description}`.toLowerCase().includes(q));
}
