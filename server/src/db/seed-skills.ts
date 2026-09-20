/**
 * Seeded skills (L02) and their agent bindings. Bodies live here, next to
 * `seed-prompts.ts`, so `seed.ts` stays a wiring file.
 *
 * A skill body is prompt text — it is appended to the user message — so it
 * obeys the same rules as an agent's `system_prompt`
 * (`docs/agent-prompts/README.md`): no description of the JSON output shape,
 * no invented second severity scale. Each API Contract skill carries a
 * directive description and a Good / Bad pair (lab criterion 43).
 */

import type { SkillSource, SkillType } from '@devdigest/shared';

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
}

export interface SeedSkillLink {
  agent: string;
  skill: string;
  order: number;
  enabled: boolean;
}

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

// ---- API Contract Reviewer's four skills (criterion 43) ----

const BREAKING_CHANGE_BODY = `# Breaking change

Flag any change that makes an EXISTING caller fail at runtime or at the type
level: a removed or renamed field or route, a narrowed type, a new required
input, a changed status code, a changed HTTP method. Additive changes — a new
optional field, a new endpoint — are not breaking.

Ask of every contract touched by the diff: "does a caller written against
yesterday's shape still work today?" If the answer is no and the change ships
under the same route and version, report it.

**Good** — additive, callers keep working:

\`\`\`ts
export const Repo = z.object({
  id: z.string(),
  full_name: z.string(),
  last_polled_at: z.string().nullish(), // new, optional
});
\`\`\`

**Bad** — a field renamed and a type narrowed in one move:

\`\`\`ts
export const Repo = z.object({
  id: z.string(),
  fullName: z.string(),        // was full_name — every reader of full_name breaks
  last_polled_at: z.string(),  // was nullish — a null now fails validation
});
\`\`\``;

const RESPONSE_SCHEMA_BODY = `# Response schema

Every response shape is a shared Zod contract in \`@devdigest/shared\` and is
declared on the route, so the same definition validates the request and
serializes the response. Flag a route that returns fields its contract does
not declare (they are silently stripped on the wire), a handler that builds a
response shape inline instead of through a contract, and a contract change
that is not mirrored into the client copy of the shared package.

**Good** — the handler returns exactly what the contract says:

\`\`\`ts
app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
  const skill = await service.get(workspaceId, req.params.id); // → Skill
  if (!skill) throw new NotFoundError('Skill not found');
  return skill;
});
\`\`\`

**Bad** — an undeclared field the client will never see, and an ad-hoc shape:

\`\`\`ts
app.get('/skills/:id', async (req) => {
  const row = await db.select().from(skills).where(eq(skills.id, req.params.id));
  return { ...row, internal_score: 0.42 }; // not in Skill; not a contract at all
});
\`\`\``;

const SEMVER_DISCIPLINE_BODY = `# Semver discipline

A breaking change needs a major bump or a new versioned route; an additive
change needs a minor bump; a fix that changes no shape is a patch. Flag a
breaking change shipped as a patch or a minor, a versioned route whose old
version silently changed behaviour, and a package version that did not move
when its public contract did.

**Good** — the old shape stays reachable while the new one is introduced:

\`\`\`ts
app.get('/v1/reviews/:id', …);   // unchanged
app.get('/v2/reviews/:id', …);   // returns findings grouped by severity
\`\`\`

**Bad** — same route, same version, different shape:

\`\`\`ts
// package.json: "version": "1.4.2"  (was 1.4.1)
app.get('/v1/reviews/:id', …);   // now returns { groups: … } instead of { findings: … }
\`\`\``;

const DEPRECATION_POLICY_BODY = `# Deprecation policy

Nothing public is removed without a deprecation window. Flag a removal of a
route, field or option that was not previously marked \`@deprecated\` with a
sunset date and a named replacement, and a deprecation that names no
replacement at all. A removal that follows a completed window is not a
finding — say so in the summary.

**Good** — marked, dated, replacement named, then removed one window later:

\`\`\`ts
/**
 * @deprecated since 1.4 — use \`findings_counts\` instead. Removed after 2026-12-01.
 */
findings_count: z.number().int().nullish(),
\`\`\`

**Bad** — gone in the same diff that introduced its replacement:

\`\`\`ts
-  findings_count: z.number().int(),
+  findings_counts: FindingsCounts,
\`\`\``;

// ---- Registry ----

/**
 * `no-then-chains` stands in for the "imported from a file" path: source is not
 * \`manual\`, so per the feature's rule it is seeded disabled at both the skill
 * level and the per-binding level — the "needs vetting" example. The four
 * API Contract skills replace the earlier \`api-contract-gate\` (its content is
 * split across breaking-change and semver-discipline); an already-seeded
 * database keeps its old row because the seed never deletes.
 */
export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    description: 'General PR quality checklist: scope, self-containment, and reversibility.',
    type: 'rubric',
    source: 'manual',
    body: PR_QUALITY_RUBRIC_BODY,
    enabled: true,
  },
  {
    name: 'test-coverage-nudge',
    description: 'Where authors usually under-test: failure paths, boundaries, narrowed branches.',
    type: 'rubric',
    source: 'manual',
    body: TEST_COVERAGE_NUDGE_BODY,
    enabled: true,
  },
  {
    name: 'breaking-change',
    description:
      'Flag any change that makes an existing caller fail: removed or renamed field or route, narrowed type, new required input, changed status code.',
    type: 'convention',
    source: 'manual',
    body: BREAKING_CHANGE_BODY,
    enabled: true,
  },
  {
    name: 'response-schema',
    description:
      'Every response shape is a shared Zod contract; flag a route returning undeclared fields or a contract change not mirrored to the client copy.',
    type: 'convention',
    source: 'manual',
    body: RESPONSE_SCHEMA_BODY,
    enabled: true,
  },
  {
    name: 'semver-discipline',
    description:
      'A breaking change needs a major bump or a versioned route, additive needs minor; flag a breaking change shipped as a patch.',
    type: 'convention',
    source: 'manual',
    body: SEMVER_DISCIPLINE_BODY,
    enabled: true,
  },
  {
    name: 'deprecation-policy',
    description:
      'Nothing is removed without a deprecation window: flag a removal with no prior @deprecated marker, sunset date and named replacement.',
    type: 'convention',
    source: 'manual',
    body: DEPRECATION_POLICY_BODY,
    enabled: true,
  },
  {
    name: 'no-then-chains',
    description: 'Imported convention: prefer async/await over chained .then() calls.',
    type: 'convention',
    source: 'imported_file',
    body: NO_THEN_CHAINS_BODY,
    enabled: false, // source !== 'manual' arrives disabled until vetted
  },
];

export const SEED_SKILL_LINKS: SeedSkillLink[] = [
  { agent: 'Test Quality Reviewer', skill: 'pr-quality-rubric', order: 0, enabled: true },
  { agent: 'Test Quality Reviewer', skill: 'test-coverage-nudge', order: 1, enabled: true },
  { agent: 'Test Quality Reviewer', skill: 'no-then-chains', order: 2, enabled: false },
  { agent: 'API Contract Reviewer', skill: 'pr-quality-rubric', order: 0, enabled: true },
  { agent: 'API Contract Reviewer', skill: 'breaking-change', order: 1, enabled: true },
  { agent: 'API Contract Reviewer', skill: 'response-schema', order: 2, enabled: true },
  { agent: 'API Contract Reviewer', skill: 'semver-discipline', order: 3, enabled: true },
  { agent: 'API Contract Reviewer', skill: 'deprecation-policy', order: 4, enabled: true },
];
