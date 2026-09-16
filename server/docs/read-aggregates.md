# Per-PR aggregates on the list endpoint

How `GET /repos/:id/pulls` produces the numbers the Pull Requests table shows,
and why each one is computed the way it is. Read this before adding a column to
that table — the shape of the code is deliberate, and so are the differences
between the three aggregates.

Route: `src/modules/pulls/routes.ts`. Tally helper:
`src/modules/_shared/severity.ts`.

## The shape: IN-queries plus JS grouping

None of these aggregates is a SQL `GROUP BY`. The endpoint loads the PR rows,
collects their ids, and issues one `IN (...)` query per aggregate, grouping the
result in JavaScript.

That is a deliberate trade, not an oversight:

- The list is bounded — one repo's open PRs plus recently closed ones. The
  N here is tens, not thousands.
- The grouping rules are not uniform (see below). Expressing "newest review per
  PR" and "every completed run" as one query would mean a `DISTINCT ON` or a
  window function per aggregate, and Drizzle would stop reading like the rule it
  implements.
- Each aggregate stays independently readable and independently testable
  (`test/findings-counts.it.test.ts`, `test/run-cost.it.test.ts`).

If the list ever becomes unbounded, this is the first thing to revisit.

## The three aggregates, and why they disagree

| Field | Rule | Why |
|---|---|---|
| `score` | the latest `kind='review'` row | The ring shows the current verdict's score. |
| `findings_counts` | the findings of **that same review** | Chips and ring describe one population, so they can never contradict each other on screen. |
| `cost_usd` | **every** `status='done'` run, summed | Total money the PR has spent. A re-run really did cost more, so it adds. |

The first two share a map on purpose: `latestReviewByPr` carries the review's
`id` as well as its score, and the findings query keys off exactly those ids.
Anyone tempted to give the chips their own "latest review" lookup should not —
that is how two rules drift into one row.

The third is different, and that difference is the one thing on this screen you
cannot read off the screen. It is commented at the call site and recorded in
`../INSIGHTS.md`.

## Rules that are easy to get wrong

**Unknown is not zero.** A run whose provider reported no usage is skipped, never
added as `0`; a PR whose runs are all unknown stays out of the map and serializes
as `null`, which the UI renders `—`. The same distinction applies to findings: a
PR with no review at all is `null` (`—`), while a review that found nothing is a
real `{0,0,0}`. Collapsing those two would tell the reader a PR is clean when in
fact nothing has looked at it.

**Failed runs contribute nothing.** Only `status='done'` qualifies for cost. A
failed run stores `costUsd: null` at the source (`reviews/run-executor.ts`), so
this is belt and braces, but the filter is what makes the rule local and obvious.

**`findings.severity` is free text, not a pg enum.** `rollupSeverities` ignores a
value outside the three known levels rather than throwing — a bad row must not
take down the list endpoint for every other PR.

**`reviews.run_id` has no FK to `agent_runs`.** The per-run breakdown in
`reviews/repository/run.repo.ts` therefore joins on the column and scopes by PR,
and a run with no matching review reports `null` rather than `{0,0,0}`.
