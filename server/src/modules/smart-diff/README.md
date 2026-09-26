# `smart-diff` — Files changed, grouped by role (L03)

A pure, ordered, path-based classifier plus a builder. No model call, no new
dependency. See [`specs/07-smart-diff.md`](../../../specs/07-smart-diff.md)
for the full decision record.

## Route

```
GET /pulls/:id/smart-diff   → SmartDiffResponse   404 pull_not_found
```

`response: { 200: SmartDiffResponse }` is declared on the route (the zod
serializer catches a schema mismatch before it reaches the client — a bug
here becomes a logged 500, not a bad payload).

## What it serves

`groups` — the PR's changed files bucketed into the five roles, in display
order `core → tests → wiring → docs → boilerplate`, non-empty groups only,
GitHub order kept within a group (there is no ordering column on `pr_files`,
so "GitHub order" is simply the select order — both here and on the
PR-detail read).

## The classifier — first match wins

| # | Role | Rule |
|---|---|---|
| 1 | `boilerplate` | lock files (`*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`), a `dist/`, `build/` or `__snapshots__/` directory segment, `*.snap`, `*.generated.*`, `*.min.js` |
| 2 | `tests` | `*.test.ts(x)`, `*.spec.ts(x)`, a `test/`, `tests/`, `__tests__/` or `e2e/` directory segment |
| 3 | `wiring` | basename `index.(ts\|tsx\|js\|mjs)`, `*.config.*`, `tsconfig*.json`, `.eslintrc*`, `.env*`, `docker-compose*.y(a)ml`, a `.github/` or `.claude/` directory segment |
| 4 | `docs` | `*.md`, `README*`, `CHANGELOG*`, `LICENSE*`, a `docs/` directory segment |
| 5 | `core` | everything else (the fallback, not a rule) |

Paths are normalized first — `\` → `/`, lowercased — so a Windows path and a
POSIX path classify the same way.

Three disputed cases are pinned by `test/smart-diff-classify.test.ts` because
the "obvious" answer is the wrong one:

- `src/__tests__/__snapshots__/x.snap` → `boilerplate` — the snapshot rule
  (rule 1) is checked before the tests rule (rule 2).
- `.claude/skills/security/SKILL.md` → `wiring` — the `.claude/` directory
  rule (rule 3) is checked before the docs rule (rule 4).
- `e2e/README.md` → `tests` — the `e2e/` directory rule (rule 2) is checked
  before the docs rule (rule 4); the e2e folder owns its README.

A bare `config.ts` does **not** match `*.config.*` (that pattern requires a
name before the `.config.` segment, e.g. `vite.config.ts`), and `build`
counts only as a directory segment — `scripts/build.ts` is `core`, not
`boilerplate`.

## Which findings count

The latest `kind='review'` review **per agent** (`agent_id ?? null`; `null`
is its own bucket) — `latestReviewPerAgent` in `helpers.ts`. Re-running an
agent replaces its old findings; a second agent adds up. A `kind='summary'`
review never counts. A dismissed finding (`dismissed_at != null`) adds no
line. `finding_lines` is the sorted, unique set of `start_line` from the
counted findings whose `file` matches the file's path exactly (no path
normalization on this side — only the classifier normalizes).

The client derives its `● N` counter, the file dot **and** the inline cards
from one array: `usePrReviews` (`["reviews", prId]`) run through
`DiffTab/helpers.ts#latestFindingsPerAgent`, the identical latest-per-agent
rule applied independently (not fetched from this endpoint). Because all
three surfaces read that one array, they can never disagree with what a
Dismiss/Accept just did. `finding_lines` on this endpoint is the **server-side
projection** of the same rule — for API consumers other than this client, and
for L08 once `modules/reviews` needs it server-side too. `useFindingAction`
also invalidates `["smart-diff", prId]` on accept/dismiss, so this endpoint's
own `finding_lines` stay in step with the client's independently-derived set.

## No LLM call

Opening Files changed does not call a model — `service.ts` takes only a
`SmartDiffRepository`, never the `Container`, and reaches no adapter.

## `split_suggestion` is a stub

Out of scope for L03 (see the spec): `too_big` is always `false`,
`proposed_splits` is always `[]`; `total_lines` is real (`Σ(additions +
deletions)` over every changed file). `pseudocode_summary` is omitted
entirely, not set to `null`.

## Module boundary

Three queries, written in this module's own `repository.ts` — `pullExists`,
`getPrFiles`, `reviewsWithFindings` — deliberately duplicating the shape of
`modules/reviews/repository/{pull,review}.repo.ts` rather than importing
them, or reaching for `container.reviewRepo`. Two independent reasons:
`no-cross-module-reach-in` (`.dependency-cruiser.cjs`) allows a module exactly
one importing folder, its own; and `container.reviewRepo` returns
`$inferSelect` rows (`PullRow`/`FindingRow`), which would break Rule 5 (no row
type in a ring-2 signature) the moment `service.ts`/`helpers.ts` touched them,
even if the module boundary didn't apply.

**L08 note:** once `modules/reviews` needs the same classifier (e.g. to group
findings by role), `classifyFile`/`buildSmartDiff` will have to move to
`modules/_shared/` or sit behind a container port — not now, and not a
consequence of anything in this module today.
