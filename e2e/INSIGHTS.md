# Insights — @devdigest/e2e

Flakiness causes, agent-browser quirks, and fixture assumptions that are not
visible from the flow JSON. Cross-package findings go in `../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

- 2026-09-16 — There is no negative text assertion. `wait --text X` waits for X to
  appear; nothing waits for X to be *gone*, so a filter or delete flow cannot
  assert a disappearance directly. Assert a positive consequence instead —
  `08-findings-severity.flow.json` waits for the "Show all findings" control to
  appear — and leave the counting to a component test, which can count rendered
  nodes. Do not approximate it with a sleep plus a screenshot.

## Codebase Patterns

- 2026-09-16 — Flow assertions are strings from `server/src/db/seed.ts`, so a seed
  change breaks flows. Adding a third seeded finding to PR #482 turned
  `wait --text "2 findings"` into a failure at `04-pr-findings.flow.json:13`. The
  coupling is the point — it is what makes these flows assert real data — but it
  means a seed change is not done until the flows are updated.
- 2026-09-16 — `find role button --name "<X>"` needs `<X>` unique on the page. A
  severity pill's active tooltip and the clear-filter link both read "Clear
  severity filter" at first; the fix was giving the link its own string ("Show
  all findings"), which is better for screen readers too. When a flow needs a
  locator the UI cannot provide unambiguously, change the UI — never reach for a
  positional selector.

## Tool & Library Notes

- 2026-09-18 — `agent-browser` is **not** a declared dependency of this package
  (`package.json` lists only tsx/eslint/typescript) — it is an external binary
  expected on `PATH`. On a machine without it, `./scripts/e2e.sh` brings the
  whole hermetic stack up successfully and then every flow fails identically with
  `spawn agent-browser ENOENT`, before any page loads, for a final `0/8 flows
  passed`. That output looks like a total application regression and is not one:
  identical failures across all eight flows at the *first* step is the signature
  of a missing driver, not of broken UI. Verify the app another way (curl the
  routes against a running stack) before believing it.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
