import { describe, it, expect } from "vitest";
import type { Agent, AgentSkillLink, AgentVersionConfig, Skill } from "@devdigest/shared";
import { jsonEqual, promotionDiff } from "./helpers";

const AGENT = {
  id: "ag1",
  name: "A",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Be strict.",
  output_schema: { type: "object", properties: { a: 1, b: 2 } },
  enabled: true,
  version: 5,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
} as Agent;

const SNAP: AgentVersionConfig = {
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Be strict.",
  output_schema: { type: "object", properties: { b: 2, a: 1 } }, // same content, other object + key order
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skills: [],
};

const skill = (id: string, over: Partial<Skill> = {}) => ({ id, name: `skill-${id}`, enabled: true, version: 1, ...over }) as Skill;
const link = (id: string, order: number, enabled = true): AgentSkillLink => ({ agent_id: "ag1", skill_id: id, order, enabled });
const rs = (id: string, version = 1) => ({ skill_id: id, name: `skill-${id}`, version });

describe("promotionDiff", () => {
  it("an identical configuration is the same: no changes at all", () => {
    const d = promotionDiff(SNAP, { skills: [rs("s1"), rs("s2")] }, AGENT, [link("s1", 0), link("s2", 1)], [skill("s1"), skill("s2")]);
    expect(d.same).toBe(true);
    expect(d.fieldChanges).toEqual([]);
    expect(d.skillChanges).toEqual({ added: [], removed: [], reordered: false });
    expect(d.missing).toEqual([]);
    expect(d.versionDrift).toEqual([]);
  });

  it("an output_schema that is deep-equal but a different object is no change", () => {
    expect(jsonEqual(SNAP.output_schema, AGENT.output_schema)).toBe(true);
    expect(promotionDiff(SNAP, { skills: [] }, AGENT, [], []).fieldChanges).not.toContain("output_schema");
    // null and undefined are both "no schema"
    expect(jsonEqual(null, undefined)).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });

  it("lists every field where the snapshot differs from the current agent", () => {
    const d = promotionDiff({ ...SNAP, model: "gpt-5", system_prompt: "Other", repo_intel: false }, { skills: [] }, AGENT, [], []);
    expect(d.fieldChanges).toEqual(["model", "system_prompt", "repo_intel"]);
    expect(d.same).toBe(false);
  });

  it("only the order of two shared skills differs: reordered, not the same", () => {
    const d = promotionDiff(SNAP, { skills: [rs("s2"), rs("s1")] }, AGENT, [link("s1", 0), link("s2", 1)], [skill("s1"), skill("s2")]);
    expect(d.skillChanges).toEqual({ added: [], removed: [], reordered: true });
    expect(d.same).toBe(false);
  });

  it("a globally disabled skill (or a disabled link) is not part of the current set", () => {
    const skills = [skill("s1"), skill("off", { enabled: false }), skill("s3")];
    const links = [link("s1", 0), link("off", 1), link("s3", 2, false)];
    // the run used only s1: nothing is removed, because "off" and s3 were never effective
    const d = promotionDiff(SNAP, { skills: [rs("s1")] }, AGENT, links, skills);
    expect(d.skillChanges.removed).toEqual([]);
    expect(d.same).toBe(true);
    // the run used s3, which is linked but disabled now: it counts as added
    expect(promotionDiff(SNAP, { skills: [rs("s1"), rs("s3")] }, AGENT, links, skills).skillChanges.added).toEqual([rs("s3")].map(({ skill_id, name }) => ({ skill_id, name })));
  });

  it("a skill in the current set but not in the run is removed; one only in the run is added", () => {
    const d = promotionDiff(SNAP, { skills: [rs("s2")] }, AGENT, [link("s1", 0)], [skill("s1"), skill("s2")]);
    expect(d.skillChanges.removed).toEqual([{ skill_id: "s1", name: "skill-s1" }]);
    expect(d.skillChanges.added).toEqual([{ skill_id: "s2", name: "skill-s2" }]);
  });

  it("a deleted skill is missing, not added", () => {
    const d = promotionDiff(SNAP, { skills: [rs("s1"), rs("gone")] }, AGENT, [link("s1", 0)], [skill("s1")]);
    expect(d.missing).toEqual([{ skill_id: "gone", name: "skill-gone" }]);
    expect(d.skillChanges.added).toEqual([]);
    expect(d.same).toBe(true);
  });

  it("a skill recorded at version 3 and now at 4 is drift (only the link is restored)", () => {
    const d = promotionDiff(SNAP, { skills: [rs("s1", 3)] }, AGENT, [link("s1", 0)], [skill("s1", { version: 4 })]);
    expect(d.versionDrift).toEqual([{ skill_id: "s1", name: "skill-s1", then: 3, now: 4 }]);
    expect(d.same).toBe(true);
  });
});
