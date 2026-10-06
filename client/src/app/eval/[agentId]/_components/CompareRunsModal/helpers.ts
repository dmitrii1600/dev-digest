import type { Agent, AgentSkillLink, AgentVersionConfig, EvalRunSkill, EvalSuiteRun, Skill } from "@devdigest/shared";

/** The agent's configuration fields a promotion restores (name, description and enabled stay). */
export const PROMOTE_FIELDS = [
  "provider",
  "model",
  "system_prompt",
  "output_schema",
  "strategy",
  "ci_fail_on",
  "repo_intel",
] as const;
export type PromoteField = (typeof PROMOTE_FIELDS)[number];

/** The `agents.config` message key that labels each field. */
export const FIELD_LABEL_KEY = {
  provider: "provider",
  model: "model",
  system_prompt: "systemPrompt",
  output_schema: "outputSchema",
  strategy: "strategy",
  ci_fail_on: "ciFailOn",
  repo_intel: "repoIntel",
} as const satisfies Record<PromoteField, string>;

export interface SkillRef {
  skill_id: string;
  name: string;
}

export interface PromotionDiff {
  /** Fields where the recorded snapshot differs from the agent's current value. */
  fieldChanges: PromoteField[];
  skillChanges: {
    /** In the run's set and still existing, but not in the current effective set. */
    added: SkillRef[];
    /** In the current effective set but not in the run's set (the server keeps the link, disabled). */
    removed: SkillRef[];
    /** The skills both sets share are in a different order. */
    reordered: boolean;
  };
  /** Skills of the run that no longer exist — they will not be restored (EC-2). */
  missing: SkillRef[];
  /** Skills that still exist with a different version now — only the link is restored (EC-3). */
  versionDrift: { skill_id: string; name: string; then: number; now: number }[];
  /** No field and no skill change: the run's configuration is the current one (EC-1). */
  same: boolean;
}

/** Key-order independent deep equality for JSON values; `null` and `undefined` are the same "no value". */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  return keys.length === Object.keys(bo).length && keys.every((k) => k in bo && jsonEqual(ao[k], bo[k]));
}

const sameSequence = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** What promoting `run` would change: its snapshot against the agent's current fields, its recorded
 *  skill set against the current effective set (enabled link AND enabled skill, by link order — the
 *  rule the review run itself uses). Pure; the server restores exactly this. */
export function promotionDiff(
  snapshot: AgentVersionConfig,
  run: Pick<EvalSuiteRun, "skills">,
  agent: Agent,
  links: AgentSkillLink[],
  skills: Skill[],
): PromotionDiff {
  const fieldChanges = PROMOTE_FIELDS.filter((f) => !jsonEqual(snapshot[f], agent[f]));

  const byId = new Map(skills.map((sk) => [sk.id, sk]));
  const effective = links
    .filter((l) => l.enabled && byId.get(l.skill_id)?.enabled)
    .sort((a, b) => a.order - b.order)
    .map((l) => l.skill_id);
  const effectiveSet = new Set(effective);

  const runSkills: EvalRunSkill[] = run.skills;
  const missing = runSkills.filter((r) => !byId.has(r.skill_id)).map(({ skill_id, name }) => ({ skill_id, name }));
  const restorable = runSkills.filter((r) => byId.has(r.skill_id));
  const restorableIds = restorable.map((r) => r.skill_id);
  const restorableSet = new Set(restorableIds);

  const added = restorable.filter((r) => !effectiveSet.has(r.skill_id)).map(({ skill_id, name }) => ({ skill_id, name }));
  const removed = effective
    .filter((id) => !restorableSet.has(id))
    .map((id) => ({ skill_id: id, name: byId.get(id)?.name ?? id }));
  const reordered = !sameSequence(
    restorableIds.filter((id) => effectiveSet.has(id)),
    effective.filter((id) => restorableSet.has(id)),
  );

  const versionDrift = restorable.flatMap((r) => {
    const now = byId.get(r.skill_id)?.version;
    return now != null && now !== r.version ? [{ skill_id: r.skill_id, name: r.name, then: r.version, now }] : [];
  });

  const same = fieldChanges.length === 0 && added.length === 0 && removed.length === 0 && !reordered;
  return { fieldChanges, skillChanges: { added, removed, reordered }, missing, versionDrift, same };
}
