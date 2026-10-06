import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

/** The eval seed behind `/eval` and e2e flow 17: idempotent, agent-owned, with the v-current snapshot. */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[seed-eval] Docker not available — skipping integration tests.');
}

const NAMES = ['General Reviewer', 'Security Reviewer'];

d('Eval seed (Testcontainers pg)', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('seeds two agents once: 4 cases, 8 suite runs, a version snapshot each, all agent-owned', async () => {
    const db = pg.handle.db;
    await seed(db);
    await seed(db);

    const agents = await db.select().from(t.agents).where(inArray(t.agents.name, NAMES));
    expect(agents).toHaveLength(2);
    const ids = agents.map((a) => a.id);

    const cases = await db.select().from(t.evalCases).where(inArray(t.evalCases.ownerId, ids));
    expect(cases).toHaveLength(4);
    expect(cases.every((c) => c.ownerKind === 'agent' && c.source === 'manual')).toBe(true);

    const runs = await db.select().from(t.evalRuns).where(inArray(t.evalRuns.agentId, ids));
    expect(runs).toHaveLength(8);
    expect(
      runs.every(
        (r) =>
          r.ownerKind === 'agent' &&
          r.ownerId === r.agentId &&
          r.kind === 'suite' &&
          r.status === 'completed' &&
          r.singleCaseId === null,
      ),
    ).toBe(true);
    // One chart gap and one unknown cost per agent.
    expect(runs.filter((r) => r.precision === null)).toHaveLength(2);
    expect(runs.filter((r) => r.costUsd === null)).toHaveLength(2);

    for (const a of agents) {
      const [v] = await db
        .select()
        .from(t.agentVersions)
        .where(and(eq(t.agentVersions.agentId, a.id), eq(t.agentVersions.version, a.version)));
      expect(v).toBeDefined();
    }
  });
});
