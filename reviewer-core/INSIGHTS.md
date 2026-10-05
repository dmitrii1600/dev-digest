# Insights — @devdigest/reviewer-core

Engine-local facts that are not visible from the code: prompt behaviours we
observed, model quirks, gating decisions and why they hold. Cross-package
findings go in `../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

## Codebase Patterns

- 2026-09-24 — `filterByScope` never drops a `security` or `bug` finding at any severity,
  not only a CRITICAL (`src/review/scope.ts` `NEVER_DESCOPED`). Why: the intent it keys on
  is derived from the author-written PR body, so a non-critical out-of-scope drop of a real
  defect is the goal hijack `INJECTION_GUARD` forbids; `specs/06-intent-layer.md:58,129`
  still says "drops an out_of_scope WARNING/SUGGESTION" — this supersedes it for those two
  categories. Covered by `test/scope.test.ts`.

## Tool & Library Notes

- 2026-10-01 — `OpenRouterProvider` builds its OpenAI client with
  `timeout: 90_000` and `maxRetries: 2` (`src/llm/openrouter.ts:54-55`).
  `req.timeoutMs` is ignored, and `req.maxRetries` controls only schema
  reprompts. A caller timer above 90 s never fires first, because the SDK
  silently re-sends instead, and a call the caller abandons keeps running and
  can be billed twice. Output that is not JSON fails in `parseWithRepair`
  (`src/llm/openrouter.ts:100`) and is thrown as a plain `Error` with no type to
  check.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
