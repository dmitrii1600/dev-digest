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

## Tool & Library Notes

## Recurring Errors & Fixes

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

## Open Questions
