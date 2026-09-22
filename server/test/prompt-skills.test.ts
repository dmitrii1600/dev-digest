import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';

/**
 * A1 — skills-in-prompt assembly (pure, no LLM, no DB).
 *
 * `assemblePrompt`'s `skills` slot, its section heading, ordering and
 * omit-when-empty behaviour already exist (spec `03-skills.md` scope: "Out —
 * Changes to assemblePrompt"); this file is the regression guard that they
 * stay exactly as `run-executor.ts`'s `buildSkillBlocks` depends on:
 *  - a `## Skills / rules` section renders when `skills` is a non-empty array
 *  - it sits between `## PR description` and `## Relevant memory`
 *  - omitting `skills` produces a BYTE-IDENTICAL user message to a call that
 *    never mentions the key at all — the single most important regression
 *    guard here: no existing agent's prompt may change unless it has a skill
 *    attached.
 */

const COMMON = {
  system: 'You are a reviewer.',
  memory: ['Do not flag try/catch around JSON.parse'],
  specs: ['# Security baseline\nNo secrets in code.'],
  prDescription: 'This PR adds rate limiting to the public API.',
  diff: '@@ -1 +1 @@\n+stripeKey',
  task: "Review PR #482 'rate limit'",
} as const;

describe('assemblePrompt + skills', () => {
  it('renders "## Skills / rules" containing each skill body', () => {
    const { messages, assembly } = assemblePrompt({
      ...COMMON,
      skills: ['## House rule\nAlways add a regression test.'],
    });
    const user = messages[1]!.content;

    expect(user).toContain('## Skills / rules\n## House rule\nAlways add a regression test.');
    expect(assembly.skills).toBe('## House rule\nAlways add a regression test.');
  });

  it('joins multiple skill bodies (blank line between them) in array order', () => {
    const { messages } = assemblePrompt({ ...COMMON, skills: ['first body', 'second body'] });
    const user = messages[1]!.content;
    expect(user).toContain('## Skills / rules\nfirst body\n\nsecond body');
  });

  it('renders Skills BETWEEN "## PR description" and "## Relevant memory"', () => {
    const { messages } = assemblePrompt({
      ...COMMON,
      skills: ['## Rule A\nBody A', '## Rule B\nBody B'],
    });
    const user = messages[1]!.content;

    const idxPrDesc = user.indexOf('## PR description');
    const idxSkills = user.indexOf('## Skills / rules');
    const idxMemory = user.indexOf('## Relevant memory');

    expect(idxPrDesc).toBeGreaterThan(-1);
    expect(idxSkills).toBeGreaterThan(idxPrDesc);
    expect(idxMemory).toBeGreaterThan(idxSkills);
  });

  it('omits the section (byte-identical) when skills is undefined', () => {
    const withUndefinedKey = assemblePrompt({ ...COMMON, skills: undefined });
    const withoutKeyAtAll = assemblePrompt({ ...COMMON });

    expect(withUndefinedKey.messages[1]!.content).toBe(withoutKeyAtAll.messages[1]!.content);
    expect(withoutKeyAtAll.messages[1]!.content).not.toContain('## Skills / rules');
    expect(withoutKeyAtAll.assembly.skills).toBeNull();
  });

  it('omits the section (byte-identical) when skills is an empty array', () => {
    const empty = assemblePrompt({ ...COMMON, skills: [] });
    const noKey = assemblePrompt({ ...COMMON });
    expect(empty.messages[1]!.content).toBe(noKey.messages[1]!.content);
  });

  /**
   * The regression this whole file exists to guard: an agent with nothing
   * attached to it must assemble a prompt that is byte-identical to what it
   * would have produced before the skills feature existed at all — down to
   * the diff/system/task-only minimal call `run-executor.ts` used before L02.
   */
  it('an agent with no skills produces a byte-identical prompt to before this feature existed', () => {
    const minimal = { system: 'sys', diff: 'D' };
    const before = assemblePrompt(minimal);
    const afterFeatureNoSkillsAttached = assemblePrompt({ ...minimal, skills: undefined });

    expect(afterFeatureNoSkillsAttached.messages[1]!.content).toBe(before.messages[1]!.content);
    expect(afterFeatureNoSkillsAttached.messages[0]!.content).toBe(before.messages[0]!.content);
    expect(afterFeatureNoSkillsAttached.assembly.skills).toBeNull();
    expect(before.assembly.skills).toBeNull();
  });
});
