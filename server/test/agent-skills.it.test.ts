import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { AgentSkillLink } from '@devdigest/shared';

/**
 * A2 — agent <-> skill link routes. The REGRESSION test for the data-loss bug
 * fixed in `AgentsRepository.setSkills` (`server/specs/02-skills-module.md`
 * "Why setSkills has to change"): a bulk delete+reinsert reorder used to reset
 * every binding's `enabled` flag to the column default. It now reads the
 * existing skill_id → enabled map first and re-inserts with it preserved.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agent-skills] Docker not available — skipping integration tests.');
}

d('Agent <-> Skill link routes', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function createAgent(app: App): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Skill link agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    return res.json().id as string;
  }

  async function createSkill(app: App, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, type: 'custom', body: `# ${name}\n\nBody.` },
    });
    return res.json().id as string;
  }

  it('setSkills (POST .../skills) preserves each binding\'s enabled flag across a reorder', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const a = await createSkill(app, 'Skill A');
    const b = await createSkill(app, 'Skill B');

    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [a, b] },
    });
    expect(linked.statusCode).toBe(200);
    // Freshly linked via setSkills — both default to disabled.
    const initial: AgentSkillLink[] = linked.json();
    expect(initial.find((l) => l.skill_id === a)).toMatchObject({ enabled: false, order: 0 });
    expect(initial.find((l) => l.skill_id === b)).toMatchObject({ enabled: false, order: 1 });

    const enable = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${a}`,
      payload: { enabled: true },
    });
    expect(enable.statusCode).toBe(200);
    expect((enable.json() as AgentSkillLink[]).find((l) => l.skill_id === a)?.enabled).toBe(true);

    // Reorder via setSkills — same set of ids, swapped positions. This is
    // exactly the operation that used to silently clear `a`'s enabled flag.
    const reordered = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [b, a] },
    });
    expect(reordered.statusCode).toBe(200);
    const links: AgentSkillLink[] = reordered.json();
    const linkA = links.find((l) => l.skill_id === a);
    const linkB = links.find((l) => l.skill_id === b);

    expect(linkA).toMatchObject({ enabled: true, order: 1 }); // preserved — the regression this guards
    expect(linkB).toMatchObject({ enabled: false, order: 0 });
    await app.close();
  });

  it("PATCH flips one binding's enabled without disturbing its order or any sibling", async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const a = await createSkill(app, 'Skill A');
    const b = await createSkill(app, 'Skill B');
    const c = await createSkill(app, 'Skill C');
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [a, b, c] },
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${b}`,
      payload: { enabled: true },
    });
    expect(patched.statusCode).toBe(200);
    const links: AgentSkillLink[] = patched.json();

    expect(links.find((l) => l.skill_id === a)).toMatchObject({ enabled: false, order: 0 });
    expect(links.find((l) => l.skill_id === b)).toMatchObject({ enabled: true, order: 1 });
    expect(links.find((l) => l.skill_id === c)).toMatchObject({ enabled: false, order: 2 });
    await app.close();
  });

  it('DELETE unlinks one skill, leaving the others untouched', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const a = await createSkill(app, 'Skill A');
    const b = await createSkill(app, 'Skill B');
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [a, b] },
    });

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agentId}/skills/${a}` });
    expect(del.statusCode).toBe(200);
    const links: AgentSkillLink[] = del.json();
    expect(links.find((l) => l.skill_id === a)).toBeUndefined();
    expect(links.find((l) => l.skill_id === b)).toBeDefined();

    const getLinks = await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` });
    expect((getLinks.json() as AgentSkillLink[]).map((l) => l.skill_id)).toEqual([b]);
    await app.close();
  });

  it('a lazily-created link (PATCH on a skill never linked before) defaults to enabled: false', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const a = await createSkill(app, 'Skill A');

    // No prior POST .../skills linking `a` — PATCH must create the link itself.
    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${a}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const link = (res.json() as AgentSkillLink[]).find((l) => l.skill_id === a);
    expect(link).toMatchObject({ enabled: false, order: 0 });
    await app.close();
  });

  it('a lazily-created link honors an explicit enabled: true on first patch', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const a = await createSkill(app, 'Skill A');

    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/skills/${a}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const link = (res.json() as AgentSkillLink[]).find((l) => l.skill_id === a);
    expect(link).toMatchObject({ enabled: true, order: 0 });
    await app.close();
  });

  it('404s when the agent does not exist', async () => {
    const app = await makeApp();
    const a = await createSkill(app, 'Skill A');
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/agents/${ghost}/skills/${a}`,
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/agents/${ghost}/skills/${a}` })).statusCode,
    ).toBe(404);
    await app.close();
  });
});
