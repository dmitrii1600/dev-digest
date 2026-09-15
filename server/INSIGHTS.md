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

## Tool & Library Notes

## Recurring Errors & Fixes

- 2026-09-15 — `pnpm exec vitest run --exclude '**/*.it.test.ts'` fails 6 tests
  in `test/indexer-pipeline.test.ts` on Windows with `ENOENT … \src\a.ts`. Not a
  regression: the helper does `full.lastIndexOf('/')` on a path `join()` built
  with backslashes, so it never creates the parent dir (`test/indexer-pipeline.test.ts:142`).
  Linux CI is unaffected. Ignore it locally; do not chase it as your change.

## Session Notes

## Open Questions
