import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { planSkillLinks, toAgentVersionDto, type SkillLink } from '../src/modules/agents/helpers.js';
import type { AgentVersionRow } from '../src/modules/agents/repository.js';

/**
 * Promote, hermetic lane: the pure link planner, the version DTO's `origin`, and declarative
 * validation of `POST /agents/:id/promote` (rejected before any handler runs, so no DB).
 * The transaction itself — locking, the 409 race, agent-owned run lookup — is in
 * `agents-promote.it.test.ts`.
 */

const link = (skillId: string, order: number, enabled = true): SkillLink => ({ skillId, order, enabled });
const run = (...ids: string[]) => ids.map((id) => ({ skill_id: id, name: `name-${id}` }));
const exist = (...ids: string[]) => new Set(ids);

describe('planSkillLinks', () => {
  it('an empty run set disables every current link and keeps their order', () => {
    const { links, missing } = planSkillLinks([], exist('a', 'b'), [link('a', 0), link('b', 1)]);
    expect(links).toEqual([link('a', 0, false), link('b', 1, false)]);
    expect(missing).toEqual([]);
  });

  it('a run set equal to the current set leaves the order unchanged (all enabled)', () => {
    const { links, missing } = planSkillLinks(run('a', 'b'), exist('a', 'b'), [link('a', 0), link('b', 1)]);
    expect(links).toEqual([link('a', 0), link('b', 1)]);
    expect(missing).toEqual([]);
  });

  it('a deleted skill is reported as missing, with the name from the run, and is not linked', () => {
    const { links, missing } = planSkillLinks(run('a', 'gone', 'b'), exist('a', 'b'), [link('a', 0), link('b', 1)]);
    expect(links.map((l) => l.skillId)).toEqual(['a', 'b']);
    expect(missing).toEqual([{ skill_id: 'gone', name: 'name-gone' }]);
  });

  it('a skill linked now but not in the run is kept, disabled, after the run skills', () => {
    const { links } = planSkillLinks(run('b'), exist('a', 'b'), [link('a', 0), link('b', 1)]);
    expect(links).toEqual([link('b', 0, true), link('a', 1, false)]);
  });

  it('the run order wins over the current order', () => {
    const { links } = planSkillLinks(run('b', 'a'), exist('a', 'b'), [link('a', 0), link('b', 1)]);
    expect(links).toEqual([link('b', 0), link('a', 1)]);
  });

  it('re-enables a run skill that is currently linked but disabled', () => {
    const { links } = planSkillLinks(run('a'), exist('a'), [link('a', 0, false)]);
    expect(links).toEqual([link('a', 0, true)]);
  });

  it('sorts leftover links by their order, not their array position', () => {
    const { links } = planSkillLinks(run('x'), exist('x', 'a', 'b'), [link('b', 5), link('a', 2)]);
    expect(links.map((l) => l.skillId)).toEqual(['x', 'a', 'b']);
    expect(links.map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it('a skill that appears twice in the run is linked once', () => {
    const { links } = planSkillLinks(run('a', 'a'), exist('a'), []);
    expect(links).toEqual([link('a', 0)]);
  });
});

describe('toAgentVersionDto origin', () => {
  const row = (origin: unknown): AgentVersionRow => ({
    agentId: 'agent-1',
    version: 3,
    configJson: {
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'p',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'never',
      repo_intel: true,
      skills: [],
    },
    origin,
    createdAt: new Date('2026-10-05T00:00:00Z'),
  });

  it('is null when absent', () => {
    expect(toAgentVersionDto(row(null)).origin).toBeNull();
  });

  it('is passed through when valid', () => {
    const origin = {
      kind: 'promotion',
      from_version: 1,
      eval_run_id: 'run-1',
      missing_skills: [{ skill_id: 's', name: 'S' }],
    };
    expect(toAgentVersionDto(row(origin)).origin).toEqual(origin);
  });

  it('is null when malformed, and the read still succeeds', () => {
    expect(toAgentVersionDto(row({ kind: 'promotion' })).origin).toBeNull();
    expect(toAgentVersionDto(row('nonsense')).origin).toBeNull();
  });
});

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const UUID = '00000000-0000-4000-8000-000000000000';
const body = (over: Record<string, unknown> = {}) => ({
  from_version: 1,
  eval_run_id: UUID,
  expected_version: 2,
  ...over,
});

const rejected: [string, string, Record<string, unknown>][] = [
  ['id is not a uuid', '/agents/not-a-uuid/promote', body()],
  ['extra body key', `/agents/${UUID}/promote`, body({ name: 'x' })],
  ['from_version 0', `/agents/${UUID}/promote`, body({ from_version: 0 })],
  ['expected_version -1', `/agents/${UUID}/promote`, body({ expected_version: -1 })],
  ['eval_run_id is not a uuid', `/agents/${UUID}/promote`, body({ eval_run_id: 'nope' })],
  ['from_version is not an integer', `/agents/${UUID}/promote`, body({ from_version: 1.5 })],
  ['expected_version missing', `/agents/${UUID}/promote`, { from_version: 1, eval_run_id: UUID }],
];

describe('POST /agents/:id/promote (no DB): validation rejects before any handler runs', () => {
  it.each(rejected)('%s → 422 validation_error', async (_name, url, payload) => {
    const app = await buildApp({ config });
    try {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    } finally {
      await app.close();
    }
  });
});
