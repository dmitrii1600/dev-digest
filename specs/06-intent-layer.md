# Intent Layer (L03)

**Status:** Implemented (2026-09-22). README.md calls this *"Intent layer · Smart Diff"*.
Smart Diff (grouping a diff by role/risk) is **not** part of this spec — only the
Intent half.

Decisions taken with the author (recorded under *Open questions* below where they
stayed open): card placement is the **Overview** tab, above Description; derivation
is **automatic** pre-work in `run-executor.ts` (only when missing or stale) plus a
manual **Re-run**; scope filtering happens in **code**, after grounding, and an
out-of-scope **CRITICAL is never dropped**; plan/spec retrieval is **mandatory**
(four tiers, all resolved) — a reference that cannot be resolved is recorded
`unavailable` with its real reason, never fabricated; confidence is **derived in
code** from which sources were actually available, never read off the model.

## Problem

DevDigest reviews a PR's diff without ever asking *what the PR is for*. Every
finding is judged against the code alone, so the reviewer has no basis to tell
"this PR does not handle auth" (a real gap) from "this PR was never meant to
touch auth" (noise, or worse — an opening for a PR description crafted to talk
the reviewer out of a real vulnerability, the CamoLeak / CVE-2025-59145 pattern).

The starter shipped this as dead code: the `Intent` contract, `PrIntentRecord`,
the `pr_intent` table, `upsertIntent`/`getIntent` — all with zero call sites.
`FeatureModelId` already carried `review_intent` and Settings → Feature Models
already rendered its picker, so no new settings UI was needed. This was wiring,
not greenfield.

## Scope

In:

- A separate, cheap structured LLM call (`modules/intent/`) classifies a PR's
  intent and scope from its title, body, and changed-file list with synthesized
  hunk headers — **never diff bodies**.
- Four plan/spec retrieval tiers, all resolved: **A** inline (a `## Plan` /
  `## Spec` heading, a task list, or a dominant fenced block already in the PR
  body); **B** an in-repo file (a repo-relative path or a same-repo GitHub blob
  URL, read from the clone through a path-guarded reader); **C** a linked GitHub
  issue (`#123`, `owner/repo#123`, an issue URL); **D** an external URL (through
  `container.urlFetcher`, the same SSRF-guarded adapter `POST /skills/import/url`
  uses). A kill switch, `INTENT_FETCH_LINKS` (default `true`), degrades tier D to
  `unavailable` without touching tiers A–C.
- Confidence derived in code (`deriveConfidence`) from which sources were
  actually available — never self-reported by the model.
- Persistence: `pr_intent` gains provenance columns (migration `0015`), one row
  per PR, upserted on re-derive. A failed re-run keeps the previous good text
  (`markFailed` touches only `error` + `generated_at`).
- `GET /pulls/:id/intent` / `POST /pulls/:id/intent` (derive / Re-run).
- `IntentCard` on the PR's Overview tab: the intent sentence, in/out-of-scope
  chips, a confidence bar, and a sources row that shows an `unavailable`
  reference's real reason.
- A new, `<untrusted>`-wrapped `## Derived intent` prompt slot in
  `reviewer-core` (`assemblePrompt`), rendered between `## PR description` and
  `## Skills / rules`.
- A new pure scope filter (`reviewer-core/src/review/scope.ts`) applied AFTER
  `groundFindings`: drops an `out_of_scope` WARNING/SUGGESTION; an
  `out_of_scope` CRITICAL is **always kept**. Runs only when an intent block was
  actually supplied.
- A cheaper `review_intent` registry default
  (`openrouter/deepseek/deepseek-v4-flash`, mirrored in all three registry
  copies) — this is a small pre-review classification call that runs on every
  fresh head.
- A demo intent seeded for `acme/payments-api` #482, computed with the real
  `deriveConfidence()` so seed and runtime cannot disagree.

Out:

- Fetching JavaScript a linked page renders, authenticating to a third-party doc
  tool behind a login, caching a fetched document beyond the `pr_intent` row, or
  feeding the retrieved plan text to the *reviewer* directly — only the
  *derived* intent (already classified, already `<untrusted>`) reaches it.
- Any edit to `reviewer-core/src/grounding.ts` or `INJECTION_GUARD`.
- Persisting `Finding.scope` on the `findings` table, or a new field on
  `RunStats` — a scope drop is visible in the Live Log and the trace only.
- An intent history table; the classifier's tokens/cost on the PR cost badge
  (they live on `pr_intent`, a separate rule from `agent_runs`'s).
- Any change to the five reviewer agent prompts — the new `Finding.scope`
  field's meaning lives entirely in its `.describe()`.

## Contract

- `IntentClassification` (`vendor/shared/contracts/brief.ts`) — the model's
  output: `intent`, `in_scope`, `out_of_scope`. No confidence field.
- `PrIntentRecord` (`vendor/shared/contracts/review-api.ts`) — `Intent` extended
  with `pr_id`, `confidence`, `sources: IntentSource[]`, `head_sha`, provider/
  model/tokens/`cost_usd` (nullable — unknown ≠ free), `error`, `generated_at`,
  and a per-request `stale` flag (not a column).
- `IntentSource` — `{ kind, origin, ref, status, detail }`.
  `kind: 'pr_title' | 'pr_body' | 'changed_files' | 'project_context' |
  'plan_spec' | 'linked_issue'`; `origin: 'inline' | 'repo_file' |
  'github_issue' | 'external_url'` (null for non-plan kinds);
  `status: 'available' | 'partial' | 'unavailable'`.
- `PrIntentResponse = { derived: PrIntentRecord | null }` — distinguishes "never
  derived" from "derived but failed".
- `Finding.scope?: 'in_scope' | 'out_of_scope' | 'unclear'` (nullish) —
  `findings.ts`. Its `.describe()` states it never lowers a severity.
- `PromptAssembly.intent?: string` / `PromptTokens.intent?: number` — both
  nullish/partial, so an existing persisted trace still parses.
- `GET /pulls/:id/intent` → `PrIntentResponse` · 404 `pull_not_found`.
- `POST /pulls/:id/intent` → `PrIntentRecord` · 404 `pull_not_found` ·
  422 `intent_failed`; rate-limited (one press is a full model call).

## Confidence formula

```
pr_title        .10
pr_body         .20
changed_files   .25   (.15 when only the pr_files fallback — no hunks)
plan_spec       .30   (once, when at least one plan_spec source is available)
project_context .15
× (1 − 0.1 × min(unresolvedPlanRefs, 3))
```
Clamped to `[0.05, 0.95]`. A PR whose body carries a real plan reaches ~0.85; the
same PR with a dead link lands at ~0.50 and the card says which reference failed.

## Acceptance

- The card shows the intent sentence, in-scope / out-of-scope chips, a
  confidence %, and a sources row — verified against the seeded
  `acme/payments-api` #482 fixture.
- A `## Plan` section in the body, or a link to `specs/06-intent-layer.md`, an
  issue, or an external URL each produce one `plan_spec` chip with its `origin`
  and `available`/`unavailable` status; a broken link shows the real reason
  (`404`, `blocked: private address`, `timeout`) — never invented content.
- `pnpm arch` stays green: no `modules/reviews` → `modules/intent` runtime edge
  (the executor reaches it only through `container.intent`, a type-only edge).
- An out-of-scope CRITICAL survives the scope filter; an out-of-scope WARNING
  or SUGGESTION is dropped and logged as a `ReviewEvent`; with no intent block
  supplied, nothing is dropped.
- `Run Trace` → `prompt_assembly.intent` / `prompt_tokens.intent` are populated
  per-run; the classifier's own request (visible via the Live Log's "Deriving
  PR intent" step) contains hunk headers, never diff content lines.

## Open questions

- **Resolved as: write the collector now, report `unavailable`.** The author's
  premise — "Project Context spec chunks already in the DB" — does not hold on
  this tree: `code_chunks.source = 'spec'` has zero writers and zero readers,
  and there is no `modules/context/`. `getSpecChunks` is still called on every
  derivation; it reports the source `unavailable · 0 spec chunks indexed` until
  a later lesson fills the table, which needs no code change here. Indexing
  Project Context is a separate feature.
- **Resolved as: `pr_files` fallback, `partial`, no file move.** Should
  `POST /pulls/:id/intent` see a real diff? The run path passes the loaded
  `UnifiedDiff`; the standalone route falls back to `pr_files` (paths + counts,
  no hunk headers) and records that source `partial`. Making them equal would
  mean moving `modules/reviews/diff-loader.ts` to `modules/_shared/` — a
  second feature, not folded into this one.
- **Resolved as: no.** Should the classifier's tokens/cost appear on the PR
  cost badge? They stay on `pr_intent`; `agent_runs`'s columns keep meaning
  "what the reviewer call cost", the existing rule `docs/read-aggregates.md`
  already documents.
- **Resolved as: no.** Does a re-derivation invalidate an existing review?
  Reviews already record the head they ran against (`markReviewed`); the
  intent's own `stale` flag answers the card's question. Nothing is
  recomputed retroactively.
