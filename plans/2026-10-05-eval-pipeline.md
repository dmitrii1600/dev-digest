# Implementation Plan: Eval Pipeline: cases from findings, suite runs, code-scored metrics, dashboard and Compare

**Plan ID:** 2026-10-05-eval-pipeline  ·  **Spec:** [specs/2026-10-05-eval-pipeline.md](specs/2026-10-05-eval-pipeline.md)  ·
**Execution mode:** multi-agent (step 0 → tracks A ∥ B → Integration)  ·  **Packages:** server, client  ·
**Assumptions:** Q-1, Q-2, Q-3, Q-5 and Q-7 are taken at the spec defaults ("defaults", user via caller). Units are fixed in this plan: "64 KB" = 65 536 UTF-8 bytes, "16 KB" = 16 384 UTF-8 bytes. Percentages are shown with one decimal, and deltas are in percentage points with one decimal.

## Summary
This plan adds a server module `modules/evals` and reshapes the eval tables. `eval_runs` becomes one row per **run** (kind, status, agent version, skill snapshot, case fingerprints, aggregate metrics), and the new table `eval_run_cases` holds the per-case results. `eval_cases` gains a typed expectation, a target, a source link and a fingerprint. The run executor is new and lives inside the evals module. It calls `reviewPullRequest` once per case on the frozen diff and PR text only, with no intent, repo map, callers or project docs. Schema reprompts are off and the transport is single-shot. A 120 s race per case and at most 3 cases in flight are enforced. Scoring is pure code in `evals/helpers.ts`. The client gets the FindingCard action, an Evals tab, `/eval` and `/eval/[agentId]` pages, and a Compare modal. The contracts are written once in step 0 and mirrored byte-identically, and that step also heals the existing `eval-ci.ts` drift. Server and client are disjoint packages, so they build in parallel.

## Requirements review

**What I understood:** Build the parent eval feature (case from a decided finding, suite run over the set, deterministic recall/precision/citation, Evals tab, dashboard, Compare). The schema and contracts must let the two sibling specs (`run-controls`, `case-authoring`) be added without reshaping anything.
**Inputs read:** specs/2026-10-05-eval-pipeline.md (approved) · siblings specs/2026-10-05-eval-run-controls.md, specs/2026-10-05-eval-case-authoring.md (for schema headroom only) · request text · AGENTS.md, server/AGENTS.md, client/AGENTS.md · INSIGHTS.md, server/INSIGHTS.md, client/INSIGHTS.md, reviewer-core/INSIGHTS.md · onion-architecture skill.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status | Covered by |
|---|---|---|---|---|
| AC-1 | "the FindingCard shall show a "Turn into eval case" action next to Accept and Dismiss" | spec §AC-1 | clear | step 8 |
| AC-2 | "store a `must_find` case … frozen diff of that file, the PR title and body, and a link to the source finding … card shall confirm" | spec §AC-2 | clear | steps 1, 3, 5, 6, 8 |
| AC-3 | "dismissed finding … store a `must_not_flag` case" | spec §AC-3 | clear | steps 5, 6 |
| AC-4 | "Evals tab shall list every case … result in the latest completed run … under a "N / M passing" count" | spec §AC-4 | clear | steps 5, 9 |
| AC-5 | "confirms deletion … Past runs shall keep their recorded per-case results" | spec §AC-5 | clear | steps 1 (FK set null), 6, 9 |
| AC-6 | "start one eval run … respond before any case finishes … show the run as running" | spec §AC-6 | clear | steps 5, 6, 9 |
| AC-7 | "review only the case's frozen diff and PR title and body … No repo map, callers digest, project documents or intent" | spec §AC-7 | clear (the live path at `server/src/modules/reviews/run-executor.ts:134-235` does all four, so evals gets its own executor) | steps 5, 6 |
| AC-8 | "matches … file equals the target file and its line range overlaps" | spec §AC-8 | clear | step 3 |
| AC-9 | "record … agent id, version, enabled skills with skill versions, case ids with a fingerprint … three metrics" | spec §AC-9 | clear | steps 1, 3, 5 |
| AC-10 | "latest completed run's recall, precision, citation accuracy and pass count, each with its signed change" | spec §AC-10 | clear: the pass count carries a delta too, so `EvalDashboard.delta` gains `cases_passed` | steps 0, 3, 5, 9, 11 |
| AC-11 | "sidebar shall show an "Eval Dashboard" entry under Skills Lab … one card per agent that has cases … recent eval runs" | spec §AC-11 | clear | steps 5, 10 |
| AC-12 | "three metric tiles with deltas, a trend chart … 20 newest runs" | spec §AC-12 | contradicts tree: `client/src/vendor/ui/charts/LineChart.tsx:35` turns a missing value into 0, which breaks EC-8 | step 11 (Rec. 3) |
| AC-13 | "exactly two runs are selected … Compare … older → newer values, each with a signed delta" | spec §AC-13 | clear | step 11 |
| AC-14 | "line diff of the two runs' system prompts … state a model change or a skill-set change" | spec §AC-14 | clear | steps 7, 11 |
| AC-15 | "banner naming each dropped metric and its drop in points" | spec §AC-15 | clear | steps 3, 11 |
| AC-16 | "≥ 8 cases … Compare modal shall show non-zero deltas … broken prompt shall show lower precision" | spec §AC-16 | clear (manual) | step 12 checklist |
| EC-1 | "neither accepted nor dismissed … disabled and say that the finding must be accepted or dismissed first" | spec §EC-1 | clear | steps 5 (422), 8 |
| EC-2 | "case already exists for the same source finding … create no second case … report the existing one" | spec §EC-2 | clear | steps 1 (unique index), 5, 6 |
| EC-3 | "no producing agent, or that agent no longer exists … not offer … 404" | spec §EC-3 | clear: the client signal is `ReviewRecord.agent_name`, which is null when the agent is gone (`server/src/modules/reviews/service.ts:164-172`) | steps 5, 6, 8 |
| EC-4 | "disposition changes, or its review or PR is deleted … keep its expectation type and frozen inputs" | spec §EC-4 | clear | steps 1, 6 |
| EC-5 | "zero cases … disabled … 422 naming the empty set" | spec §EC-5 | clear | steps 5, 6, 9 |
| EC-6 | "another eval run of the same agent is still running … 409" | spec §EC-6 | clear | steps 1 (partial unique index), 5, 6, 9 |
| EC-7 | "review call fails … errored with its reason … run marked partial … every case errors, or … API restart … failed" | spec §EC-7 | clear | steps 3, 5, 6 |
| EC-8 | "empty denominator … not available and display "—", never 0 % or 100 %" | spec §EC-8 | clear (contracts made nullable in step 0) | steps 0, 3, 7, 9, 11 |
| EC-9 | "did not include the same case ids with the same content fingerprints … warn … each run's case count and the number of edited cases" | spec §EC-9 | clear | steps 3, 6, 11 |
| EC-10 | "no agent has a case … empty state that explains that cases are made from accepted or dismissed findings" | spec §EC-10 | clear | step 10 |
| EC-11 | "agent-version snapshot cannot be read … still show the metric deltas … prompt diff is unavailable" | spec §EC-11 | clear | step 11 |
| EC-12 | "diff exceeds 64 KB … freeze only the hunks that overlap … still exceed … 422 … card shall say the diff is too large" | spec §EC-12 | ambiguous (unit), taken as UTF-8 bytes | steps 3, 5, 8 |
| NFR-1 | "exactly one review call per case and no intent, brief or other model call" | spec §NFR | contradicts tree: `reviewer-core/src/review/run.ts:33` reprompts up to 2× by default, and the default transport retries (server/INSIGHTS.md:394) | step 5 (`maxRetries: 0` + single-shot client) |
| NFR-2 | "same cases and the same produced findings always yield identical per-case results and metrics" | spec §NFR | clear | step 3 |
| NFR-3 | "frozen diff, PR meta and target do not change after creation when the source PR is resynced, re-reviewed or deleted" | spec §NFR | clear | steps 1, 6 |
| NFR-4 | "creates no review or finding on any PR, does not change a PR's reviewed state, … run history" | spec §NFR | clear | steps 5, 6 |
| NFR-5 | "at most 200 cases per agent; at most 3 … in flight; … not returned in 120 s is recorded as errored" | spec §NFR | contradicts tree: OpenAI/Anthropic adapters time out at 60 s (`server/src/adapters/llm/openai.ts:15`, `anthropic.ts:16`), OpenRouter at 90 s (`reviewer-core/src/llm/openrouter.ts:54`), and `reviewPullRequest` passes no `timeoutMs` | step 5 (provider decorator + single-shot client at 125 s) |
| NFR-6 | "deleting an agent removes its cases and eval runs; deleting a finding, review or PR removes no case" | spec §NFR | clear: `eval_cases.owner_id` has no FK (`server/src/db/schema/eval.ts:13`) | steps 1, 2, 6 |
| NFR-7 | "every new user-facing string is read from `messages/en/eval.json` (or the namespace of the screen)" | spec §NFR | clear: nav labels are registry literals by design (`client/src/vendor/ui/nav.ts:30-37`), and `shell.json` already has `nav.eval` | steps 8–11 |
| NFR-8 | "carry a text or sign … not colour alone … keyboard … accessible name" | spec §NFR | clear: vendored `MetricCard` shows an icon and an unsigned value (`client/src/vendor/ui/charts/MetricCard.tsx:52-66`), so this plan adds a text delta | steps 7, 9, 11 |
| NFR-9 | "mirrored in the client copy in the same change, and both packages typecheck" | spec §NFR | clear | step 0 |
| NFR-10 | "logs start, end, status, and each case's outcome or error reason … readable from the run's API record" | spec §NFR | clear | steps 5, 6 |
| NFR-11 | "`node scripts/verify.mjs server --it` and `node scripts/verify.mjs client` are green" | spec §NFR | clear | step 12 |
| NFR-12 | "suite metrics … consider only suite runs over the whole set. Single-case runs … never appear" | spec §NFR | clear | steps 1 (`kind`), 4, 5 |
| UI-1 | "`:id` … Shape: uuid … 422 naming the param; 404 when not found or in another workspace" | spec §Untrusted inputs | clear | step 6 |
| UI-2 | "Request bodies … strict object, no extra keys; a run start carries no body fields" | spec §Untrusted inputs | clear | step 6 |
| UI-3 | "Compare selection (two run ids) … both runs belong to the same agent … API answers 422" | spec §Untrusted inputs | ambiguous: the spec's Module interactions table lists no compare route, see Rec. 2 | step 6 |
| UI-4 | "Frozen diff … ≤ 64 KB … wrapped as untrusted under `INJECTION_GUARD`, like a live review" | spec §Untrusted inputs | clear: `assemblePrompt` wraps the diff as it does for live reviews | steps 3, 5 |
| UI-5 | "PR title ≤ 300 chars, body ≤ 16 KB; … rendered as plain text" | spec §Untrusted inputs | clear | steps 3, 5 |
| UI-6 | "Finding title, file, rationale … plain text; case name ≤ 120 chars" | spec §Untrusted inputs | clear | steps 3, 9 |
| UI-7 | "Model output … parsed with the existing `Review` schema, then grounded … errored" | spec §Untrusted inputs | clear | step 5 |

### Gaps and questions (non-blocking; defaults taken)
1. The compare route is missing from the Module interactions table, but Untrusted inputs requires an API 422. → Adopted `GET /agents/:id/eval-runs/compare?a=&b=` (Rec. 2).
2. What "completed run" means for metrics: `partial` runs do have metrics. → "Completed" means status `completed` **or** `partial`. `failed` and `running` runs are listed in tables but never feed tiles, deltas, trend or banner.
3. Run cost when some case costs are unknown. → The run cost is the sum over non-errored cases. It is `null` (shown "—") if any non-errored case reported `null`, which follows the engine's poison rule (`reviewer-core/src/review/run.ts:184`, INSIGHTS.md:287). Errored cases add nothing.
4. FindingCard is also rendered from `DiffTab` (`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:113`). → The action is wired only through `FindingsPanel` (the findings list). DiffTab cards show no eval action (props are optional).

### Recommendations
1. **Reshape `eval_runs` into the run header and add `eval_run_cases`, in two generated migrations (additive, then drop-only)**. Why: the existing row is per case, with `case_id NOT NULL … onDelete cascade` (`server/src/db/schema/eval.ts:24-26`), which breaks AC-5. drizzle-kit hangs on a table that gains and loses columns in one migration (server/INSIGHTS.md:321). Plan change: step 1. **Adopted.**
2. **Add `GET /agents/:id/eval-runs/compare?a=&b=`** to return the comparison, including the case-set diff (EC-9) computed in pure code. Why: UI-3 needs a 422 at the API, and determinism belongs on the server. Plan change: steps 0, 5, 6, 11. **Adopted.**
3. **Use a feature-local `MetricTrendChart` built on `recharts` (already a client dependency, `client/package.json:22`) with null points as gaps**, not the vendored `LineChart`. Why: `LineChart.tsx:35` writes `?? 0`, which plots "not available" as 0 % (EC-8). `src/vendor/ui` is do-not-touch. The sibling run-controls EC-12 needs gaps too. Plan change: step 11. **Adopted.**
4. **Move the skill trust rule and the review task wording into `server/src/modules/_shared/review-inputs.ts`**. Live reviews and eval runs would then use one `TRUSTED_SKILL_SOURCES` and one task framing. Why: the rule is a private const in `server/src/modules/reviews/run-executor.ts:28`, and a cross-module import is forbidden (`.dependency-cruiser.cjs:85`). A copied trust rule is how the client drift in INSIGHTS.md (2026-09-20, `UNTRUSTED_SOURCES`) happened. Plan change: step 2. Live prompts stay byte-identical. **Adopted.**
5. **Heal the `eval-ci.ts` drift by making the client copy byte-identical to the server copy, and pin `eval-ci.ts` and `knowledge.ts` with a sync test** (the precedent is `client/src/test/brief-contract-sync.test.ts`). Why: NFR-9, DR-8. The client `knowledge.ts` already exports `Provider` and `CiFailOn`, so the full server file compiles there. Plan change: step 0. **Adopted.**
6. **Delete the dead `EvalRunRecord` / `EvalRunResult` contracts.** They describe the per-case `eval_runs` row this plan removes, and nothing imports them (`rg` shows only the two vendored definitions). Why: the spec says "extended, not duplicated", and keeping a contract for a vanished table is a duplicate in waiting. Plan change: step 0. **Adopted.**
7. **Promote the skills Versions-tab `diffLines` to `client/src/components/diff-viewer/line-diff.ts`** for the Compare prompt diff (its second consumer). Why: there is no diff library and none should be added (`.../VersionsTab/diff.ts:3-8`), and route→route imports are forbidden. Plan change: step 7. **Adopted.**

### Execution mode
Chosen by the planner, since the caller asked for the planner's judgement: **multi-agent**. Server and client are separate packages with separate typecheck and lint. After the contracts land in step 0 they share no file, and the client is roughly half the work (five screens). One package per track means no cross-track red verify.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | contract-once + mirror, `*.it.test.ts`, do-not-touch (grounding, INJECTION_GUARD, migrations), verify.mjs flags |
| [server/AGENTS.md](server/AGENTS.md) | module = routes+service(+repository)+index entry; declarative validation; `.js` imports |
| [client/AGENTS.md](client/AGENTS.md) | hooks over `lib/api.ts`; `nav.ts` is app-owned; i18n namespaces |
| [server/src/db/schema/eval.ts:7-35](server/src/db/schema/eval.ts:7) | current case/run tables; run is per case; owner_id has no FK |
| [server/src/vendor/shared/contracts/knowledge.ts:148-183](server/src/vendor/shared/contracts/knowledge.ts:148) · [eval-ci.ts:20-89](server/src/vendor/shared/contracts/eval-ci.ts:20) | existing eval contracts, non-null metrics |
| [server/src/modules/reviews/run-executor.ts:134-235,397-407](server/src/modules/reviews/run-executor.ts:134) | live run adds intent/callers/repo map/project docs and marks the PR reviewed, so it cannot be reused; skill wrapping rule |
| [reviewer-core/src/review/run.ts:130-268](reviewer-core/src/review/run.ts:130) | `ReviewOutcome.review.findings` = grounded (and scope-filtered only when `intent` is set, `:217`); `dropped` = grounding drops; per-file → single-pass for a one-file diff |
| [server/src/platform/container.ts:296-344](server/src/platform/container.ts:296) | `llm(id, { singleShot: { timeoutMs } })`; OpenAI/Anthropic single-shot read `req.timeoutMs` (default 60 s) |
| [server/src/modules/brief/routes.ts:29-46](server/src/modules/brief/routes.ts:29) · [brief/constants.ts](server/src/modules/brief/constants.ts) | deps-object service constructor; service timer 120 s + adapter 125 s precedent |
| [server/src/modules/agents/repository.ts:77-83,110-168](server/src/modules/agents/repository.ts:77) | delete path; version bump + snapshot; skill links do not version |
| [server/src/modules/skills/repository.ts:207-220](server/src/modules/skills/repository.ts:207) | `blocksForAgent` returns id/source/body only; needs name + version |
| [server/src/modules/reviews/repository/review.repo.ts:97-142](server/src/modules/reviews/repository/review.repo.ts:97) | finding → review → pull resolution; exclusive dispositions |
| [server/src/modules/reviews/diff-loader.ts](server/src/modules/reviews/diff-loader.ts) | diff source: `git.diff` then `pr_files.patch` |
| [reviewer-core/src/review/reduce.ts:64](reviewer-core/src/review/reduce.ts:64) | `sliceDiff` matches by substring (`b/src/a.ts` also catches `b/src/a.tsx`), so it must not be used to freeze a file |
| [client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:91-110](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:91) · ReviewRunAccordion · FindingsPanel | action row; `review.agent_id`/`agent_name` available one level up |
| [client/src/app/agents/[id]/page.tsx:15](client/src/app/agents/[id]/page.tsx:15) · [AgentEditor/constants.ts:12-14](client/src/app/agents/[id]/_components/AgentEditor/constants.ts:12) | tab registry |
| [client/src/components/app-shell/helpers.ts](client/src/components/app-shell/helpers.ts) · [client/messages/en/shell.json](client/messages/en/shell.json) | `/eval` already maps to nav key `eval`; `nav.eval` = "Eval Dashboard" exists |
| [client/messages/en/eval.json](client/messages/en/eval.json) | existing `dashboard`, `evalsTab`, `page` keys to reuse |
| [client/src/test/brief-contract-sync.test.ts](client/src/test/brief-contract-sync.test.ts) | contract parity test precedent (EOL-normalised) |

## Insights that bind this work
1. **"exactly one model call" needs the single-shot client, not just `maxRetries: 0`**, [server/INSIGHTS.md:394](server/INSIGHTS.md:394). Paired with the OpenRouter 90 s / 2 silent retries note in [reviewer-core/INSIGHTS.md:30](reviewer-core/INSIGHTS.md:30). Honoured in step 5. The provider comes from `container.llm(provider, { singleShot: { timeoutMs: 125_000 } })`. `reviewPullRequest` gets `maxRetries: 0`, and a small decorator stamps `timeoutMs: 125_000` and `maxRetries: 0` on every `completeStructured` request. The service's own 120 s timer always wins (the brief pattern).
2. **drizzle-kit prompts and hangs when a table gains and loses columns in one generate**, [server/INSIGHTS.md:321](server/INSIGHTS.md:321). Honoured in step 1 with two generated migrations: the first only adds columns and tables, the second only drops `eval_runs.case_id/actual_output/pass`. Nothing is hand-written.
3. **`@devdigest/shared` is two copies, so mirror in the same change**, [INSIGHTS.md:293](INSIGHTS.md:293). A raw `diff` lies under autocrlf ([INSIGHTS.md:227](INSIGHTS.md:227)). Honoured in step 0: byte-identical copies, plus a sync test that normalises `\r\n`.

Also applied:
- Unknown cost renders "—" and is never coerced to 0 ([INSIGHTS.md:287](INSIGHTS.md:287)).
- An FK is not indexed by Postgres ([server/INSIGHTS.md:191](server/INSIGHTS.md:191)), so every new FK gets an index.
- A new ring-2 file is invisible until listed in `RING_2` ([server/INSIGHTS.md:358](server/INSIGHTS.md:358)).
- An "optional body" still 422s ([server/INSIGHTS.md:326-331](server/INSIGHTS.md:326)), so the client sends `{}`.
- A green `--it` proves nothing with Docker down ([server/INSIGHTS.md:143](server/INSIGHTS.md:143)).
- `pnpm typecheck` never sees `server/test/**` fakes ([server/INSIGHTS.md:139](server/INSIGHTS.md:139)).
- Review runs call paid intent in tests ([server/INSIGHTS.md:75](server/INSIGHTS.md:75)). The eval executor never touches `container.intent`, and the it-test asserts that.
- On the client: export query-key builders ([client/INSIGHTS.md:197](client/INSIGHTS.md:197)), keep server pages thin ([client/INSIGHTS.md:224](client/INSIGHTS.md:224)), use `fireEvent` not user-event ([client/INSIGHTS.md:236](client/INSIGHTS.md:236)), and give every modal a `padding: 24` body.

What Doesn't Work check:
- Step 2 edits `reviews/helpers.ts` (`taskLine`), which has a live test (`server/test/reviews-helpers.test.ts`). Its signature and output stay identical, per the "grep `test/` too" note at server/INSIGHTS.md:40.
- No step adds a required field to `RunStats` (server/INSIGHTS.md:17).

## Constraints
- **Onion rings (server).**
  - `modules/evals/routes.ts` is ring 4, and it may import `parseUnifiedDiff` from `../../adapters/git/diff-parser.js` to inject it.
  - `service.ts`, `helpers.ts` and `constants.ts` are ring 2. They import no `drizzle-orm`, `db/**`, `adapters/**`, `fastify`, `node:fs` or runtime `zod`. `node:crypto` is allowed.
  - `repository.ts` is ring 3.
  - `modules/_shared/review-inputs.ts` is ring 2 and **must be added to `RING_2` in `server/eslint.config.mjs:114`**.
  - Cross-module data goes through `container.agentsRepo` / `container.skillsRepo`, or through the evals repository reading tables directly. Never import another module's folder.
- **Contract once + mirror.**
  - `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts` are canonical, and `client/src/vendor/shared/contracts/{knowledge,eval-ci}.ts` must be byte-identical copies.
  - Step 0 is the only step that edits either copy. If a track finds it needs a contract change, it stops and reports. It does not edit `vendor/shared`.
- **`.js` on relative imports** in every new `server/` file.
- **`*.it.test.ts`** for any test that touches Postgres (`server/test/evals.it.test.ts`). Hermetic tests are `*.test.ts`.
- **Migrations**: only through `cd server && pnpm db:generate`. Never edit `0000`–`0016`, and never rename a generated file.
- **Do not touch**: `reviewer-core/**` (no edit is needed: grounding, `INJECTION_GUARD` and `reviewPullRequest` are consumed as-is), lock-files, `client/.next`, `src/vendor/ui/**` except `nav.ts`.
- **Declarative validation**: every new route declares `params` / `querystring` / `body` / `response` with zod. POST bodies are `z.object({}).strict()`, and the client sends `{}`.
- **No `fetch` in components**: client data flows only through `client/src/lib/hooks/evals.ts` over `src/lib/api.ts`.
- **i18n**: every new client string goes in `messages/en/eval.json` (eval screens, Evals tab) or `messages/en/prReview.json` (FindingCard). The nav label is a registry literal (existing pattern).
- **Spec bounds down the stack** (NFR-5): service timer 120 000 ms < adapter `timeoutMs` 125 000 ms (OpenAI/Anthropic read it per request) = OpenRouter single-shot client timeout 125 000 ms with SDK retries 0. `reviewPullRequest` `maxRetries: 0`. No DB column limits apply (text columns).
- **Secrets**: a missing provider key surfaces as the `ConfigError` thrown by `container.llm`. It is recorded as the case error reason and never logged with the key.

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/**`, `client/src/vendor/shared/contracts/**` (step 0) | `zod` | wire contracts; nullable vs nullish; `.strict()` |
| `server/src/db/schema/eval.ts`, `server/src/db/schema.ts`, `server/src/db/rows.ts` (step 1) | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design` | ring 3 schema, FKs, partial unique index, generated migrations |
| `server/src/modules/_shared/review-inputs.ts`, `reviews/*`, `skills/repository.ts`, `agents/repository.ts`, `server/eslint.config.mjs` (step 2) | `onion-architecture`, `drizzle-orm-patterns` | ring placement of a shared ring-2 file; repository edits |
| `server/src/modules/evals/{helpers,constants,service}.ts` (steps 3, 5) | `onion-architecture` | ring 2: no db/adapters/fastify/zod imports |
| `server/src/modules/evals/repository.ts` (step 4) | `onion-architecture`, `drizzle-orm-patterns` | ring 3 queries, transactions, conflict handling |
| `server/src/modules/evals/routes.ts`, `server/src/modules/index.ts` (step 6) | `onion-architecture`, `fastify-best-practices` | ring 4 + HTTP surface, response schemas, 202/409/422 |
| `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/agents.ts`, `client/src/components/**` (step 7) | `frontend-ui-architecture`, `react-best-practices` | shared-vs-local placement, hook rules |
| `client/src/app/**/_components/**`, `client/src/vendor/ui/nav.ts` (steps 8–11) | `frontend-ui-architecture`, `react-best-practices` | placement + component rules |
| `client/src/app/eval/**/page.tsx` (steps 10, 11) | `next-best-practices` | thin async server page forwarding params to a client leaf |
| `client/**/*.test.ts(x)` (steps 0, 7–11) | `react-testing-library` | component tests with `fireEvent` and mocked hooks |

Derived from the write-time row of `.claude/skills/pr-self-review/routing.md`. `security` and `typescript-expert` are review-time (the gate). Each skill is loaded once per implementer run, at the first step that needs it.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts`, `client/src/vendor/shared/contracts/{knowledge,eval-ci}.ts`, `client/src/test/eval-contract-sync.test.ts`, `server/test/contracts.test.ts` | 0 | `node scripts/verify.mjs server client --checks` · `--file client/src/test/eval-contract-sync.test.ts` | — |
| A — server | `server/src/db/schema/eval.ts`, `server/src/db/schema.ts`, `server/src/db/rows.ts`, `server/src/db/migrations/<two new generated files + meta>`, `server/src/modules/evals/**`, `server/src/modules/_shared/review-inputs.ts`, `server/src/modules/reviews/run-executor.ts`, `server/src/modules/reviews/helpers.ts`, `server/src/modules/skills/repository.ts`, `server/src/modules/agents/repository.ts`, `server/src/modules/index.ts`, `server/eslint.config.mjs`, `server/test/evals-*.test.ts`, `server/test/evals.it.test.ts` | 1–6 | `node scripts/verify.mjs server --checks` · `--file server/test/<file>` | step 0 |
| B — client | `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/agents.ts`, `client/src/components/diff-viewer/{line-diff.ts,line-diff.test.ts,index.ts}`, `client/src/components/eval-metrics/**`, `client/src/app/skills/[id]/_components/SkillEditor/_components/VersionsTab/{VersionsTab.tsx,diff.ts,diff.test.ts}`, `client/src/app/repos/[repoId]/pulls/[number]/_components/{FindingCard,FindingsPanel,ReviewRunAccordion}/**`, `client/src/app/agents/[id]/page.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/**`, `client/src/app/eval/**`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/nav.test.ts`, `client/messages/en/{eval,prReview}.json` | 7–11 | `node scripts/verify.mjs client --checks` · `--file <test>` | step 0 |
| shared — integration | no new files; runs the full verify and the manual AC-16 check | 12 | `docker info` then `node scripts/verify.mjs server client --it` (the one full run) | A, B |

## Steps

### 0. Contracts: nullable metrics, typed cases, suite runs, mirrored byte-identically
- **Files:** [`server/src/vendor/shared/contracts/knowledge.ts`](server/src/vendor/shared/contracts/knowledge.ts) (edit) · [`server/src/vendor/shared/contracts/eval-ci.ts`](server/src/vendor/shared/contracts/eval-ci.ts) (edit) · [`client/src/vendor/shared/contracts/knowledge.ts`](client/src/vendor/shared/contracts/knowledge.ts) (edit = copy of server) · [`client/src/vendor/shared/contracts/eval-ci.ts`](client/src/vendor/shared/contracts/eval-ci.ts) (edit = copy of server; heals the `AgentManifest` / `openrouter` drift) · `client/src/test/eval-contract-sync.test.ts` (new) · [`server/test/contracts.test.ts`](server/test/contracts.test.ts) (edit)
- **Track:** shared
- **Layer:** ring 0 (contracts)
- **Skills:** `zod`, `react-testing-library` (sync test only)
- **Do:**
  - In `knowledge.ts`, `// ---- Eval ----` (`:148-183`):
    - Make `EvalRun.recall/precision/citation_accuracy` `z.number().min(0).max(1).nullable()`.
    - Add `EvalExpectation = z.enum(['must_find','must_not_flag'])`, `EvalCaseSource = z.enum(['finding','manual'])` (`manual` is used by the case-authoring sibling) and `EvalTarget = { file: string, start_line: int ≥1, end_line: int ≥1 }`.
    - Add `EvalCaseMeta = { pr_title: string, pr_body: string }` and `EvalExpectedFinding = { title: string|null, severity: string|null, category: string|null }`.
    - Extend `EvalCase` with `workspace`-free fields: `expectation`, `target: EvalTarget`, `source`, `source_finding_id: string|null`, `fingerprint: string`, `created_at: string`. Retype `input_meta: EvalCaseMeta` and `expected_output: EvalExpectedFinding`, and keep `input_diff`, `input_files`, `notes`.
  - In `eval-ci.ts`:
    - Remove `EvalRunRecord` and `EvalRunResult` (Rec. 6).
    - Make `EvalTrendPoint` metrics and `pass_rate` nullable, and add `run_id`, `agent_version`, `cases_passed:int`, `cases_total:int`.
    - Add:
      - `EvalRunKind = z.enum(['suite','single'])`
      - `EvalRunStatus = z.enum(['running','completed','partial','failed'])`
      - `EvalCaseResultStatus = z.enum(['passed','failed','errored'])`
      - `EvalRunSkill = { skill_id, name, version:int }`
      - `EvalRunCaseRef = { case_id, fingerprint }`
      - `EvalMetrics = { recall, precision, citation_accuracy }`, all `number|null`
    - `EvalSuiteRun`:
      ```
      { id, kind, owner_kind, owner_id, agent_id, agent_version:int, provider, model,
        status, error:string|null, skills:EvalRunSkill[], cases:EvalRunCaseRef[],
        cases_total:int, cases_passed:int, cases_errored:int, metrics:EvalMetrics,
        duration_ms:int|null, cost_usd:number|null, started_at, finished_at:string|null }
      ```
    - `EvalCaseResult`:
      ```
      { case_id:string|null, case_name, expectation, target, fingerprint,
        status:EvalCaseResultStatus, error:string|null, produced:int, kept:int,
        matched:int, findings:{file,start_line,end_line,title,severity}[],
        duration_ms:int|null, cost_usd:number|null }
      ```
    - `EvalSuiteRunDetail = EvalSuiteRun.extend({ results: EvalCaseResult[] })`.
    - `EvalCaseListItem = EvalCase.extend({ last_result: z.enum(['passed','failed','errored','never_run']) })`.
    - `EvalCaseList = { cases: EvalCaseListItem[], passing:int, total:int, latest_run_id:string|null }`.
    - `EvalCaseCreateResult = { case: EvalCase, created: boolean }`.
    - `EvalRegression = { metric: z.enum(['recall','precision','citation_accuracy']), drop_points: number }`.
    - `EvalAgentCard = { agent_id, agent_name, provider, model, cases_total:int, latest: EvalSuiteRun|null }`.
    - `EvalRunComparison = { older: EvalSuiteRun, newer: EvalSuiteRun, deltas: { recall, precision, citation_accuracy, cost_usd } (each number|null, newer − older), case_sets: { same: boolean, older_count:int, newer_count:int, edited_count:int }, model_changed: boolean, skills_changed: boolean }`.
    - Reshape `EvalDashboard` to:
      ```
      { owner_kind|null, owner_id|null, owner_name:string|null, cases_total:int,
        current: (EvalMetrics & { cases_passed:int, cases_total:int, cost_usd:number|null })|null,
        delta: EvalMetrics & { cases_passed: int|null } (metrics as signed points, cases_passed as a signed case count; null when either run lacks the value), trend: EvalTrendPoint[],
        recent_runs: EvalSuiteRun[], agents: EvalAgentCard[] ([] on a per-agent dashboard),
        running: EvalSuiteRun|null, regressions: EvalRegression[], alert: string|null }
      ```
  - Copy both server files over the client files, byte-for-byte.
  - The new client test (pattern of `client/src/test/brief-contract-sync.test.ts`) reads both copies of `eval-ci.ts` and `knowledge.ts` from disk, normalises `\r\n`, and expects equality.
  - `server/test/contracts.test.ts`: keep the `EvalRun` case and add one parse of `EvalRun` with `recall: null`, plus one `EvalSuiteRun` round-trip.
- **Done when:**
  - Both copies are byte-identical (the sync test is green).
  - `rg "EvalRunRecord|EvalRunResult" server/src client/src mcp/src` returns nothing.
  - Both packages typecheck.
- **Verify:** `node scripts/verify.mjs server client --checks` · `node scripts/verify.mjs client --file client/src/test/eval-contract-sync.test.ts` · `node scripts/verify.mjs server --file server/test/contracts.test.ts`

### 1. Schema: typed cases, run header, per-case results (two generated migrations)
- **Files:** [`server/src/db/schema/eval.ts`](server/src/db/schema/eval.ts) (edit) · [`server/src/db/schema.ts`](server/src/db/schema.ts) (edit, export `evalRunCases` beside `:77-78`) · [`server/src/db/rows.ts`](server/src/db/rows.ts) (edit, add `EvalCaseRow`, `EvalRunRow`, `EvalRunCaseRow`) · `server/src/db/migrations/00NN_*.sql` ×2 + `meta/*` (new, **generated**)
- **Track:** A
- **Layer:** ring 3 (db)
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`
- **Do:**
  - **Pass 1 (additive only), then `cd server && pnpm db:generate`:**
    - `eval_cases` gets:
      - `source` text enum `['finding','manual']` not null default `'finding'`.
      - `source_finding_id` uuid → `findings.id` **on delete set null**.
      - `expectation` text enum `['must_find','must_not_flag']` not null.
      - `target_file` text not null; `target_start_line`, `target_end_line` int not null.
      - `fingerprint` text not null; `created_at` (`now()` helper from `./_shared`).
      - Indexes: `eval_cases_owner_idx(owner_kind, owner_id)` and `eval_cases_ws_idx(workspace_id)`.
      - **Unique** `eval_cases_owner_source_uq(owner_id, source_finding_id)` (NULLs do not collide, so manual cases are unaffected; this backs EC-2).
    - `eval_runs` gets:
      - `workspace_id` uuid not null → workspaces cascade.
      - `kind` text enum `['suite','single']` not null default `'suite'`.
      - `owner_kind` text enum `['skill','agent']` not null; `owner_id` uuid not null.
      - `agent_id` uuid not null → `agents.id` **cascade** (NFR-6). For a skill run (sibling) this is the host agent.
      - `agent_version` int not null; `provider`, `model` text not null.
      - `status` text enum `['running','completed','partial','failed']` not null; `error` text.
      - `skills` jsonb not null default `[]`; `case_refs` jsonb not null default `[]`.
      - `cases_total`, `cases_passed`, `cases_errored` int not null default 0.
      - `finished_at` timestamptz.
      - Keep `ran_at` (it is the start time) and `recall`, `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`.
      - Indexes: `eval_runs_agent_ran_idx(agent_id, ran_at)` and `eval_runs_ws_idx(workspace_id)`.
      - **Partial unique** `eval_runs_one_running_suite_uq(agent_id) WHERE status = 'running' AND kind = 'suite'` (backs EC-6, race-safe; single-case runs in the sibling are not blocked by it).
    - New `eval_run_cases`:
      - `id` uuid pk; `run_id` → `eval_runs` cascade; `case_id` uuid → `eval_cases` **on delete set null** (AC-5).
      - `case_name` text not null; `expectation`, `target_file`, `target_start_line`, `target_end_line`, `fingerprint`.
      - `status` text enum `['passed','failed','errored']` not null; `error` text.
      - `produced`, `kept`, `matched`, `nmf_hits` int not null default 0. `nmf_hits` is the number of kept findings matching a `must_not_flag` target, and it feeds precision.
      - `findings` jsonb not null default `[]`; `duration_ms` int; `cost_usd` double.
      - Indexes on `run_id` and `case_id`.
  - **Pass 2 (drop only), then `pnpm db:generate` again:** remove `caseId`, `actualOutput` and `pass` from `evalRuns`.
  - Assert the existing tables are empty before generating: no code path writes `eval_cases` / `eval_runs` today (`rg evalRuns server/src` lists only the schema), so the NOT NULL adds are safe. Note it in the step report.
- **Done when:**
  - Two new migration files exist and were produced by `pnpm db:generate` with no interactive prompt.
  - `rg "case_id|actual_output" server/src/db/schema/eval.ts` shows only `eval_run_cases.case_id`.
  - With Docker up, `cd server && pnpm db:migrate` applies cleanly.
- **Verify:** `node scripts/verify.mjs server --checks`

### 2. Shared review inputs, skill versions, agent-delete cascade
- **Files:** `server/src/modules/_shared/review-inputs.ts` (new) · [`server/eslint.config.mjs`](server/eslint.config.mjs) (edit, add the file to `RING_2` at `:114-127`) · [`server/src/modules/reviews/run-executor.ts`](server/src/modules/reviews/run-executor.ts) (edit `:20-28`, `:397-407`) · [`server/src/modules/reviews/helpers.ts`](server/src/modules/reviews/helpers.ts) (edit `taskLine` `:82-91`) · [`server/src/modules/skills/repository.ts`](server/src/modules/skills/repository.ts) (edit `blocksForAgent` `:207-220`) · [`server/src/modules/agents/repository.ts`](server/src/modules/agents/repository.ts) (edit `deleteById` `:77-83`)
- **Track:** A
- **Layer:** `_shared/review-inputs.ts` ring 2; repositories ring 3
- **Skills:** `onion-architecture`, `drizzle-orm-patterns` (already loaded)
- **Do:**
  - `review-inputs.ts` exports:
    - `TRUSTED_SKILL_SOURCES` (moved verbatim, comment included).
    - `skillBlockBody(row: { id: string; source: string; body: string }): string` (trusted → body, else `wrapUntrusted(\`skill-${id}\`, body)` from `@devdigest/reviewer-core`).
    - `REVIEW_TASK_RULES`: the exact sentence block after the PR identity in `taskLine`, i.e. the text beginning `Report only the distinct, high-value findings` through `"do not flag").`
  - `taskLine(pull)` becomes `` `Review pull request #${pull.number} "${pull.title}" by ${pull.author}. ` + REVIEW_TASK_RULES ``, and its output is **byte-identical** to today. `run-executor.ts` uses `skillBlockBody`.
  - `blocksForAgent` additionally selects `name: t.skills.name, version: t.skills.version` (additive; existing callers ignore them).
  - `deleteById` runs in a transaction that first deletes `eval_cases` where `workspace_id = ws AND owner_kind = 'agent' AND owner_id = id`, then the agent. Runs and per-case rows go by FK cascade.
- **Done when:**
  - `server/test/reviews-helpers.test.ts` and `server/test/prompt-skills.test.ts` pass unchanged.
  - `rg "TRUSTED_SKILL_SOURCES" server/src` shows only `_shared/review-inputs.ts`.
- **Verify:** `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs server --file server/test/reviews-helpers.test.ts --file server/test/prompt-skills.test.ts`

### 3. Pure eval logic: freezing, matching, scoring, deltas, comparison
- **Files:** `server/src/modules/evals/constants.ts` (new) · `server/src/modules/evals/helpers.ts` (new) · `server/test/evals-helpers.test.ts` (new)
- **Track:** A
- **Layer:** ring 2 (pure; `node:crypto` allowed; no zod/db/adapters)
- **Skills:** `onion-architecture`
- **Do:**
  - `constants.ts`:
    - `MAX_FROZEN_DIFF_BYTES = 65_536`, `MAX_PR_TITLE_CHARS = 300`, `MAX_PR_BODY_BYTES = 16_384`, `MAX_CASE_NAME_CHARS = 120`.
    - `MAX_CASES_PER_AGENT = 200`, `EVAL_CONCURRENCY = 3`, `EVAL_CASE_TIMEOUT_MS = 120_000`, `EVAL_ADAPTER_TIMEOUT_MS = EVAL_CASE_TIMEOUT_MS + 5_000`.
    - `RUNS_PAGE_SIZE = 20`, `INTERRUPTED_REASON = 'interrupted: the API restarted while the run was in progress'`.
  - `helpers.ts`. Signatures below are illustrations, and each function is pure:
    - `extractFileDiff(raw: string, path: string): string | null` returns the block from a `diff --git` header whose `b/` path **equals** `path` up to the next header. Do not use `sliceDiff` (substring match, `reviewer-core/src/review/reduce.ts:64`). `patchToFileDiff(path, patch)` builds `diff --git a/p b/p\n--- a/p\n+++ b/p\n<patch>` (the `diffFromPrFiles` shape).
    - `freezeDiff(fileDiff, start, end): { ok: true; diff: string; trimmed: boolean } | { ok: false; reason: 'diff_too_large' | 'target_outside_diff' }`:
      - Byte size ≤ cap → as-is.
      - Otherwise keep the header plus the hunks whose **new-side** range `[c, c+max(d,1)-1]` overlaps `[start,end]` (inclusive).
      - No overlapping hunk → `target_outside_diff`; still over the cap → `diff_too_large`.
    - `truncateChars(s, n)`, and `truncateUtf8(s, maxBytes)`, which never splits a code point.
    - `caseFingerprint({ input_diff, pr_title, pr_body, expectation, file, start_line, end_line })` returns the sha256 hex of `JSON.stringify` of an **array** in that fixed order.
    - `findingMatches(f: {file,start_line,end_line}, t: EvalTarget): boolean` is `f.file === t.file && f.start_line <= t.end_line && t.start_line <= f.end_line`. Exact, case-sensitive and inclusive.
    - `scoreCase(expectation, target, kept: Finding[], droppedCount)` returns `{ status: 'passed'|'failed', produced: kept.length + droppedCount, kept: kept.length, matched, nmf_hits }`. `must_find` passes iff `matched ≥ 1`; `must_not_flag` passes iff `matched === 0`, and its `nmf_hits = matched`.
    - `aggregateRun(results)` returns metrics, counts, status, cost:
      - `recall` = passed `must_find` / non-errored `must_find`.
      - `precision` = 1 − Σ`nmf_hits` / Σ`kept` over non-errored cases.
      - `citation_accuracy` = Σ`kept` / Σ`produced` over non-errored cases.
      - Each metric is `null` when its denominator is 0.
      - `cases_passed` = count of `passed`.
      - Status is `completed` (0 errored), `partial` (some errored), or `failed` (all errored).
      - `cost_usd` = sum over non-errored; `null` if any non-errored cost is `null` or if every case errored.
    - `metricDelta(newer, older)` returns signed points `round1((newer − older) * 100)` or `null` if either side is `null`. `passDelta(newer, older)` returns the signed integer `newer.cases_passed − older.cases_passed` (AC-10), `null` when either run is missing. `regressions(latest, previous)` returns the `EvalRegression[]` for each metric where both are non-null and latest < previous, with `drop_points` > 0.
    - `compareCaseSets(olderRefs, newerRefs)` returns `{ same, older_count, newer_count, edited_count }`. `edited_count` counts case ids present in both with different fingerprints. `same` holds iff the id sets are equal and `edited_count === 0`.
    - `skillsChanged(a, b)` compares the ordered `(skill_id, version)` lists.
    - `evalTaskLine(meta)` returns `` `Review pull request "${meta.pr_title}". ` + REVIEW_TASK_RULES `` (from `../_shared/review-inputs.js`).
- **Done when:** `evals-helpers.test.ts` pins, at minimum:
  - Matching:
    - Exact overlap.
    - Edge overlap: finding `[10,12]` vs target `[12,14]` → match.
    - Adjacent miss: `[10,11]` vs `[12,14]` → no match.
    - Case variant: `src/Config.ts` vs `src/config.ts` → no match.
    - Near-miss path: `src/config.tsx` vs `src/config.ts` → no match.
    - Root-level file: `README.md` → match.
  - `extractFileDiff`: `src/a.ts` does **not** capture `src/a.tsx`'s block.
  - Diff cap: a 65 536-byte diff is kept untrimmed, a 65 537-byte one is trimmed to the overlapping hunks, and an overlapping hunk that alone exceeds the cap → `diff_too_large`.
  - Name: 120 chars kept, 121 → 120.
  - Body: a multibyte char at byte 16 384 is not split.
  - Every empty denominator → `null`, never 0 or 1:
    - no `must_find` → recall `null`;
    - zero kept → precision `null`;
    - zero produced → citation `null`.
  - The same inputs give identical output (NFR-2).
  - Fingerprints differ when any one field changes.
  - Status derivation for 0 / some / all errored.
  - Cost `null` poisoning.
  - `regressions` ignores `null`.
  - `passDelta`: `5 → 3` gives `-2`, `3 → 5` gives `+2`, a missing older run gives `null`.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-helpers.test.ts`

### 4. Evals repository
- **Files:** `server/src/modules/evals/repository.ts` (new)
- **Track:** A
- **Layer:** ring 3
- **Skills:** `drizzle-orm-patterns`
- **Do:** Every read and write is scoped by `workspace_id`. It provides:
  - `findingSource(findingId)` returns `{ finding, review, pull, repo, prFilePatch(path) }`, reading `findings`, `reviews`, `pull_requests`, `repos`, `pr_files` directly (no import of `modules/reviews`).
  - `countCases(ws, agentId)`.
  - `insertCaseIfAbsent(row)`: `onConflictDoNothing` on `eval_cases_owner_source_uq`, then select the existing row and return `{ row, created }`.
  - `listCases(ws, ownerKind, ownerId)`; `getCase(ws, id)`; `deleteCase(ws, id)`.
  - `insertRunningRun(row)`: map a Postgres `23505` on `eval_runs_one_running_suite_uq` to a typed `RunAlreadyRunning` result, never a thrown 500.
  - `insertCaseResult(row)`; `finishRun(id, patch)`.
  - `failStaleRunning(ws, agentId | null, activeIds: string[], reason)`: `UPDATE … SET status='failed', error=reason, finished_at=now() WHERE status='running' AND id NOT IN activeIds`.
  - `listRuns(ws, agentId, { kind: 'suite', limit, statuses? })` returns newest first.
  - `getRunWithResults(ws, id)`; `latestCompletedRuns(ws, agentId, n)` (status in `completed`, `partial`).
  - `agentsWithCases(ws)`; `recentRuns(ws, limit)`.
  - Every run query filters `kind = 'suite'` (NFR-12).
- **Done when:** the file compiles inside the ring-3 lint zone. Behaviour is covered by step 6's it-test.
- **Verify:** `node scripts/verify.mjs server --checks`

### 5. Evals service: create case, run executor, reads, dashboards, compare
- **Files:** `server/src/modules/evals/service.ts` (new) · `server/test/evals-service.test.ts` (new)
- **Track:** A
- **Layer:** ring 2. The constructor takes a deps object (the brief precedent, `server/src/modules/brief/routes.ts:29-46`); no `Container`.
- **Skills:** `onion-architecture`
- **Do:**
  - Deps:
    - `repo` (EvalsRepository-shaped)
    - `agents: { getById(ws,id) }`
    - `skills: { blocksForAgent(agentId) }`
    - `git: () => Promise<{ diff(repoRef, base, head) }>`
    - `parseDiff: (raw) => UnifiedDiff`
    - `llm: (provider) => Promise<LLMProvider>`
    - `review: typeof reviewPullRequest`
    - `log`
    - `caseTimeoutMs`, `adapterTimeoutMs`, `concurrency`
    - `now`
  - `createFromFinding(ws, findingId)`. Error mapping uses `AppError(code, msg, status, details)` from `platform/errors.ts`:
    - Missing / other workspace / no `review.agentId` / agent not found via `agents.getById` → `NotFoundError` (EC-3).
    - Neither `acceptedAt` nor `dismissedAt` → 422 `eval_case_rejected` `{reason:'finding_undecided'}` (EC-1).
    - Count ≥ 200 → 422 `{reason:'case_limit'}`.
    - Diff for `finding.file`: `pr_files.patch` for that exact path; else `git.diff(repo, pull.base, pull.headSha)` + `extractFileDiff`; else 422 `{reason:'diff_unavailable'}`.
    - `freezeDiff` failure → 422 `{reason}` (EC-12).
    - Expectation: `acceptedAt` → `must_find`, `dismissedAt` → `must_not_flag` (AC-2/3).
    - Name = `truncateChars(finding.title, 120)`. Meta = `{ pr_title: truncateChars(title,300), pr_body: truncateUtf8(body ?? '', 16_384) }`. `expected_output = { title, severity, category }`. `source:'finding'`. Fingerprint from step 3.
    - Insert, and return `{ case, created }`.
  - `listCases(ws, agentId)` (404 if the agent is not in the workspace) returns `EvalCaseList`. `last_result` comes from the latest completed suite run's `eval_run_cases` by `case_id`; it is `never_run` if absent. `passing` / `total` cover the current cases only.
  - `deleteCase(ws, id)`.
  - `startRun(ws, agentId)`:
    1. 404 if the agent is missing.
    2. `failStaleRunning(ws, agentId, [...this.active])`.
    3. Zero cases → 422 `eval_set_empty`, message `Agent "<name>" has no eval cases` (EC-5).
    4. Snapshot `skills = blocksForAgent` → `[{skill_id,name,version}]` plus bodies via `skillBlockBody`, and `case_refs`.
    5. `runId = randomUUID()` (`node:crypto`, allowed in ring 2) and add it to `this.active` **before** the insert, so a concurrent read's `failStaleRunning` cannot mark the new row interrupted between the insert and the bookkeeping. `insertRunningRun({ id: runId, … })`; a conflict → remove the id from `this.active` and answer 409 `eval_run_in_progress` `{run_id}` of the active run (EC-6).
    6. Fire `void this.execute(...)` with a `.catch` that marks the run failed and removes the id from `this.active`, and **return the running run immediately** (AC-6).
  - `execute`:
    - Log start (NFR-10).
    - Resolve `llm` once. On a throw (e.g. a missing key) every case is errored with that message, and the run ends `failed`.
    - Wrap the provider: `completeStructured: (req) => inner.completeStructured({ ...req, maxRetries: 0, timeoutMs: adapterTimeoutMs })`; the other methods are forwarded.
    - A worker pool with ≤ `concurrency` cases in flight. For each case:
      - `parseDiff(input_diff)`.
      - `review({ systemPrompt: agent.systemPrompt, model: agent.model, diff, llm: wrapped, strategy: agent.strategy, skills: bodies.length ? bodies : undefined, prDescription: pr_body || undefined, task: evalTaskLine(meta), maxRetries: 0, sessionId: \`eval:${runId}:${caseId}\` })`, raced against a `caseTimeoutMs` timer that rejects with `timeout after 120 s`, clearing the timer. `skills` is `undefined` for an agent without enabled skills, exactly as `buildSkillBlocks` does, so the prompt layout matches a live review. A review result that arrives **after** the timer fired is discarded, never inserted; the pool slot is released when the race settles, not when the late call returns.
      - **No** `intent`, `callers`, `repoMap`, `specs` or `memory` (AC-7).
      - `scoreCase(…, outcome.review.findings, outcome.dropped.length)` → insert the case result with the compact kept findings.
      - On any throw → insert `errored` with `error: err.message` (EC-7).
      - Log each case outcome.
    - When the pool drains: `aggregateRun` → `finishRun(status, metrics, counts, duration, cost, finished_at)`, remove the id from `this.active`, log the end.
    - The executor never touches reviews, findings, agent_runs, `markReviewed` or the run bus (NFR-4).
  - Reads: each first calls `failStaleRunning` with `this.active`, so a run orphaned by an API restart reads as `failed` with `INTERRUPTED_REASON` (EC-7).
    - `listRuns(ws, agentId, limit=20)`.
    - `getRun(ws, id)` → `EvalSuiteRunDetail`.
    - `compare(ws, agentId, a, b)`: `a === b` or either run not of this agent → 422 `eval_compare_invalid`. Order by `started_at`, then `metricDelta` per metric, `cost_usd` delta (`null` if either is `null`), `compareCaseSets`, `model_changed` (provider/model differ) and `skillsChanged`.
    - `agentDashboard(ws, agentId)`: `current` and `delta` from the latest two completed runs (`delta.cases_passed` via `passDelta`, the three metrics via `metricDelta`), `trend` = every completed suite run ascending, `recent_runs` = 20 newest suite runs of any status, `running`, `regressions`, and `alert` = an English one-liner or `null`.
    - `workspaceDashboard(ws)`: `agents` = one card per agent with ≥ 1 case (`agentsWithCases`) plus its latest completed run, and `recent_runs` = the 20 newest across agents.
- **Done when:** `evals-service.test.ts` (in-memory fakes, `MockLLMProvider` from `src/adapters/mocks.ts`, and a `review` fake where needed) proves:
  - (a) exactly one `completeStructured` call per case, each with `maxRetries: 0` and `timeoutMs: 125000`, and zero calls to any other port;
  - (b) never more than 3 concurrent `review` calls, using a fake that counts in-flight calls with 7 cases;
  - (c) a case whose `review` never resolves is `errored` after `caseTimeoutMs` (inject `caseTimeoutMs: 50`), and the run is `partial`;
  - (d) all errored → `failed`;
  - (e) an `llm()` that throws `OPENAI_API_KEY is not configured` → every case errored with that reason;
  - (f) the second `startRun` while one is active → 409;
  - (g) a `running` row not in `active` reads as `failed` with `INTERRUPTED_REASON`;
  - (h) the review input for a case carries no `intent` / `repoMap` / `callers` / `specs` key, and `prDescription` equals the frozen body;
  - (i) a `review` that resolves after the timeout fired leaves exactly one `errored` result for that case (the late result is dropped) and the run's `cases_total` equals the case count;
  - (j) a read that races `startRun` (call `listRuns` right after `insertRunningRun` resolves, before `execute` has done anything) does not mark the new run `failed`.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-service.test.ts`

### 6. Routes, registration, integration test
- **Files:** `server/src/modules/evals/routes.ts` (new) · [`server/src/modules/index.ts`](server/src/modules/index.ts) (edit: one import, one `evals` entry) · `server/test/evals.it.test.ts` (new)
- **Track:** A
- **Layer:** ring 4
- **Skills:** `fastify-best-practices` (+ `onion-architecture`, already loaded)
- **Do:**
  - Build `EvalsService` once per plugin, with:
    - `repo: new EvalsRepository(container.db)`
    - `agents: container.agentsRepo`
    - `skills: container.skillsRepo`
    - `git: () => Promise.resolve(container.git)`, or the container accessor in use
    - `parseDiff: parseUnifiedDiff` from `../../adapters/git/diff-parser.js`
    - `llm: (p) => container.llm(p, { singleShot: { timeoutMs: EVAL_ADAPTER_TIMEOUT_MS } })`
    - `review: reviewPullRequest`
    - `log: app.log`
    - the constants
  - Use lazy `container.*` reads, as brief does.
  - Every route uses `getContext(container, req)` and declares zod schemas from `@devdigest/shared` (`IdParams` from `../_shared/schemas.js`):
    | Route | Params / query / body | Responses |
    |---|---|---|
    | `POST /findings/:id/eval-case` | body `z.object({}).strict()` | `201 EvalCaseCreateResult` when created, `200` when it existed (EC-2) |
    | `GET /agents/:id/eval-cases` | — | `200 EvalCaseList` |
    | `DELETE /eval-cases/:id` | — | `200 { ok: true }` |
    | `POST /agents/:id/eval-runs` | body `z.object({}).strict()` | `202 EvalSuiteRun` |
    | `GET /agents/:id/eval-runs` | querystring `limit` coerce int 1–100, default 20 | `200 EvalSuiteRun[]` |
    | `GET /agents/:id/eval-runs/compare` | querystring `{ a: uuid, b: uuid }` strict | `200 EvalRunComparison` |
    | `GET /eval-runs/:id` | — | `200 EvalSuiteRunDetail` |
    | `GET /eval/dashboard` | — | `200 EvalDashboard` |
    | `GET /agents/:id/eval-dashboard` | — | `200 EvalDashboard` |
  - Register `compare` before any `/:id` sibling route that could shadow it.
- **Done when:** `evals.it.test.ts` uses `startPg` + `buildApp`, with overrides `{ intent: <stub that throws if called>, git: new MockGitClient({diff}), llm: { openai: new MockLLMProvider('openai', { structured }) } }`. It seeds an agent, a PR with `pr_files.patch`, a review with `agentId` and findings, and proves:
  - AC-2 / AC-3: accept → POST → 201 `must_find` with the frozen diff, `pr_title`, `pr_body`, target and `source_finding_id`. Dismiss → `must_not_flag`.
  - EC-2: a second POST → 200 `created:false` with the same id.
  - EC-1: an undecided finding → 422 `finding_undecided`.
  - EC-3: a review with `agentId` null → 404, and a deleted agent → 404.
  - EC-12: a patch > 65 536 bytes with a small overlapping hunk → 201 with a trimmed diff, and an overlapping hunk > cap → 422 `diff_too_large`.
  - EC-4 / NFR-3: flip the disposition, update `pr_files.patch`, delete the review → the case is unchanged, and `source_finding_id` is null after the delete.
  - NFR-6: deleting the PR removes no case.
  - AC-6: POST run → 202 `status:'running'` before completion. Poll `GET /eval-runs/:id` until terminal, with up to 10 s and a short sleep.
  - EC-6: a second POST while running → 409, using a `review`-blocking LLM mock or by inserting a `running` row for an active id.
  - EC-5: zero cases → 422 `eval_set_empty`.
  - AC-7 / NFR-1: the mock saw exactly N `completeStructured` calls for N cases, and the intent stub was never called. The first message set contains the frozen PR title and does not contain `Repo skeleton` / `Callers` / `Project context` section headers.
  - AC-9: the run row carries `agent_version`, `skills` with versions, `case_refs` with fingerprints, metrics, `cases_passed` and `duration_ms`.
  - NFR-4: the `reviews`, `findings` and `agent_runs` counts and `pull_requests` reviewed sha are unchanged by the run.
  - AC-5: delete a case → 200, and the old run's results keep a row with `case_id` null and its `case_name`.
  - NFR-6: delete the agent → its cases and runs are gone.
  - UI-1: a non-uuid id → 422, and another workspace's id → 404.
  - UI-2: an extra body key → 422.
  - UI-3: compare with `a===b` → 422; compare across agents → 422; compare of two runs where a case was deleted in between → `case_sets.same:false` (EC-9 data).
  - NFR-10: `GET /eval-runs/:id` exposes an errored case's `error`. Use a mock whose `structured` fails the `Review` schema → `errored`, run `partial`.
- **Verify:** `docker info` (must succeed; otherwise report "it-lane not executed") · `node scripts/verify.mjs server --file server/test/evals.it.test.ts` · `node scripts/verify.mjs server --checks`

### 7. Client data layer and shared eval display pieces
- **Files:**
  - `client/src/lib/hooks/evals.ts` (new)
  - [`client/src/lib/hooks/agents.ts`](client/src/lib/hooks/agents.ts) (edit: add `useAgentVersion(agentId, version)` → `GET /agents/:id/versions/:version`, key `["agent-version", id, version]`, `retry: false`)
  - `client/src/components/diff-viewer/line-diff.ts` + `line-diff.test.ts` (new, **moved** from `client/src/app/skills/[id]/_components/SkillEditor/_components/VersionsTab/diff.ts` + `diff.test.ts`, which are deleted)
  - [`client/src/components/diff-viewer/index.ts`](client/src/components/diff-viewer/index.ts) (edit: export `diffLines`, `isUnchanged`, and update the header comment)
  - [`.../VersionsTab/VersionsTab.tsx`](client/src/app/skills/[id]/_components/SkillEditor/_components/VersionsTab/VersionsTab.tsx) (edit: import from `@/components/diff-viewer`)
  - `client/src/components/eval-metrics/{index.ts, format.ts, format.test.ts, MetricDelta/MetricDelta.tsx, MetricDelta/MetricDelta.test.tsx, MetricDelta/index.ts}` (new)
- **Track:** B
- **Layer:** `src/lib/hooks` (data), `src/components` (shared by `/agents/[id]` and `/eval/**`)
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- **Do:**
  - `evals.ts` exports key builders (`evalCasesKey(agentId)`, `evalRunsKey(agentId)`, `evalRunKey(id)`, `evalDashboardKey()`, `agentEvalDashboardKey(agentId)`, `evalCompareKey(agentId,a,b)`) and these hooks:
    - `useAgentEvalCases`.
    - `useCreateEvalCaseFromFinding()`: `api.post('/findings/:id/eval-case', {})`; on success invalidate cases + dashboards.
    - `useDeleteEvalCase(agentId)`.
    - `useAgentEvalRuns(agentId)` with `refetchInterval: (q) => q.state.data?.some(r => r.status === 'running') ? 2000 : false`.
    - `useStartEvalRun(agentId)`: `api.post(..., {})`; invalidate runs + dashboards + cases.
    - `useEvalRun(id)`.
    - `useEvalRunComparison(agentId, a, b)` (enabled only with two ids).
    - `useEvalDashboard()`.
    - `useAgentEvalDashboard(agentId)`, which polls 2 s while `running` is non-null.
  - Types come only from `@devdigest/shared`.
  - `format.ts`:
    - `formatMetric(v: number|null)` → `"82.5%"` or `"—"`.
    - `formatDeltaPoints(d: number|null)` → `"+3.0"`, `"−2.5"`, `"0.0"` or `"—"`.
    - Re-use `formatRunCost` from `@/components/run-cost-badge` for cost; `null` → `"—"`.
  - `MetricDelta({ value, unit })` renders text with a sign glyph, not colour alone (NFR-8): `▲ +3.0 pts` / `▼ −2.5 pts` / `= 0.0 pts` / `—`. `unit` is `'points'` (one decimal) or `'cases'` (integer, for the pass tile, AC-10). The unit strings come from `eval.json`: `metrics.points` = `"{value} pts"`, `metrics.cases` = `"{value} cases"`.
- **Done when:**
  - `line-diff.test.ts` (the moved tests) passes.
  - `rg "VersionsTab/diff" client/src` is empty.
  - `format.test.ts` pins `null → "—"` for metric, delta and cost, plus `0 → "0.0%"`.
  - `MetricDelta.test.tsx` asserts the sign glyph and the text for positive, negative, zero and `null`, in both units (`+3.0 pts`, `+2 cases`).
- **Verify:** `node scripts/verify.mjs client --file client/src/components/diff-viewer/line-diff.test.ts --file client/src/components/eval-metrics/format.test.ts --file client/src/components/eval-metrics/MetricDelta/MetricDelta.test.tsx` · `node scripts/verify.mjs client --checks`

### 8. FindingCard: "Turn into eval case"
- **Files:** [`.../_components/FindingCard/FindingCard.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx) (edit) · [`FindingCard.test.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx) (edit) · [`.../FindingsPanel/FindingsPanel.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx) (edit) · [`.../ReviewRunAccordion/ReviewRunAccordion.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx) (edit) · [`client/messages/en/prReview.json`](client/messages/en/prReview.json) (edit, keys under `finding`)
- **Track:** B
- **Layer:** route-local feature components
- **Skills:** (loaded)
- **Do:**
  - `ReviewRunAccordion` passes `evalAgentAvailable={!!review.agent_id && !!review.agent_name}` to `FindingsPanel` (EC-3: `agent_name` is null when the agent is gone).
  - `FindingsPanel` owns `useCreateEvalCaseFromFinding()` and a per-finding status map. It passes these optional props to `FindingCard`: `evalAvailable`, `onTurnIntoEval`, `evalPending`, `evalStatus: 'created'|'exists'|'too_large'|'error'|null`.
  - Map an `ApiError` with `status 422` and `details.reason === 'diff_too_large'` → `too_large`, and any other error → `error`.
  - In `FindingCard`'s action row, after Dismiss (only when `evalAvailable`), add a `Button kind="ghost" size="sm" icon="FlaskConical"`:
    - enabled iff `accepted || dismissed` (AC-1);
    - otherwise `disabled`, with `title` and visible helper text = the EC-1 string.
  - After success, show an inline `role="status"` line with the status text.
  - **Literal copy** (add to `prReview.json` → `finding`):
    - `"turnIntoEvalCase": "Turn into eval case"`
    - `"evalNeedsDecision": "Accept or dismiss this finding first to turn it into an eval case."`
    - `"evalCaseCreated": "Eval case created."`
    - `"evalCaseExists": "This finding is already an eval case."`
    - `"evalDiffTooLarge": "The diff is too large to freeze as an eval case."`
    - `"evalCaseFailed": "Could not create the eval case."`
- **Done when:** `FindingCard.test.tsx` adds:
  - the button named "Turn into eval case" is present and enabled for an accepted finding and for a dismissed one;
  - it is disabled with the EC-1 text for an undecided finding;
  - it is absent when `evalAvailable` is false or omitted (EC-3 / DiffTab);
  - clicking calls `onTurnIntoEval`;
  - each `evalStatus` renders its exact string (AC-2 confirmation, EC-2, EC-12).
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx"`

### 9. AgentEditor Evals tab
- **Files:**
  - [`client/src/app/agents/[id]/_components/AgentEditor/constants.ts`](client/src/app/agents/[id]/_components/AgentEditor/constants.ts) (edit: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }`; the label already exists in `agents.json`)
  - [`AgentEditor.tsx`](client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx) (edit: render `EvalsTab` for `tab === "evals"` and exclude it from the Config fallback)
  - [`client/src/app/agents/[id]/page.tsx`](client/src/app/agents/[id]/page.tsx) (edit `:15`, add `"evals"` to `VALID_TABS`)
  - `.../AgentEditor/_components/EvalsTab/{EvalsTab.tsx, EvalsTab.test.tsx, index.ts, styles.ts, helpers.ts}` (new)
  - [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit `evalsTab`)
- **Track:** B
- **Layer:** route-local feature folder
- **Skills:** (loaded)
- **Do:**
  - Metric strip (AC-10): three `MetricCard`s (value = `formatMetric`, with a `MetricDelta unit="points"` rendered inside the value node; do **not** pass `MetricCard.delta`, which is unsigned and icon-only) plus a pass tile showing `cases_passed / cases_total` with its own `MetricDelta unit="cases"` from `delta.cases_passed`. All four tiles carry a signed change (AC-10). Data comes from `useAgentEvalDashboard`; no completed run → "—".
  - "Run all evals" button:
    - disabled when the case count is 0 (EC-5), with helper text;
    - while `dashboard.running` is set → disabled, with the running label (AC-6);
    - a 409 from start → no error toast; refetch so the running run shows (EC-6).
  - Case list (AC-4):
    - header `"{passing} / {total} passing"`;
    - each row shows name (plain text), expectation label, `file:start` or `file:start–end`, and a result badge with text (passed / failed / errored / never run; NFR-8);
    - a Delete icon button with an accessible name opens `ConfirmModal` from `@/components/confirm-modal`; confirm → `useDeleteEvalCase` (AC-5).
  - Empty state when there are no cases.
  - **Literal copy** to add (keep existing keys):
    - `evalsTab.runAll`: `"Run all evals"`
    - `evalsTab.runAllEmpty`: `"Add a case first: turn an accepted or dismissed finding into an eval case."`
    - `evalsTab.passingCount`: `"{passing} / {total} passing"`
    - `evalsTab.mustFind`: `"must find"`
    - `evalsTab.mustNotFlag`: `"must not flag"`
    - `evalsTab.errored`: `"errored"`
    - `evalsTab.deleteTitle`: `"Delete eval case?"`
    - `evalsTab.deleteBody`: `"Past runs keep their recorded result for this case."`
    - `evalsTab.passTile`: `"PASS"`
    - `evalsTab.emptyCases` replaced by `"No eval cases yet. Accept or dismiss a finding on a pull request, then use “Turn into eval case”."`
    - `metrics.points`: `"{value} pts"` and `metrics.cases`: `"{value} cases"` (top-level `metrics` object)
  - Reuse `evalsTab.neverRun`, `passed`, `failed`, `running`, `delete` and `dashboard.metrics.*`.
- **Done when:** `EvalsTab.test.tsx` (hooks mocked via `vi.mock("@/lib/hooks/evals")`) covers:
  - rows with each result text and `file:line`;
  - the "2 / 3 passing" header;
  - "—" for a `null` metric, a signed points delta on a metric tile and a signed case delta on the pass tile;
  - Run disabled with 0 cases;
  - Run disabled and showing the running label while running;
  - Delete → confirm → mutation called with the case id.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx"` · `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx"`

### 10. Sidebar entry and Eval Dashboard landing
- **Files:**
  - [`client/src/vendor/ui/nav.ts`](client/src/vendor/ui/nav.ts) (edit, app-owned exception: append `{ key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/eval" }` to `SKILLS LAB` after `conventions`; the key must be `eval` to match `activeKeyFor` and `shell.json nav.eval`; say so in the commit)
  - [`client/src/components/app-shell/nav.test.ts`](client/src/components/app-shell/nav.test.ts) (edit: assert the entry and `activeKeyFor("/eval/x") === "eval"`)
  - `client/src/app/eval/page.tsx` (new, async server page rendering `<EvalDashboardView />`)
  - `client/src/app/eval/_components/EvalDashboardView/{EvalDashboardView.tsx, EvalDashboardView.test.tsx, index.ts, styles.ts}` (new)
  - `client/src/app/eval/_components/EvalDashboardView/_components/AgentEvalCard/{AgentEvalCard.tsx, index.ts}` (new)
  - `client/messages/en/eval.json` (edit `dashboard`)
- **Track:** B
- **Layer:** App Router segment `/eval`
- **Skills:** `next-best-practices`
- **Do:**
  - `AppShell` crumb uses `page.crumbSkillsLab` › `page.crumbEvalDashboard`.
  - One card per `dashboard.agents` (AC-11): agent name, model, `v{latest.agent_version}` and date, `{passed}/{total}`, and the three metrics via `formatMetric`. The card links to `/eval/{agent_id}`.
  - Below the cards, a recent-runs table (agent, date, version, recall, precision, citation, pass, cost, status).
  - Empty state when `agents` is empty (EC-10).
  - **Literal copy:**
    - `dashboard.emptyTitle`: `"No eval cases yet"`
    - `dashboard.emptyBody`: `"Eval cases are made from findings you accepted or dismissed. Open a pull request review and use “Turn into eval case”."`
    - `dashboard.recentRunsAll`: `"Recent eval runs"`
    - `dashboard.table.agent`: `"Agent"`
    - `dashboard.table.version`: `"Version"`
    - `dashboard.table.status`: `"Status"`
    - `dashboard.status.running`: `"running"`, `.completed`: `"completed"`, `.partial`: `"partial"`, `.failed`: `"failed"`
- **Done when:**
  - `EvalDashboardView.test.tsx` covers: two agent cards with model, version and "—" for a `null` metric; the recent runs rows; the empty state text when `agents: []`.
  - `nav.test.ts` is green.
- **Verify:** `node scripts/verify.mjs client --file client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx --file client/src/components/app-shell/nav.test.ts`

### 11. Agent eval page: tiles, regression banner, trend, runs table, Compare modal
- **Files:**
  - `client/src/app/eval/[agentId]/page.tsx` (new, async server page: `await params`, render `<AgentEvalView agentId={agentId} />`)
  - `client/src/app/eval/[agentId]/_components/AgentEvalView/{AgentEvalView.tsx, AgentEvalView.test.tsx, index.ts, styles.ts}` (new)
  - `.../_components/RegressionBanner/{RegressionBanner.tsx, RegressionBanner.test.tsx, index.ts}` (new)
  - `.../_components/MetricTrendChart/{MetricTrendChart.tsx, helpers.ts, helpers.test.ts, index.ts}` (new)
  - `.../_components/EvalRunsTable/{EvalRunsTable.tsx, EvalRunsTable.test.tsx, index.ts}` (new)
  - `.../_components/CompareRunsModal/{CompareRunsModal.tsx, CompareRunsModal.test.tsx, index.ts, styles.ts}` (new)
  - `client/messages/en/eval.json` (edit)
- **Track:** B
- **Layer:** App Router segment `/eval/[agentId]`
- **Skills:** (loaded)
- **Do:**
  - Tiles: same as the Evals tab strip, pass tile and its case delta included (AC-12, AC-10).
  - `RegressionBanner` (AC-15), from `dashboard.regressions`: one `role="alert"` banner listing `"{metric} dropped {points} pts since the previous run"` per item, and nothing when the list is empty.
  - `MetricTrendChart`:
    - `helpers.toChartRows(trend)` maps each point to `{ i, recall: v*100 | null, precision, citation }` and **keeps `null`**.
    - The chart uses `recharts` `LineChart`/`Line` directly with `connectNulls={false}` and three series named from `dashboard.legend.*` (Rec. 3).
    - Fewer than 2 points → a muted "not enough runs" text.
  - `EvalRunsTable` (AC-12, AC-13):
    - the 20 newest runs, columns date, `v{agent_version}`, recall, precision, citation, `{passed}/{total}`, cost (`"—"` for null), status;
    - each row has a `Checkbox` (from `@devdigest/ui`) with an accessible name `"Select run from {date}"`;
    - only completed/partial runs are selectable;
    - the Compare `Button` is enabled iff exactly 2 rows are selected.
  - `CompareRunsModal` (AC-13, AC-14, EC-9, EC-11):
    - data from `useEvalRunComparison` plus `useAgentVersion` for each run's `agent_version`;
    - a metric table `older → newer` with `MetricDelta` for recall, precision and citation, and the cost delta in dollars;
    - a case-set warning when `!case_sets.same`;
    - "Model changed" and "Skill set changed" lines when flagged;
    - the system-prompt diff via `diffLines(older.config.system_prompt, newer.config.system_prompt)`, rendered with `lineRowFor` / `lineSignFor` from `@/components/diff-viewer`;
    - if either version query errors → the EC-11 text instead of the diff, with the metrics still shown;
    - the modal body has `padding: 24`.
  - **Literal copy** (`eval.json`):
    - `agentPage.compare`: `"Compare"`
    - `agentPage.compareHint`: `"Select exactly two runs to compare."`
    - `agentPage.selectRun`: `"Select run from {date}"`
    - `agentPage.notEnoughRuns`: `"Run the eval set at least twice to see a trend."`
    - `agentPage.regression`: `"{metric} dropped {points} pts since the previous run"`
    - `compare.title`: `"Compare runs"`
    - `compare.olderNewer`: `"{older} → {newer}"`
    - `compare.cost`: `"Cost"`
    - `compare.caseSetsDiffer`: `"The case sets differ: older run {olderCount} cases, newer run {newerCount} cases, {editedCount} edited."`
    - `compare.modelChanged`: `"Model changed between these runs."`
    - `compare.skillsChanged`: `"Skill set changed between these runs."`
    - `compare.promptDiff`: `"System prompt diff"`
    - `compare.promptDiffUnavailable`: `"The system-prompt diff is unavailable: an agent-version snapshot could not be read."`
    - `compare.promptUnchanged`: `"System prompt unchanged."`
    - `compare.close`: `"Close"`
  - Metric display names come from `dashboard.legend.*`.
- **Done when:**
  - `helpers.test.ts` asserts that a `null` metric stays `null` in the chart rows, never 0 (EC-8).
  - `RegressionBanner.test.tsx`: two regressions → both strings; none → nothing rendered.
  - `EvalRunsTable.test.tsx`: Compare is disabled at 0, 1 and 3 selections and enabled at exactly 2; checkboxes have names; a `failed` row is not selectable.
  - `CompareRunsModal.test.tsx`:
    - signed deltas as text;
    - the case-set warning with counts (EC-9);
    - the model and skill lines;
    - prompt diff rows rendered from two mocked versions;
    - the EC-11 text when one version query errors, with deltas still present.
  - `AgentEvalView.test.tsx`: tiles, banner and table render from a mocked dashboard.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/eval/[agentId]/_components/MetricTrendChart/helpers.test.ts" --file "client/src/app/eval/[agentId]/_components/RegressionBanner/RegressionBanner.test.tsx" --file "client/src/app/eval/[agentId]/_components/EvalRunsTable/EvalRunsTable.test.tsx" --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.test.tsx" --file "client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx"` · `node scripts/verify.mjs client --checks`

### 12. Integration: full verify and the AC-16 experiment checklist
- **Files:** none new. Only fixes that the full run exposes, inside the owning track's files.
- **Track:** shared
- **Do:**
  1. Run `docker info`. If Docker is down, report that the `--it` lane is unexecuted rather than green (server/INSIGHTS.md:143).
  2. Run the full verify.
  3. With the dev stack running (`./scripts/dev.sh`, after `cd server && pnpm db:migrate`), smoke the routes from the browser:
     - FindingCard → case;
     - Evals tab → Run all evals → the run shows running, then completes;
     - `/eval` → `/eval/{agent}` → select two runs → Compare.
  4. Hand the AC-16 manual script to the user (the screencast is theirs):
     1. create ≥ 8 cases from findings, both types;
     2. Run all evals;
     3. edit the prompt;
     4. run;
     5. replace the prompt with one that flags every changed line;
     6. run;
     7. compare 2↔4 and 4↔6. The broken prompt must show lower precision.
- **Done when:** both packages are green with the `--it` lane actually executed, and the smoke path works end to end.
- **Verify:** `node scripts/verify.mjs server client --it` (the one full run; stands in for `pnpm verify:l06`, Q-5)

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server --file server/test/evals-helpers.test.ts` | AC-8, AC-9 formulas, EC-8, EC-12 trimming, NFR-2, boundary inputs (root path, case variant, `.tsx` near-miss, edge/adjacent ranges, 65 536/65 537 bytes, 120/121 chars, multibyte body cut) |
| server | `node scripts/verify.mjs server --file server/test/evals-service.test.ts` | NFR-1 one call + `maxRetries:0` + `timeoutMs`, NFR-5 ≤3 in flight + 120 s → errored (late result dropped), EC-6, EC-7 partial/failed/interrupted (no false "interrupted" on a read that races the start), AC-7 inputs |
| server | `node scripts/verify.mjs server --file server/test/evals.it.test.ts` (Docker) | AC-2/3/5/6/7/9, EC-1–7, EC-9 data, EC-12, NFR-3/4/6/10/12, Untrusted inputs 422/404 |
| server | `node scripts/verify.mjs server --file server/test/reviews-helpers.test.ts --file server/test/prompt-skills.test.ts` | live prompt unchanged after step 2 |
| client | `node scripts/verify.mjs client --file client/src/test/eval-contract-sync.test.ts` | NFR-9 |
| client | component tests named in steps 7–11 | AC-1, AC-4, AC-10–AC-15, EC-1, EC-3, EC-5, EC-8 display, EC-9, EC-10, EC-11, NFR-7, NFR-8 |
| server + client | `node scripts/verify.mjs server client --it` | the one full run (NFR-11) |
| manual | step 12 script | AC-16 |

## Risks & rollback
- **NOT NULL columns on a non-empty `eval_cases`/`eval_runs`:** `pnpm db:migrate` fails on a dev DB that somehow has rows (no writer exists today). Rollback: delete the rows in those two tables, which have no product data, then re-run migrate. Never edit the generated SQL.
- **The partial unique index is not emitted by drizzle-kit as expected.** EC-6 would then race. Check the generated SQL for `WHERE`. If it is missing, report it, and do not hand-edit.
- **The in-memory `active` set is per process.** Two `buildApp` instances sharing one test DB could mark each other's running run as interrupted. The it-test must close each app before the next starts a run. Inside one process the id enters `active` before the row is inserted (step 5), so a read that overlaps a start cannot mark the new run interrupted.
- **The step 2 refactor changes the live review prompt.** That would break the comparability of every past run. It is guarded by the byte-identity tests (`reviews-helpers.test.ts`, `prompt-skills.test.ts`). Rollback: revert step 2 and duplicate the two constants in `evals/helpers.ts` with a comment.
- **Real model runs cost money** (one call per case per run). Tests use `MockLLMProvider` only, and the it-test's intent stub throws if called.
- **The Track B client tests assume the step 0 contract shapes.** If Track A finds a contract defect, it stops and reports. Step 0 is re-opened, and neither track edits `vendor/shared`.

## Room left for the sibling specs (no feature built here)
- `eval_runs.kind` (`suite|single`) and `EvalRunKind` let case-authoring single-case runs exist. The partial unique index covers `kind='suite'` only, which is sibling EC-8.
- `eval_cases.source` (`finding|manual`) and `EvalCaseSource` (sibling AC-6/7).
- `owner_kind/owner_id` plus a separate `agent_id` on runs let a skill-owned run record its host agent (sibling AC-15/16).
- `eval_runs.skills` records `{skill_id,name,version}` in order, which is the source run-controls promotion needs (its DR-2, EC-3).
- `fingerprint` on cases, runs and results backs case editing (sibling AC-8) and EC-9.
- `GET /agents/:id/eval-runs` can take a `since` filter later, and `EvalTrendPoint` already carries `run_id`, `agent_version` and nullable metrics (run-controls AC-14/15, EC-12).
- `MetricTrendChart` stays route-local until the Evals-tab trend (run-controls AC-14) becomes its second consumer and promotes it.

## Out of scope
- Everything in `SPEC-2026-10-05-eval-run-controls` and `SPEC-2026-10-05-eval-case-authoring`: Promote, Run all agents, time window, agent switcher, Evals-tab trend, case editor, single-case runs, skill evals.
- Agent export, and the Stats/CI tabs (spec Non-goals).
- Any edit under `reviewer-core/`, including `grounding.ts` and `INJECTION_GUARD`.
- A `pnpm verify:l06` alias (Q-5 default).
- Seeding demo eval cases. The ≥ 8 cases are made by the user from real findings (AC-16).
- `server/src/modules/evals/README.md`, the `server/AGENTS.md` Read-when line and the `server/README.md` API map, which go to `doc-writer` (`/run-plan --docs`).
- In multi-agent mode, no track edits a file owned by another track. `vendor/shared` is step 0 only.
- Writing or amending the spec. A gap in it goes back to `spec-creator` or the person who owns the decision.
- Architectural review and security review, which separate agents own.
- Opening or pushing a PR, which `/pr-self-review` and the gate own.

## Open questions
- **Non-blocking:** Should a `partial` run count as "completed" for tiles, deltas and the banner? Default taken: yes, because its metrics exclude errored cases by definition (EC-7). The user decides.
- **Non-blocking:** The run cost when some case costs are unknown. Default taken: `null` ("—"), following the engine's poison rule. The user decides.
- **Non-blocking:** Should the action appear on FindingCards rendered inside the Files-changed tab (`DiffTab.tsx:113`)? Default taken: no, only in the findings list. The user decides.
- **Non-blocking:** Are `failed` and `running` runs selectable for Compare? Default taken: no, only `completed` and `partial` rows have a checkbox (step 11), because a `failed` run has no metrics and the modal would show only "—". The spec's AC-13 says "exactly two runs" without restricting status. The user decides.
- **Non-blocking:** The citation-accuracy denominator "all findings produced" (AC-9) is taken as the engine's merged set after `reduceReviews` (`kept + grounding-dropped`), which is what the grounding gate sees. Duplicates the reducer folds are not counted twice. The user decides.
- **Non-blocking:** Q-1 / Q-2 / Q-3 / Q-5 / Q-7 are at the spec defaults per "defaults". Precision ignores unlabelled findings in the numerator, undecided findings are disabled, the frozen input is file diff + PR title/body, verify.mjs stands in for `verify:l06`, and there is no readable-assertion row.
