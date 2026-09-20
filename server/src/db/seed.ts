import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Bodies for the four seeded skills (L02). Genuine prompt content, appended
 * into the "## Skills / rules" section — not placeholders. They follow the
 * same rules as an agent's `system_prompt` (`docs/agent-prompts/README.md`):
 * no description of the JSON output shape, no invented second severity scale.
 */
const PR_QUALITY_RUBRIC_BODY = `# PR Quality Rubric

Judge the change as a whole, not just for bugs. A PR can be defect-free and
still be a bad PR.

- **Scope discipline.** The diff does one thing. A PR that mixes an unrelated
  refactor, a rename, and the actual fix makes both harder to review and to
  revert independently.
- **Self-contained.** Tests, migrations, and doc updates the change requires
  ship in the same PR, not "in a follow-up."
- **Matches existing patterns.** New code follows the conventions already
  established nearby (naming, error handling, layering) rather than
  introducing a second way to do the same thing.
- **No dead weight.** No commented-out code, no leftover debug logging, no
  unused exports or imports left behind by the change.
- **Reversibility.** A risky change (schema, external contract, feature flag)
  can be rolled back without a second deploy — prefer additive changes over
  destructive ones when the two are close in cost.

Use this as a second lens alongside your primary focus area — it does not
replace it.`;

const TEST_COVERAGE_NUDGE_BODY = `# Test Coverage Nudge

Before judging a diff's tests sufficient, check specifically for these gaps —
they are the ones authors miss most often:

- **The failure path.** A new function that can throw, reject, or return an
  error result needs a test that exercises that path, not just the happy
  path.
- **The boundary, not just the middle.** Empty input, a single-item
  collection, the max/min of a range, a zero or negative number where the
  domain allows it.
- **The branch that got smaller.** When a diff narrows or removes a
  condition, check whether the case it used to handle still has a test — a
  passing suite after removing a branch usually means the branch was
  untested, not unnecessary.
- **Concurrent or ordering-sensitive code.** A test that only ever runs one
  call at a time doesn't prove anything about code that assumes ordering,
  retries, or shared state.

A file with new logic and no corresponding test diff is worth naming
explicitly, even when nothing is "wrong" with the code itself.`;

const API_CONTRACT_GATE_BODY = `# API Contract Gate

Treat any request or response shape reachable by an existing caller as a
contract. A change here needs a stated reason, not just a stated diff.

- **Additive is safe; removal is not.** Adding an optional field or a new
  endpoint is low-risk. Removing a field, renaming one, or narrowing a type
  (e.g. \`string | null\` → \`string\`) breaks whoever is already reading it.
- **Nullability is part of the contract.** A field that goes from
  always-present to nullable (or the reverse) changes what every existing
  caller must handle, even if the wire format looks similar.
- **Status codes are contract too.** Returning 200 where the endpoint used to
  return 201, or 404 where it used to return 200 with an empty body, changes
  caller branching logic silently.
- **Route signature changes are breaking by default.** A renamed path param,
  a query param that becomes required, or a changed HTTP method needs a
  version bump or a deprecation window — not a same-version swap.
- **Grep before you assume "nothing calls this."** A route without an
  obvious internal caller may still be called by the client, an external
  integration, or a webhook consumer that isn't in this diff.

When a change here is intentional and versioned correctly, it is not a
finding — the point is to catch the ones that are silent.`;

const NO_THEN_CHAINS_BODY = `# Prefer async/await over .then() chains

This codebase is ESM TypeScript throughout \`server/\` and \`reviewer-core/\` —
write asynchronous code with \`async\`/\`await\`, not chained
\`.then()\`/\`.catch()\`.

- **Flatten the chain.** A \`.then().then().then()\` sequence should read as a
  linear sequence of \`await\` statements inside an \`async\` function. Nesting
  \`.then()\` callbacks (a "pyramid") is worse still.
- **Errors go through try/catch.** A dangling \`.then()\` with no \`.catch()\`
  silently swallows a rejection. Prefer a \`try/catch\` around the \`await\`, or
  let the rejection propagate to a caller that handles it.
- **Mixing styles in one function is a smell.** A function that both
  \`await\`s and returns a \`.then()\` chain is harder to reason about than
  either style alone — pick one, and default to \`await\`.
- **\`Promise.all\` still applies.** Preferring \`await\` doesn't mean
  serializing independent work — use \`await Promise.all([...])\` for
  concurrent operations, not a chain of sequential \`.then()\` calls.

Exception: a thin \`.then()\` used purely to adapt a callback-style API at a
single call site is fine when wrapping it in \`async\`/\`await\` would add no
clarity.`;

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the five built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model. Also seeds four skills (L02)
 * and their bindings onto the two newest agents — see `seedSkills` /
 * `seedSkillLinks` below.
 *
 * Course lessons populate the remaining tables (conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
      {
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 63,
        endLine: 69,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Magic numbers for the bucket refill rate',
        rationale:
          'The refill interval and burst size are inline literals, so the limiter cannot be tuned without a redeploy.',
        suggestion: 'Lift both into named constants or config.',
        confidence: 0.71,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Flags uncovered branches, missing edge cases, over-mocking, and flaky tests.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking route, response-shape, nullability, and status-code changes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- skills (L02) + their agent bindings ----
  // `pr-quality-rubric` is shared by both new reviewers; `test-coverage-nudge`
  // is Test Quality only; `api-contract-gate` is API Contract only.
  // `no-then-chains` stands in for the "imported from a file" path: source
  // isn't 'manual', so per the feature's rule it is seeded disabled at both
  // the skill level and the per-binding level — the "needs vetting" example.
  const seedSkills: Array<typeof t.skills.$inferInsert> = [
    {
      workspaceId,
      name: 'pr-quality-rubric',
      description: 'General PR quality checklist: scope, self-containment, and reversibility.',
      type: 'rubric',
      source: 'manual',
      body: PR_QUALITY_RUBRIC_BODY,
      enabled: true,
    },
    {
      workspaceId,
      name: 'test-coverage-nudge',
      description: 'Where authors usually under-test: failure paths, boundaries, narrowed branches.',
      type: 'rubric',
      source: 'manual',
      body: TEST_COVERAGE_NUDGE_BODY,
      enabled: true,
    },
    {
      workspaceId,
      name: 'api-contract-gate',
      description: 'What counts as a breaking API change and when it needs a version bump.',
      type: 'convention',
      source: 'manual',
      body: API_CONTRACT_GATE_BODY,
      enabled: true,
    },
    {
      workspaceId,
      name: 'no-then-chains',
      description: 'Imported convention: prefer async/await over chained .then() calls.',
      type: 'convention',
      source: 'imported_file',
      body: NO_THEN_CHAINS_BODY,
      enabled: false, // source !== 'manual' arrives disabled until vetted
    },
  ];
  const skillIdByName = new Map<string, string>();
  for (const s of seedSkills) {
    let [existing] = await db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!existing) {
      [existing] = await db.insert(t.skills).values(s).returning({ id: t.skills.id });
    }
    skillIdByName.set(s.name, existing!.id);
    // The v1 snapshot the repository writes on POST /skills. Seeding inserts
    // rows directly, so without this a seeded skill claims version 1 while
    // GET /skills/:id/versions returns nothing — an empty history the studio
    // can neither diff nor restore from.
    await db
      .insert(t.skillVersions)
      .values({ skillId: existing!.id, version: 1, body: s.body, note: null })
      .onConflictDoNothing();
  }

  const reviewerAgentRows = await db
    .select({ id: t.agents.id, name: t.agents.name })
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));
  const agentIdByName = new Map(reviewerAgentRows.map((a) => [a.name, a.id]));

  const seedSkillLinks: { agent: string; skill: string; order: number; enabled: boolean }[] = [
    { agent: 'Test Quality Reviewer', skill: 'pr-quality-rubric', order: 0, enabled: true },
    { agent: 'Test Quality Reviewer', skill: 'test-coverage-nudge', order: 1, enabled: true },
    { agent: 'Test Quality Reviewer', skill: 'no-then-chains', order: 2, enabled: false },
    { agent: 'API Contract Reviewer', skill: 'pr-quality-rubric', order: 0, enabled: true },
    { agent: 'API Contract Reviewer', skill: 'api-contract-gate', order: 1, enabled: true },
  ];
  for (const link of seedSkillLinks) {
    const agentId = agentIdByName.get(link.agent);
    const skillId = skillIdByName.get(link.skill);
    if (!agentId || !skillId) continue;
    const [existing] = await db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
    if (!existing) {
      await db.insert(t.agentSkills).values({
        agentId,
        skillId,
        order: link.order,
        enabled: link.enabled,
      });
    }
  }

  // ---- demo agent runs for PR #482 (+ their traces) ----
  // Without these the run timeline, the trace drawer and the PR list's COST
  // column are all empty on a fresh clone. The last entry deliberately reports
  // NO cost: it is the fixture for the "—" branch (unknown ≠ free).
  const [anyRun] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.prId, pr!.id));
  if (!anyRun) {
    const agentRows = await db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    const byName = new Map(agentRows.map((a) => [a.name, a.id]));

    /** A finding to seed alongside a demo run, minus the ids the loop fills in. */
    type DemoFinding = {
      file: string;
      startLine: number;
      endLine: number;
      severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
      category: string;
      title: string;
      rationale: string;
      suggestion?: string;
      confidence: number;
    };

    const demoRuns: {
      agent: string;
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number | null;
      findings: number;
      blockers: number;
      score: number;
      grounding: string;
      minutesAgo: number;
      /** Verdict + findings for a review created for this run. Omitted for the
       *  Security Reviewer, which adopts the standalone seeded review instead. */
      review?: { verdict: string; summary: string; findings: DemoFinding[] };
    }[] = [
      {
        agent: 'Security Reviewer',
        durationMs: 8200,
        tokensIn: 7891,
        tokensOut: 1228,
        costUsd: 0.0013,
        // Matches the seeded review this run is linked to below: 3 findings,
        // one of them CRITICAL. Keeping them in step is what lets the timeline
        // row, the Review-runs card and the PR list all show the same numbers.
        findings: 3,
        blockers: 1,
        score: 61,
        grounding: '3/3 passed',
        minutesAgo: 12,
      },
      {
        agent: 'Performance Reviewer',
        durationMs: 6400,
        tokensIn: 10460,
        tokensOut: 1551,
        costUsd: 0.0014,
        findings: 2,
        blockers: 0,
        score: 64,
        grounding: '2/2 passed',
        minutesAgo: 18,
        review: {
          verdict: 'comment',
          summary:
            'The limiter itself is sound, but it adds a synchronous Redis round-trip to every public request and the user-list query it guards is unbounded.',
          findings: [
            {
              file: 'src/middleware/ratelimit.ts',
              startLine: 28,
              endLine: 34,
              severity: 'WARNING',
              category: 'perf',
              title: 'Redis round-trip on every request, including cache hits',
              rationale:
                'The token check awaits Redis before the handler runs, so a burst of cheap reads pays full network latency each time.',
              suggestion: 'Keep a short-lived in-process bucket and reconcile with Redis asynchronously.',
              confidence: 0.82,
            },
            {
              file: 'src/api/users.ts',
              startLine: 12,
              endLine: 18,
              severity: 'SUGGESTION',
              category: 'perf',
              title: 'User list has no upper bound on page size',
              rationale:
                'The endpoint honours any `limit` the caller sends, so one request can pull the whole table past the new limiter.',
              suggestion: 'Clamp `limit` to a sane maximum.',
              confidence: 0.68,
            },
          ],
        },
      },
      {
        agent: 'General Reviewer',
        durationMs: 5100,
        tokensIn: 6204,
        tokensOut: 988,
        costUsd: null, // provider returned no usage → the UI must show "—"
        findings: 1,
        blockers: 0,
        score: 72,
        grounding: '1/1 passed',
        minutesAgo: 24,
        review: {
          verdict: 'comment',
          summary:
            'Reads clearly and the middleware is well placed. One naming nit in the webhook handler.',
          findings: [
            {
              file: 'src/api/public/webhooks.ts',
              startLine: 61,
              endLine: 74,
              severity: 'SUGGESTION',
              category: 'style',
              title: 'Handler name says "process", body only validates',
              rationale:
                'processWebhook() validates the payload and enqueues it; the name promises work it does not do, which is how the retry path got misread.',
              suggestion: 'Rename to enqueueWebhook().',
              confidence: 0.64,
            },
          ],
        },
      },
    ];

    // The seeded review has no run of its own (it predates the timeline), so the
    // severity icons on the timeline and the Review-runs card would have nothing
    // to read. Adopt it into the Security Reviewer run below.
    const [seededReview] = await db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, pr!.id), eq(t.reviews.kind, 'review')));

    for (const r of demoRuns) {
      const agentId = byName.get(r.agent) ?? null;
      const ranAt = new Date(Date.now() - r.minutesAgo * 60_000);
      const [run] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId,
          prId: pr!.id,
          ranAt,
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
          durationMs: r.durationMs,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costUsd: r.costUsd,
          status: 'done',
          source: 'local',
          findingsCount: r.findings,
          grounding: r.grounding,
          score: r.score,
          blockers: r.blockers,
        })
        .returning({ id: t.agentRuns.id });

      if (r.agent === 'Security Reviewer' && seededReview) {
        await db
          .update(t.reviews)
          .set({ runId: run!.id, agentId })
          .where(eq(t.reviews.id, seededReview.id));
      } else if (r.review) {
        // A review per run, so every timeline row has severity icons and a
        // hover preview instead of a bare "N finding(s)". `createdAt` is the
        // run's own `ranAt`, NOT now(): the PR list takes the LATEST review
        // (modules/pulls/routes.ts), and defaulting to now() would let the
        // oldest run win and change the FINDINGS column.
        const [review] = await db
          .insert(t.reviews)
          .values({
            workspaceId,
            prId: pr!.id,
            agentId,
            runId: run!.id,
            kind: 'review',
            verdict: r.review.verdict,
            summary: r.review.summary,
            score: r.score,
            model: DEFAULT_MODEL,
            createdAt: ranAt,
          })
          .returning({ id: t.reviews.id });

        await db.insert(t.findings).values(
          r.review.findings.map((f) => ({
            reviewId: review!.id,
            file: f.file,
            startLine: f.startLine,
            endLine: f.endLine,
            severity: f.severity,
            category: f.category,
            title: f.title,
            rationale: f.rationale,
            suggestion: f.suggestion ?? null,
            confidence: f.confidence,
          })),
        );
      }

      await db.insert(t.runTraces).values({
        runId: run!.id,
        trace: {
          config: {
            agent: r.agent,
            version: '1',
            provider: DEFAULT_PROVIDER,
            model: DEFAULT_MODEL,
            pr: 482,
            source: 'local',
          },
          stats: {
            duration_ms: r.durationMs,
            tokens_in: r.tokensIn,
            tokens_out: r.tokensOut,
            cost_usd: r.costUsd,
            findings: r.findings,
            grounding: r.grounding,
          },
          prompt_assembly: {
            system: `${r.agent} — seeded demo prompt.`,
            user: 'Review the following diff for PR #482.',
          },
          tool_calls: [
            { tool: 'review_file', args: 'src/middleware/ratelimit.ts', meta: 'single-pass', ms: r.durationMs },
          ],
          raw_output: '{"verdict":"request_changes","findings":[]}',
          memory_pulled: [],
          specs_read: [],
          log: [
            { t: '00.00', kind: 'info', msg: 'Seeded demo run' },
            { t: '00.01', kind: 'result', msg: `${r.findings} finding(s) after grounding` },
          ],
        },
      });
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
