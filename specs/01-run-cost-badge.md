# Run cost badge

## Problem

Every review run spends real money, and none of it is visible. The engine
already computes `costUsd` per run (provider-reported `usage.cost`, falling back
to the price book), but the server discards it — `run-executor.ts` destructures
only `{ tokensIn, tokensOut, grounding }` out of the outcome, and `agent_runs`
has no column to hold it. So nobody can tell an expensive PR from a cheap one,
or which agent burns the budget.

## Scope

In:

- Persist per-run USD cost on `agent_runs` (`cost_usd`).
- Expose it on three read surfaces: PR list item, PR run history row, run trace
  stats.
- One `RunCostBadge` component with three display variants.
- Seed demo runs so the three screens show numbers on a fresh clone.

Out:

- The FINDINGS column on the PR list (separate feature).
- Any budget, quota, alert or cost-over-time screen.
- Any new call to a model or to a provider pricing endpoint. Cost comes from the
  response we already receive.

## Contract

Schema — `agent_runs.cost_usd double precision NULL` (new migration), matching
the existing `ci_runs.cost_usd` / `eval_runs.cost_usd` type.

Contracts (`server/src/vendor/shared`, mirrored into `client/src/vendor/shared`):

- `PrMeta.cost_usd: z.number().nullish()` — sum of the newest `done` run per
  agent for that PR; null when nothing is known.
- `RunSummary.cost_usd: z.number().nullable()` — this run's cost.
- `RunStats.cost_usd: z.number().nullish()` — nullish so traces persisted before
  this feature still parse.

Routes (shape only; no new endpoints):

- `GET /repos/:id/pulls` → each `PrMeta` carries `cost_usd`.
- `GET /pulls/:id/runs` → each `RunSummary` carries `cost_usd`.
- `GET /runs/:id/trace` → `stats.cost_usd`.

UI:

- PR list gains a right-aligned COST column, `compact` variant → `$0.012`.
- Run history row shows the `timeline` variant under the timestamp →
  `9,119 tok · $0.0013`.
- Run trace drawer Stats gains a fourth tile, COST → `$0.06`.

## Acceptance

- A completed run stores a non-null `cost_usd` whenever the provider reported
  usage; all three surfaces show it.
- A run with no cost data renders `—`, never `$0.00`. `$0.00` is reserved for a
  genuine zero.
- A failed or cancelled run stores `cost_usd = null` (not 0) and renders `—`.
- A trace persisted before this feature still opens; its COST tile shows `—`.
- The PR-list number equals the sum of the newest `done` run per agent. Runs
  with unknown cost are skipped; if none is known the cell shows `—`.
- No additional model or pricing HTTP call is made on any read path.

## Open questions

None.
