# Severity counts on the read endpoints (API)

**Status:** shipped on `feat/run-cost-badge`. The cross-package spec is
[`../../specs/02-findings-severity.md`](../../specs/02-findings-severity.md);
this one covers only `@devdigest/api`.

## Problem

`findings.severity` is a column nothing reads. The PR list endpoint computes a
`score` and a `cost_usd` per PR but nothing about *what* the review found, and
`RunSummary` carries a flat `findings_count` with no breakdown.

There was already a `rollupSeverities()` helper in `modules/pulls/status.ts`,
with a doc comment describing this exact feature — and zero call sites anywhere
in the repo. The aggregation was designed and then never wired up.

## Scope

In:

- Move `rollupSeverities` to `modules/_shared/severity.ts` and reshape it to the
  contract's `Severity`-cased keys.
- `PrMeta.findings_counts` on `GET /repos/:id/pulls`.
- `RunSummary.findings_counts` on `GET /pulls/:id/runs`.
- Change `PrMeta.cost_usd` from "newest run per agent" to "every completed run".

Out:

- Any migration. `findings` rows already exist and already carry severity.
- Any new route.
- Denormalizing counts onto `agent_runs`. These are read-path aggregates; a
  stored copy is one more thing to keep in step with the rows it summarizes.

## Contract

`SeverityCounts` lives in `contracts/findings.ts`, beside the `Severity` enum it
counts, and is mirrored into the client's vendored copy in the same change.

- `PrMeta.findings_counts: SeverityCounts.nullish()` — the latest
  `kind='review'` row for that PR. Absent → the PR has no review.
- `RunSummary.findings_counts: SeverityCounts.nullable()` — the review produced
  by that run. `.nullable()` is correct here and `.nullish()` is not needed:
  `RunSummary` is built per-request from columns, so unlike `RunStats` there is
  no persisted document that predates the field.

`rollupSeverities` returns UPPERCASE keys matching the enum, so the result
serializes straight onto both contracts with no re-casing at either end.

**Why the helper moved.** Two modules now count the same thing from the same
rows — `pulls` (per PR) and `reviews` (per run). `modules/_shared/` is where
cross-module code belongs; leaving it in `pulls/status.ts` would have meant
`reviews` importing across a module boundary for a pure function.

**Why cost changed.** "Newest run per agent" answered *what does the current
verdict cost*. The product question is *what has this PR cost*, and a re-run
really did spend the money again. The superseded rule is still recorded in
`../INSIGHTS.md`; the entry has not been deleted, it has been corrected.

## Acceptance

- Counts come from the same review `score` comes from — asserting both on one
  row proves they cannot diverge.
- A PR with two reviews reports only the newer one's counts.
- A dismissed finding still counts, because `score` includes it.
- A PR with no review reports `null`; a review with no findings reports
  `{0,0,0}`.
- A run whose review was deleted reports `findings_counts: null`, not `{0,0,0}`.
- Two completed runs of the **same** agent both contribute to `cost_usd`; a
  failed run contributes nothing whatever it claims to have cost.
- A severity string outside the enum is ignored rather than throwing.
- Covered by `test/findings-counts.it.test.ts` and `test/run-cost.it.test.ts`
  (real Postgres, `.it.` suffix mandatory) plus `test/severity-rollup.test.ts`.

## Open questions

None.
