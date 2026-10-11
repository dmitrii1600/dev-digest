import type { Agent, AgentVersion, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { AgentVersionConfig, AgentVersionOrigin, EvalRunSkill } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow } from './repository.js';

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/** Map a persisted agent row to the public `Agent` DTO. */
export function toAgentDto(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
  };
}

/**
 * Map a persisted `agent_versions` row to the public `AgentVersion` DTO. The
 * stored `config_json` is untyped jsonb (a snapshot from an older config shape
 * could drift), so it is parsed through `AgentVersionConfig` — a malformed
 * snapshot throws here rather than leaking an unvalidated blob to the client.
 */
export function toAgentVersionDto(row: AgentVersionRow): AgentVersion {
  return {
    agent_id: row.agentId,
    version: row.version,
    config: AgentVersionConfig.parse(row.configJson),
    created_at: row.createdAt.toISOString(),
    // A missing or malformed origin reads as "an ordinary edit"; it never fails the read.
    origin: AgentVersionOrigin.safeParse(row.origin).data ?? null,
  };
}

/** A snapshot's `config_json` as an `AgentVersionConfig`, or `undefined` when it cannot be read. */
export function readVersionConfig(configJson: unknown): AgentVersionConfig | undefined {
  const parsed = AgentVersionConfig.safeParse(configJson);
  return parsed.success ? parsed.data : undefined;
}

/** An eval run's recorded skill set (jsonb), or `undefined` when it cannot be read. */
export function readRunSkills(skills: unknown): { skill_id: string; name: string }[] | undefined {
  const parsed = EvalRunSkill.array().safeParse(skills);
  return parsed.success ? parsed.data : undefined;
}

/** One `agent_skills` binding. */
export interface SkillLink {
  skillId: string;
  order: number;
  enabled: boolean;
}

/**
 * The links an agent gets when it is promoted to a past run's skill set (spec Q1).
 *  - the run's skills that still exist come first, enabled, in the run's order (0…k-1);
 *  - every other currently linked skill is kept but DISABLED, after them, in its prior
 *    relative order (non-destructive; reversible from the Skills tab);
 *  - the run's skills that no longer exist are reported as `missing` (name from the run record).
 */
export function planSkillLinks(
  runSkills: readonly { skill_id: string; name: string }[],
  existingSkillIds: ReadonlySet<string>,
  currentLinks: readonly SkillLink[],
): { links: SkillLink[]; missing: { skill_id: string; name: string }[] } {
  const seen = new Set<string>();
  const links: SkillLink[] = [];
  const missing: { skill_id: string; name: string }[] = [];
  for (const s of runSkills) {
    if (seen.has(s.skill_id)) continue;
    seen.add(s.skill_id);
    if (existingSkillIds.has(s.skill_id)) {
      links.push({ skillId: s.skill_id, order: links.length, enabled: true });
    } else {
      missing.push({ skill_id: s.skill_id, name: s.name });
    }
  }
  const rest = [...currentLinks].sort((a, b) => a.order - b.order).filter((l) => !seen.has(l.skillId));
  for (const l of rest) links.push({ skillId: l.skillId, order: links.length, enabled: false });
  return { links, missing };
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'systemPrompt'
    | 'strategy'
    | 'ciFailOn'
    | 'repoIntel'
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined && patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined
  );
}
