# Insights — @devdigest/api

Server-local facts that are not visible from the code: why a choice was made,
what we tried that did not work, what surprised us. Cross-package findings go in
`../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

- 2026-09-15 — Do not add a required field to `RunStats`, even a nullable one.
  `run_traces.trace` already holds documents written before the field existed;
  `z.number().nullable()` makes the key mandatory and every pre-existing trace
  stops parsing, breaking the drawer on read. Use `.nullish()`
  (`src/vendor/shared/contracts/trace.ts:61`). `RunSummary` has no such history
  — it is built per-request from columns, so `.nullable()` is fine there
  (`:97`).

- 2026-09-16 — "Zero call sites" from a `src/`-only grep is not dead code.
  `rollupSeverities` looked unused repo-wide but had a live unit test
  (`test/pulls-status.test.ts`), so reshaping its return keys broke the suite.
  Grep `test/` too before changing a helper's contract.

- 2026-09-18 — ESLint cannot police the innermost rings: `src/vendor/**` is in
  `ignores` (`eslint.config.mjs:20`), so no `no-restricted-imports` zone ever
  fires on the Zod contracts or on `vendor/shared/adapters.ts`, where the ports
  live. That is why the `contract-stays-pure` / `port-stays-pure` rules had to go
  into `.dependency-cruiser.cjs` instead. Do not "fix" it by un-ignoring a
  vendored tree.

- 2026-09-16 — A demo run with a denormalized `findingsCount` but no `reviews`
  row makes the UI look broken for a data reason. Two of the three seeded runs in
  `src/db/seed.ts` had counts and no review, so `RunSummary.findings_counts` came
  back null and the timeline printed "2 finding(s)" where the other row showed
  severity icons — which reads as a rendering bug and is not one. Seed a review
  per demo run, and keep its `findingsCount`/`blockers`/`score` equal to that
  review's, or the timeline row and the card below it disagree.

- 2026-09-20 — The seed inserts into `t.skills` directly rather than through
  `SkillsRepository.insert()`, so it wrote no `skill_versions` row and every
  seeded skill claimed `version: 1` while `GET /skills/:id/versions` returned
  `[]` — a history the studio can neither diff nor restore from, on a DB that
  looks correctly seeded. Fixed by writing the v1 snapshot in the seed loop
  (`src/db/seed.ts:419`). The general rule: when a table has a companion history
  table that only the repository maintains, seeding past the repository silently
  drops the history — seed both or go through the repository.

## Codebase Patterns

- 2026-09-18 — An onion ring is derived from the **filename**, not a folder:
  `service.ts` / `helpers.ts` / `constants.ts` are ring 2, `repository.ts` is
  ring 3, `routes.ts` is ring 4, and the lint zones are globs over exactly those
  names (`eslint.config.mjs`). The consequence is a silent opt-out — a file with
  an unconventional name matches no zone and no rule applies to it, which is how
  `modules/settings/feature-models.ts:1` still imports `drizzle-orm`. Name a new
  file conventionally even when it is small, or it leaves the architecture.
- 2026-09-18 — `platform/container.ts` is the **composition root**, so it is the
  one file in `platform/` allowed to import `modules/**` (`container.ts:26-29`);
  every other platform file importing a feature is an inverted dependency and
  `pnpm arch` rejects it. The rings, the eleven rules and the grandfathered
  violation list are in `.claude/skills/onion-architecture/`.

- 2026-09-15 — Per-PR cost on the list is the newest `done` run **per agent**,
  summed — dedupe key `prId:agentId`, not just the single newest run
  (`src/modules/pulls/routes.ts:132`). Re-running one agent then replaces only
  that agent's share instead of collapsing the column to one run's price. A run
  with unknown cost is skipped, never added as 0, so a PR whose runs all lack
  usage stays `null` → "—".
- 2026-09-15 — A failed/cancelled run stores `costUsd: null`, not `0`
  (`src/modules/reviews/run-executor.ts:301`). Zero would read as "this was
  free"; null reads as "no verdict, no meaningful spend".

- 2026-09-16 — **Supersedes the 2026-09-15 per-agent cost note.** Per-PR cost is
  now **every** `status='done'` run, summed — no dedupe key at all
  (`src/modules/pulls/routes.ts:137`). The column answers "what has this PR
  cost", not "what does the current verdict cost", so a re-run adds rather than
  replaces. The null-skip is unchanged: unknown is still never added as 0.
- 2026-09-16 — `score` and `findings_counts` are read off the **same** review row
  and share one map (`src/modules/pulls/routes.ts:119`), while `cost_usd` uses a
  different rule entirely. Deliberate: the ring and the severity chips in a row
  must describe one population or they contradict each other on screen. A new
  column needing "the latest review" should reuse `latestReviewByPr` — a second
  lookup is how two rules drift into one row.

- 2026-09-16 — A seeded review's `createdAt` must be its run's `ranAt`, not the
  default `now()` (`src/db/seed.ts`). The PR list reports the **latest** review
  (`src/modules/pulls/routes.ts:119`), so three reviews inserted in a loop all
  stamped `now()` would hand the column to whichever ran last in the loop — the
  oldest run — and silently change the FINDINGS and SCORE cells.

- 2026-09-18 — Postgres does **not** index a foreign key column; only PKs and
  UNIQUE get an index for free. This schema had 51 `references()` against 11
  `index()` declarations, and the split was not random: the repo-intel and
  context tables were indexed, while `runs.ts`, `reviews.ts` and `agents.ts` —
  the tables every screen reads — had **zero**. Two costs, both invisible until
  the data grows: `ON DELETE CASCADE` on an unindexed child seq-scans it once per
  deleted parent row, and `findings` for a review was a seq scan on the product's
  hottest join (`modules/reviews/repository/run.repo.ts:62`). Migration `0011`
  adds the 12 that a real query or a cascade asks for. When adding a table, an FK
  needs a deliberate yes/no on an index — the default is no index.

## Tool & Library Notes

- 2026-09-18 — `no-restricted-imports` matches the **import specifier as
  written**, never a resolved path — so one `{ group: ['**/db/schema*'] }` entry
  catches `'../../db/schema.js'` from any depth (`eslint.config.mjs:37`). That is
  what makes the onion ring zones work with zero new dependencies;
  `eslint-plugin-boundaries` was not needed.
- 2026-09-18 — dependency-cruiser's `tsPreCompilationDeps` defaults to **false**,
  which drops every `import type` edge. That is why `no-circular` passes despite
  `platform/container.ts:26-29` importing `modules/**` while those modules import
  `Container` back — the return edge is type-only and erased at compile time.
  Flip that flag and the whole codebase reports as cyclic
  (`.dependency-cruiser.cjs`).
- 2026-09-18 — A `.cjs` file at the package root is linted by the flat config and
  fails `no-undef` on `module`, because the config is ESM. It needs its own block
  with `languageOptions.sourceType: 'commonjs'` and the node globals
  (`eslint.config.mjs`). Cost one red `pnpm lint` on an otherwise-green change.

- 2026-09-16 — ESLint is configured per package (flat config, `eslint.config.mjs`),
  never shared — this is not a monorepo. The server enables `no-console`
  deliberately (pino is the logger) and exempts the two CLI entrypoints,
  `src/db/migrate.ts` and `src/db/seed.ts` (`eslint.config.mjs:46`). That is what
  makes the pre-existing `// eslint-disable-next-line no-console` markers in
  `test/` mean something instead of being reported as unused directives.

## Recurring Errors & Fixes

- 2026-09-15 — `pnpm exec vitest run --exclude '**/*.it.test.ts'` fails 6 tests
  in `test/indexer-pipeline.test.ts` on Windows with `ENOENT … \src\a.ts`. Not a
  regression: the helper does `full.lastIndexOf('/')` on a path `join()` built
  with backslashes, so it never creates the parent dir (`test/indexer-pipeline.test.ts:142`).
  Linux CI is unaffected. **Fixed 2026-09-18** — both helpers now use
  `dirname(full)`; the suite is 103/103 on Windows, so a failure here is once
  again a real signal and should be chased. The same `lastIndexOf('/')` sat in
  `test/indexer-walk.test.ts:20` and *passed*: with no `/` found, `slice(0, -1)`
  produced a path one character short, and `mkdir -p` on that happened to create
  the real parent as a side effect. A latent bug that silently works is why the
  fix went into both files rather than only the failing one.

## Session Notes

## Open Questions
