/**
 * `pr_brief.json` is one document with one top-level key per writer: the PR brief
 * owns `brief`, Prior PRs owns `history`. `BlastRepository.upsertHistory` must be a
 * single atomic `||` merge so neither writer clobbers the other, and two concurrent
 * first writes must both succeed (EC-11).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { BlastRepository } from '../src/modules/blast/repository.js';
import type { PrHistoryItem } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const ITEM: PrHistoryItem = {
  pr_number: 7,
  title: 'Earlier change',
  merged_at: '2026-03-18T00:00:00Z',
  author: 'marisa.koch',
  files_overlap: ['src/a.ts'],
  notes: 'Touched 1 of this PR files.',
};

let seq = 0;

d('pr_brief atomic merge (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'merge', fullName: 'acme/merge' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function newPr(): Promise<string> {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1000 + seq++,
        title: 'merge test',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'deadbeef',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'open',
      })
      .returning();
    return pr!.id;
  }

  const rows = (prId: string) =>
    pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));

  it('keeps a stored `brief` key when history is written', async () => {
    const prId = await newPr();
    await pg.handle.db.insert(t.prBrief).values({ prId, json: { brief: { summary: 'X' } } });

    await new BlastRepository(pg.handle.db).upsertHistory(prId, 'sha1', [ITEM]);

    const [row] = await rows(prId);
    expect(row!.json).toEqual({
      brief: { summary: 'X' },
      history: { computed_for_sha: 'sha1', history: [ITEM] },
    });
  });

  it('creates `{ history }` when there is no row yet', async () => {
    const prId = await newPr();

    await new BlastRepository(pg.handle.db).upsertHistory(prId, 'sha1', [ITEM]);

    const [row] = await rows(prId);
    expect(row!.json).toEqual({ history: { computed_for_sha: 'sha1', history: [ITEM] } });
  });

  it('two concurrent first writes both succeed and leave one row', async () => {
    const prId = await newPr();
    const repo = new BlastRepository(pg.handle.db);

    await Promise.all([
      repo.upsertHistory(prId, 'sha1', [ITEM]),
      repo.upsertHistory(prId, 'sha2', []),
    ]);

    const all = await rows(prId);
    expect(all).toHaveLength(1);
    expect(Object.keys(all[0]!.json as object)).toEqual(['history']);
  });
});
