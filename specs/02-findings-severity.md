# Findings by severity

**Status:** shipped on `feat/run-cost-badge`. Kept here, like
`01-run-cost-badge.md`, as the record of what was agreed before it was built.

## Problem

Every review already produces grounded findings carrying a severity
(`CRITICAL | WARNING | SUGGESTION`), and they are already normalized rows in the
`findings` table. But nothing outside the PR detail page reads that column:

- The PR list shows a SCORE donut with no way to tell *what* pulled it down. A
  61 caused by two criticals and a 61 caused by twenty nits look identical.
- A review run's findings can only be read end to end. There is no way to ask
  "just the blockers" on a run that returned fifteen.

This is the second half of lesson L01 (`README.md` — "Run cost badge · severity
filter on findings"), explicitly parked by `01-run-cost-badge.md`.

## Scope

In:

- `SeverityCounts` contract; `PrMeta.findings_counts` and
  `RunSummary.findings_counts`, both computed on read.
- PR list: a FINDINGS column of per-severity counters, with a read-only hover
  preview of the findings behind them.
- Run timeline: the same counters per run, **non-interactive**.
- Review-runs card: a pill row under the verdict that filters the findings
  listed below it, and un-filters on a second click.

Out:

- Any schema change. The rows exist; this is a read-path aggregate.
- Any new endpoint. Three existing routes gain a field.
- The run trace drawer. Its FINDINGS tile and findings list already shipped with
  `01-run-cost-badge.md`.
- Filtering by category, confidence, file, or agent. Severity only.
- Any new model call. Counting is `COUNT`/`filter` over persisted rows.

## Contract

Contracts (`server/src/vendor/shared`, mirrored into `client/src/vendor/shared`):

- `SeverityCounts` — `{ CRITICAL: int, WARNING: int, SUGGESTION: int }`. Keys are
  the `Severity` enum's own spelling, so nothing re-cases on the way out.
- `PrMeta.findings_counts: SeverityCounts.nullish()` — the PR's **latest**
  review. Null when the PR has never been reviewed.
- `RunSummary.findings_counts: SeverityCounts.nullable()` — that run's own
  review. Null when the run produced none (failed, cancelled, review deleted).

Routes (shape only; no new endpoints):

- `GET /repos/:id/pulls` → each `PrMeta` carries `findings_counts`.
- `GET /pulls/:id/runs` → each `RunSummary` carries `findings_counts`.

Aggregation rules, stated because the PR row now holds two of them:

- `score` **and** `findings_counts` describe the single latest review, so the
  ring and the chips beside it always describe the same population.
- `cost_usd` sums **every** completed run — total spend, not the price of the
  current verdict. A re-run adds to it.

UI:

- PR list: a FINDINGS column between SCORE and STATUS. One chip per severity
  that occurs; hovering opens a read-only preview headed
  `N FINDINGS IN THIS RUN`; clicking a chip narrows that preview.
- Run timeline: the same chips, rendered as plain spans — the timeline is a
  chronology, not a filter.
- Review-runs card: `N CRITICAL · N WARNING · N SUGGESTION` under the verdict and
  score; clicking filters the findings below, clicking again restores them.

## Acceptance

- A reviewed PR shows one counter per severity present; severities with no
  findings are omitted entirely.
- A PR whose review found nothing shows `0`. A PR nobody has reviewed shows `—`.
  These are different states and must not collapse.
- Dismissed findings are counted, because `score` is computed from them too.
- Re-reviewing a PR replaces its counters; an older review never keeps
  inflating them.
- The preview's header count equals the number of chips' counts summed, and its
  rows contain no buttons or links — triage (Accept / Reject) lives only on the
  PR page's Review-runs card.
- In an expanded review run, a pill's number equals the number of finding cards
  of that severity listed below it; clicking filters to exactly those; clicking
  the same pill again restores the full list.
- The timeline's severity icons are not clickable.
- Opening the PR list or toggling a filter issues no model call.

## Open questions

None.
