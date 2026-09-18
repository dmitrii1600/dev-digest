# Insights — @devdigest/api

Server-local facts that are not visible from the code: why a choice was made,
what we tried that did not work, what surprised us. Cross-package findings go in
`../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `CLAUDE.md`).

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

- 2026-09-16 — A demo run with a denormalized `findingsCount` but no `reviews`
  row makes the UI look broken for a data reason. Two of the three seeded runs in
  `src/db/seed.ts` had counts and no review, so `RunSummary.findings_counts` came
  back null and the timeline printed "2 finding(s)" where the other row showed
  severity icons — which reads as a rendering bug and is not one. Seed a review
  per demo run, and keep its `findingsCount`/`blockers`/`score` equal to that
  review's, or the timeline row and the card below it disagree.

## Codebase Patterns

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

## Tool & Library Notes

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
  Linux CI is unaffected. Ignore it locally; do not chase it as your change.

## Session Notes

## Open Questions
