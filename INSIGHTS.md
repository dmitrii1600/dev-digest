# Insights — project-wide

Things that are true but not visible from the code: why a choice was made, what
we tried that did not work, what surprised us. Scope this file to facts that
cross package boundaries; module-local ones go in `<module>/INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `CLAUDE.md`), not a
changelog (that is `git log`).

How to read and append: `/engineering-insights`
(`.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

- 2026-09-15 — On Windows, `pnpm db:migrate` and `pnpm db:seed` exit 0 having
  done **nothing**. Both guard their CLI entrypoint with
  `import.meta.url === \`file://${process.argv[1]}\`` (`server/src/db/migrate.ts:37`,
  `server/src/db/seed.ts:227`), and `argv[1]` is a backslash path
  (`D:\…\migrate.ts`) while `import.meta.url` is `file:///D:/…` — never equal,
  so neither the success nor the failure branch runs. `scripts/dev.sh` and
  `scripts/e2e.sh` call those same scripts, so on Windows the stack boots
  against an unmigrated DB and every route 500s with `relation … does not exist`
  — the exact symptom `CLAUDE.md` blames on a skipped migrate. Fix is
  `pathToFileURL(process.argv[1]).href`; until then bootstrap by importing
  `runMigrations`/`seed` from a script inside `server/`.

## Codebase Patterns

- 2026-09-15 — Unknown cost renders "—", never "$0.00", on every surface. The
  distinction is load-bearing and already baked into the engine: the per-chunk
  sum in `reviewer-core/src/review/run.ts:184` poisons to `null` the moment one
  call reports no cost, rather than under-reporting a total. Anything that
  persists, aggregates or displays cost must preserve that — skip nulls, never
  coerce them to 0.

- 2026-09-15 — `@devdigest/shared` is two physical copies behind one alias
  (`server/src/vendor/shared`, `client/src/vendor/shared`) and they have already
  drifted: the server copy has `openrouter` as a provider id, commit-files
  payloads and newer doc comments. Treat the server copy as canonical and mirror
  a contract change into both in the same commit — a typecheck in one package
  cannot see drift in the other.

- 2026-09-16 — The PR-list row deliberately carries **two** aggregation rules, and
  this is not visible from the screen: `score` + `findings_counts` describe the
  single latest review, `cost_usd` sums every completed run. Each is right for the
  question it answers — "what does the current verdict say" vs "what has this PR
  cost". Before making a fourth column consistent with the others, decide which
  of those two it answers.

## Tool & Library Notes

## Recurring Errors & Fixes

- 2026-09-16 — `28P01 auth_failed` connecting to the dev Postgres from the host on
  Windows: `localhost` resolves to `::1` first, where a WSL relay answers, while
  the container is published on IPv4. The container is fine — `docker exec psql`
  with the same URL succeeds. Use `127.0.0.1` in `DATABASE_URL` for anything run
  against the dev DB from the host.
- 2026-09-16 — `runMigrations` takes a **URL string**, not a `Db`
  (`server/src/db/migrate.ts:19`), while `seed` takes a `Db`. Passing the handle
  to the first yields a confusing `28P01` rather than a type error. This bites
  precisely because the documented Windows workaround is to import both from a
  script — get the argument types right or you will chase a phantom auth problem.

## Session Notes

### 2026-09-15 — run cost badge
Built per-run USD cost end to end (schema → routes → three screens). The engine
was already computing it; the server was dropping it on the floor in one
destructuring line. Two things cost the most time and are recorded above: the
`RunStats` nullish rule (old traces have no `cost_usd` key) and discovering that
`db:migrate`/`db:seed` silently no-op on Windows, which is why the dev DB had no
tables at all rather than merely a missing column.

### 2026-09-15 — where contracts live
Documenting the `CLAUDE.md` set surfaced that the "shared" contracts package is
vendored twice rather than shared. Recorded the canonical-copy rule above so the
next contract change mirrors instead of drifting further.

### 2026-09-16 — findings by severity, and closing the HW-1 criteria
Built the severity counters and filter across three screens, then closed the
grading-criteria gaps around them. Two things cost the most time and are recorded
above: the IPv4/`::1` split that made the dev DB look like an auth failure, and
the `borderColor`-is-a-shorthand rerender warning that only appeared once the
filter made the cards rerender.

Two findings about the audit itself. A `src/`-only grep declared a helper dead
when it had a live test. And the seed is idempotent per-PR, so new fixtures never
reach an already-seeded dev DB — visual verification had to run against a scratch
database rather than the developer's own.

ESLint went in across all four packages and found far less than feared: 7 real
issues on the server (all dead imports or an unused catch binding), 1 in
`reviewer-core`, 0 in `e2e`. The client's 11 remaining warnings are pre-existing
hydration patterns, left visible rather than silenced.

### 2026-09-16 — follow-up: Reject label, timeline previews, collapsed drawer
Four corrections after driving the finished severity UI: renamed Dismiss →
Reject (label only — the action and `dismissed_at` are untouched), seeded a
review per demo run so every timeline row shows icons instead of a word,
collapsed the trace drawer's Findings section, and gave the timeline rows the
same read-only hover preview the PR list has.

The preview work paid for itself twice: extracting `useFindingsPreview` and
`sortBySeverity` meant the timeline reused the PR list's anchor/timer logic
rather than growing a second copy of a timer that must be cleared on unmount.

Half an hour went to a phantom regression — the PR-list popover appeared dead in
screenshots after the refactor. It was not: screenshot coordinates and page
coordinates differ by the zoom factor, so every `hover` was missing the cell. RTL
and a `javascript_tool` DOM check both showed it working. Recorded in
client/INSIGHTS.md; the session also left behind the PRRow hover test that was
missing all along.

## Open Questions
