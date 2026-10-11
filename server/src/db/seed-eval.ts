import { and, eq } from 'drizzle-orm';
import { caseFingerprint } from '../modules/evals/helpers.js';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * Demo eval data (L06) so `/eval` has history on a fresh clone and the e2e flow
 * `17-eval-run-controls` can switch agents, change the time window and reload
 * without a model call: per agent two manual cases and four completed suite runs.
 *
 * `db/**` is ring 3 and may import `modules/**` (the `seed-brief.ts` precedent), so the
 * case fingerprint reuses the one the service computes. Seeded agents are inserted raw by
 * `seed.ts` and have no `agent_versions` row; Compare and Promote read that snapshot, so it is
 * written here (`onConflictDoNothing`) for the agents this seed gives runs to.
 *
 * Idempotent: an agent that already owns eval cases is skipped.
 */
const AGENTS = ['General Reviewer', 'Security Reviewer'] as const;

const FILE = 'src/config.ts';
const HEAD = `--- a/${FILE}\n+++ b/${FILE}\n@@ -10,3 +10,4 @@\n   port: 3000,\n`;
const DIFF = `${HEAD}+  stripeKey: "sk_live_xxx",\n   redisUrl: x,`;
const PR_TITLE = 'Add payment and cache config';
const PR_BODY = 'Adds the Stripe key and the Redis URL to the service config.';

const CASES = [
  { name: 'Flags the committed live key', expectation: 'must_find' as const },
  { name: 'Leaves the Redis URL alone', expectation: 'must_not_flag' as const },
];

const DAY_MS = 86_400_000;

/** Four finished suite runs, oldest first. One has no precision (the chart gap), one no cost. */
const RUNS = [
  { daysAgo: 60, recall: 0.5, precision: 0.5, citation: 0.8, passed: 1, costUsd: null as number | null },
  { daysAgo: 20, recall: 0.5, precision: null as number | null, citation: 0.9, passed: 1, costUsd: 0.0021 },
  { daysAgo: 3, recall: 1, precision: 0.75, citation: 1, passed: 2, costUsd: 0.0024 },
  { daysAgo: 1, recall: 1, precision: 1, citation: 1, passed: 2, costUsd: 0.0023 },
];

export async function seedEval(db: Db, workspaceId: string): Promise<void> {
  for (const name of AGENTS) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, name)));
    if (!agent) continue;

    const [owned] = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agent.id)))
      .limit(1);
    if (owned) continue;

    // The snapshot of the agent's current version, as `AgentsRepository.snapshotVersion` writes it.
    const links = await db
      .select({ skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id))
      .orderBy(t.agentSkills.order);
    await db
      .insert(t.agentVersions)
      .values({
        agentId: agent.id,
        version: agent.version,
        configJson: {
          provider: agent.provider,
          model: agent.model,
          system_prompt: agent.systemPrompt,
          output_schema: agent.outputSchema,
          strategy: agent.strategy,
          ci_fail_on: agent.ciFailOn,
          repo_intel: agent.repoIntel,
          skills: links.map((l) => l.skillId),
        },
      })
      .onConflictDoNothing();

    await db.insert(t.evalCases).values(
      CASES.map((c) => ({
        workspaceId,
        ownerKind: 'agent' as const,
        ownerId: agent.id,
        name: c.name,
        inputDiff: DIFF,
        inputMeta: { pr_title: PR_TITLE, pr_body: PR_BODY },
        expectedOutput: { title: null, severity: null, category: null },
        source: 'manual' as const,
        sourceFindingId: null,
        expectation: c.expectation,
        targetFile: FILE,
        targetStartLine: 11,
        targetEndLine: 11,
        fingerprint: caseFingerprint({
          input_diff: DIFF,
          pr_title: PR_TITLE,
          pr_body: PR_BODY,
          expectation: c.expectation,
          file: FILE,
          start_line: 11,
          end_line: 11,
        }),
      })),
    );

    const now = Date.now();
    await db.insert(t.evalRuns).values(
      RUNS.map((r) => {
        const ranAt = new Date(now - r.daysAgo * DAY_MS);
        return {
          workspaceId,
          kind: 'suite' as const,
          ownerKind: 'agent' as const,
          ownerId: agent.id,
          agentId: agent.id,
          agentVersion: agent.version,
          provider: agent.provider,
          model: agent.model,
          status: 'completed' as const,
          skills: [],
          caseRefs: [],
          singleCaseId: null,
          casesTotal: CASES.length,
          casesPassed: r.passed,
          casesErrored: 0,
          ranAt,
          finishedAt: new Date(ranAt.getTime() + 9_000),
          recall: r.recall,
          precision: r.precision,
          citationAccuracy: r.citation,
          durationMs: 9_000,
          costUsd: r.costUsd,
        };
      }),
    );
  }
}
