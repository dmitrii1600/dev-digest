# Insights — @devdigest/web

Client-local facts that are not visible from the code: why a choice was made,
what we tried that did not work, what surprised us. Cross-package findings go in
`../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `CLAUDE.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

## What Doesn't Work

- 2026-09-15 — The PR-list header right-aligned its last column by index
  (`i === COLUMN_KEYS.length - 1`), so inserting any column before `updated`
  silently left the new one left-aligned while the rows' cell was right-aligned.
  Replaced with an explicit key set, `RIGHT_ALIGNED_COLUMNS`
  (`src/app/repos/[repoId]/pulls/constants.ts:56`). Adding a column means
  editing three things in step: `GRID`, `COLUMN_KEYS`, and the cell in `PRRow`.

## Codebase Patterns

- 2026-09-15 — There are two token formatters and they are not interchangeable:
  `formatTokens(in, out)` → `"8k→1.2k"` for the trace drawer
  (`src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/helpers.ts:27`)
  and `formatTokenCount(n)` → `"15.2K"` for one count
  (`src/components/run-cost-badge/RunCostBadge.tsx:33`). The second is
  deliberately NOT called `formatTokens` — same name, different arity is a trap.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
