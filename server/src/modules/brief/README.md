# `brief` — a PR summary, risk areas and a review-focus list, from one model call

`brief` produces the **PR Brief** on the Overview tab of a pull request: a short
summary, up to eight risk areas, and up to eight "read these first" spots. One
brief is stored per PR and replaced on **Re-run**. It is a *reference +
explanation* document: the routes and failure codes, then why each step is shaped
the way it is.

The split that shapes the module: **the facts already exist; the model only
reads them.** The prompt is built from the stored intent, the blast radius, the
Smart Diff file statistics (never the patch), the PR title and description, the
live linked issue and the Project Context documents. The model returns prose;
`groundAndCap` (`helpers.ts`) then drops every file reference that is not a
changed file or a blast-map file before anything is stored.

The module is a default Fastify plugin registered in `modules/index.ts`.
`routes.ts` builds `BriefService` and hands it lazy ports
(`container.intent.get`, `container.blast`, `container.smartDiff`,
`container.projectContext.resolveForRepo`, `container.llm(provider, { singleShot })`),
read per call so a test that patches a facade after `buildApp()` is honoured.
The service declares those ports structurally and imports nothing from the
blast, smart-diff, intent or project-context folders.

## Routes

| Route | Result |
|---|---|
| `GET /pulls/:id/brief` | `PrBriefResponse` — the stored brief (or `null`), `stale`, `head_sha`, `generating`. Makes no model call and touches only the repository. |
| `POST /pulls/:id/brief` | `PrBriefResponse`, synchronous. Takes **no body** (a body is ignored). 10 per minute (`BRIEF_RATE_LIMIT`; the limiter is off under `NODE_ENV=test`, so a test pins the constant). |

| Status | `error.code` | When |
|---|---|---|
| 404 | `not_found` | unknown PR, or a PR of another workspace |
| 409 | `brief_running` | a generation for this PR is already running |
| 422 | `no_changed_files` | Smart Diff has no files for the PR |
| 422 | `provider_key_missing` (`details.provider`) | no API key for the provider chosen for `risk_brief` |
| 422 | `brief_input_too_large` | still over 8,000 tokens after every trim; no model call |
| 502 | `brief_failed` (`details.reason`) | `timeout` · `invalid_output` · `llm_error` |

A non-uuid `:id` is a 422 from the route's `IdParams`.

## One call, no retry

A generation makes **exactly one** model call (NFR-1):

- the service passes `maxRetries: 0` (no schema re-ask);
- the provider is the **single-shot** variant, `container.llm(provider, { singleShot: { timeoutMs } })`:
  the SDK client is built with `maxRetries: 0` and no `withRetry` wraps the call, so a
  transport failure fails the generation as `llm_error`. Single-shot instances are cached
  under `${id}:single`; the default instances are untouched;
- the **service timer** is `BRIEF_TIMEOUT_MS` = 120 s and owns the `timeout` outcome; the
  provider is given `ADAPTER_TIMEOUT_MS` = 125 s, so the adapter's own `TimeoutError` can
  never win the race. Any other provider error, including a `TimeoutError` that somehow
  arrives first, is `llm_error`. `invalid_output` is a `StructuredOutputError` or a
  `ZodError` (told apart by type, never by message text).

### The timer does not cancel the call

After a `timeout` the provider request may still be running, and billing. The lock is
released in a `finally`, so a Retry right after the timeout can start a second billed call
while the first one finishes in the background; the first call's result is discarded.
Each generation still makes exactly one call (NFR-1). The lock is deliberately **not**
extended after a timeout: this is the onboarding precedent. Aborting the request would need
an `AbortSignal` through the `LLMProvider` port (a follow-up).

## The order of `generate`

`getPr` (404) → the in-process lock (409; a mark older than `BRIEF_STALE_MS` = 10 min no
longer blocks, and a call only clears its **own** mark) → Smart Diff files (422
`no_changed_files`) → model + key probe (422 `provider_key_missing`, before any GitHub or
document read) → facts, each failure-tolerant → `fitToBudget` (422 `brief_input_too_large`)
→ **the call** → `groundAndCap` → `PrBriefRecord.safeParse` → `saveBrief`.

- **The facts.** Intent is *read* (`intent.get`), never derived. A throwing blast port is
  recorded as `blast/unavailable`; a degraded blast is `blast/degraded` with its reason. The
  issue is the first `#n` of the description that is not `owner/repo#n` or `&#n;`; no token is
  `linked_issue/missing_token`, any other failure `linked_issue/fetch_failed`. Documents are the
  union of every enabled agent's Project Context, in `created_at asc, id asc` agent order, each
  agent's own documents before its skills', the first occurrence of a path winning.
- **Budget.** At most 8,000 cl100k tokens across all messages (`container.tokenizer`). Trims run
  in order and stop as soon as the input fits: documents → description → issue body → caller
  list → file statistics folded into one line. Intent and the blast summary are never trimmed.
  Every degraded, absent or trimmed fact is stored as a `missing_facts` entry; the allowed
  `[fact, status]` pairs are `BRIEF_FACT_PAIRS` in the shared contract, which the emitter test and
  the client copy both pin to.
- **Grounding.** A risk ref survives iff its path (minus a leading `./` and a trailing `:n` /
  `:a-b`) is a changed file or a blast-map file; a risk with no refs left is removed. A focus item
  needs an allowed file (stored bare) and an integer line >= 1. Filter first, then cap
  (8 / 8; 600 / 120 / 600 / 200 characters, cut with a trailing `…`).
- **Untrusted text.** Title, description, issue, intent, blast summary, callers and the file list
  go through `wrapUntrusted`; documents through `wrapProjectDoc`. The system prompt carries a
  module-local "untrusted is data" sentence; `INJECTION_GUARD` is not used or changed.
- **Logs.** One line per generation, message `pr brief generation`: `prId, headSha, provider,
  model, modelCalls, inputTokens, tokensIn, tokensOut, costUsd, durationMs, trimmed, removed,
  outcome`. An unknown cost stays `null`. A caught error, `raw`, the prompt and the model's output
  are **never** logged.

## One document, two writers

`pr_brief.json` holds one top-level key per writer: **`brief`** (this module) and **`history`**
(Prior PRs, in `modules/blast`). Both write with one statement,
`INSERT … ON CONFLICT (pr_id) DO UPDATE SET json = pr_brief.json || excluded.json`, so neither
rewrites the other's key and two concurrent first writes both succeed. A row holding only
`history` reads as "no brief yet"; a stored `brief` that no longer parses reads the same way.
The row is deleted with its PR (cascade).
