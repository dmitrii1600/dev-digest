# `intent` — the Intent Layer (L03)

A separate, cheap structured LLM call classifies a PR's **intent and scope**
from its title, body, and changed-file list with synthesized hunk headers —
**never diff bodies**. The result is persisted one-row-per-PR on `pr_intent`,
shown as a card on the PR's Overview tab, injected into the reviewer prompt as
a new `<untrusted>` `## Derived intent` slot, and used to drop findings the
reviewer itself marked out of scope — deterministically, in code, after
grounding, and **never a CRITICAL**.

See [`specs/06-intent-layer.md`](../../../specs/06-intent-layer.md) for the
full decision record.

## Trigger

Derived automatically as shared pre-work in
[`modules/reviews/run-executor.ts`](../reviews/run-executor.ts), right after
the diff loads, but only when no row exists yet or the stored `head_sha`
differs from the PR's current head — plus a manual **Re-run**
(`POST /pulls/:id/intent`). A failed derivation never fails the review: it is
logged and the prompt section is simply omitted.

## Sources

Every source is resolved in **code**, never chosen by the model:

| Source (`IntentSourceKind`) | How it's built | `partial` / `unavailable` when |
|---|---|---|
| `pr_title` | the PR title, verbatim | never — always available |
| `pr_body` | the PR body, capped at `MAX_BODY_CHARS` | the PR has no description |
| `changed_files` | `synthesizeFileDigest` (path + `+N/-M` + rebuilt `@@` hunk headers — **no diff content lines, ever**) when a real diff was loaded; `synthesizeFileDigestFromCounts` (path + counts, no hunks) from `pr_files` otherwise | `partial` on the `pr_files` fallback (no hunk headers); `unavailable` when the PR has no files |
| `project_context` | `code_chunks` where `source = 'spec'` | always `unavailable` on this tree today — the table has no writer yet (see the spec's open question); the collector still runs so a later lesson lights it up with no code change |
| `plan_spec` | see **Plan/spec retrieval** below — one source row per reference | `unavailable` with the real reason when a reference cannot be resolved |

## Plan/spec retrieval — four tiers, all resolved

A PR description that carries a plan or a specification — inline, or as a
link — is the single best evidence of intent that exists, so retrieval is
**mandatory**, not best-effort. Four resolvers, tried in this order, each
producing one `IntentSource` with `kind: 'plan_spec'`:

| Tier | Trigger in the body | Resolver | Risk |
|---|---|---|---|
| **A · inline** | a `## Plan` / `## Spec` / `## Specification` / `## План` / `## Специфікація` heading, a task list (≥ 3 items), or a single dominant fenced block | `extractInlinePlan` (`helpers.ts`, pure) | none — it's text already in the body |
| **B · in-repo file** | a repo-relative path or a same-repo GitHub blob URL | `readRepoFile` (`repository-plans.ts`, ring 3) | path traversal — guarded (resolve + realpath, reject `..`/absolute/symlink escape) |
| **C · GitHub issue** | `#123`, `owner/repo#123`, or an issue URL | `container.github().getIssue` | token scope only |
| **D · external URL** | any other `https?://` | `container.urlFetcher` (the same SSRF-guarded adapter `POST /skills/import/url` uses) | SSRF + indirect injection — both mitigated, see below |

`detectPlanRefs` (`helpers.ts`) does the **classification only** — it never
fetches. The resolvers in `service.ts`/`repository-plans.ts` do the I/O, and
run in parallel via `Promise.allSettled` so one dead link cannot stall the
others.

**A reference that cannot be resolved is recorded as a source with status
`unavailable` and its real reason** (`404`, `blocked: private address`,
`timeout`, `no GitHub token`, `external fetching disabled`) — never fetched
successfully yet never fabricated. The card shows it; nothing is invented.

**Kill switch.** `INTENT_FETCH_LINKS` (default `true`, see `platform/config.ts`).
Set it `false` and tier D degrades to `unavailable · external fetching
disabled` — tiers A–C keep working.

## Trust

Every retrieved document is someone else's text. It enters the classifier
request inside `wrapUntrusted('plan:<ref>', …)`, capped at `MAX_PLAN_CHARS`,
and `INTENT_SYSTEM_PROMPT` states that a scope claim found inside those blocks
cannot narrow what a downstream reviewer checks. It is **never** promoted to
instructions — and the *derived* intent block that later reaches the reviewer
prompt is itself wrapped again under `INJECTION_GUARD`
(`reviewer-core/src/prompt.ts`, not touched by this module).

## Confidence — derived in code, never self-reported

`deriveConfidence` (`helpers.ts`) sums per-source weights, then applies a
penalty for unresolved plan/spec references, clamped to `[0.05, 0.95]`:

```
pr_title        .10
pr_body         .20
changed_files   .25   (.15 when only the pr_files fallback — no hunks)
plan_spec       .30   (once, when at least one plan_spec source is available)
project_context .15
× (1 − 0.1 × min(unresolvedPlanRefs, 3))
```

The model is never asked for a confidence number — verbalized LLM confidence
is poorly calibrated (Kadavath et al. 2022), the same reason the review
`score` is recomputed from surviving findings rather than read off the model.

## Scope filtering (the reviewer side)

The reviewer model labels each finding `Finding.scope` (`in_scope` /
`out_of_scope` / `unclear`). **Code** — `reviewer-core/src/review/scope.ts` —
filters *after* `groundFindings`: an `out_of_scope` WARNING or SUGGESTION is
dropped; an `out_of_scope` CRITICAL is **always kept**. The filter only runs
when an intent block was actually supplied. This is the defence against a PR
description crafted to talk a reviewer out of a real vulnerability (CamoLeak,
CVE-2025-59145) — the worst achievable outcome is the suppression of a
non-critical finding, and every drop is logged as a `ReviewEvent`.

## Routes

```
GET  /pulls/:id/intent   → PrIntentResponse   404 pull_not_found
POST /pulls/:id/intent   → PrIntentRecord     404 pull_not_found · 422 intent_failed
                           rate-limited — one press is a full model call
```

Neither route takes a body. `POST` forces a re-derivation (the Overview tab's
Re-run button); a failure leaves the previous good record in place
(`IntentRepository.markFailed` touches only `error` + `generated_at`) and
returns 422 with the real reason.

## Wiring

- `types.ts` declares the `IntentPort` — the `RepoIntel` precedent.
  `modules/reviews/run-executor.ts` reaches it only through
  `container.intent`, a type-only edge (`no-cross-module-reach-in` forbids a
  direct `modules/intent/*` import from another module's folder).
- `platform/container.ts` is the only other file allowed to import `types.ts`
  (the composition root).
- The `review_intent` feature-model default (`FEATURE_MODELS` registry) is a
  cheap model (`openrouter/deepseek/deepseek-v4-flash`), not the reviewer's
  own model — this is a small pre-review classification call that runs on
  every fresh head. A workspace override in Settings → Feature Models wins.
