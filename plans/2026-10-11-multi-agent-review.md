# Implementation Plan: Multi-Agent Review — run N chosen agents on one PR, group their findings, show disagreements

**Plan ID:** 2026-10-11-multi-agent-review  ·  **Spec:** [specs/2026-10-11-multi-agent-review.md](specs/2026-10-11-multi-agent-review.md) (Status `approved` by the user 2026-10-11)  ·
**Execution mode:** multi-agent — step 0 → tracks **S** (server) ∥ **A** (client: picker, Configure run, nav, history link) ∥ **B** (client: results page, grouping, promoted drawer and cards) → Integration  ·
**Implementer agents:** **5 invocations in total, never more than 3 at once** (step 0 = 1, tracks S/A/B = 3 in parallel, Integration = 1). If the "3 in total" cap means invocations rather than parallel agents, run this plan in **single-agent** mode: the steps are ordered `0 → S1…S4 → A1…A5 → B1…B4 → I1`, and the tree compiles between them.  ·
**Packages:** server, client, e2e  ·  **Base commit:** `6739e6d`  ·
**Assumptions:** the defaults of plan questions Q1–Q6 (see *Open questions*). The precondition **P** (installed dependencies) is met before step 0.

## Summary
A reviewer starts several agents on one PR in one action, either from the PR page's agent picker or from a new Configure run screen at `/multi-agent`. The server adds `POST /pulls/:id/multi-review`, which writes one row to the existing `multi_agent_runs` table and links each agent run to it through one new nullable, indexed column. The run itself goes through the existing executor, whose per-agent loop becomes concurrent. That is the only executor change, and it also applies to "run all" on `POST /pulls/:id/review`. The results page at `/multi-agent/[multiRunId]` re-reads `GET /multi-reviews/:id` every 2 s while any run is in flight. It computes match groups and the "Where agents disagree" rows on the client with a pure ±3-line location rule. "View trace" opens the existing `RunTraceDrawer`, moved to `src/components/`. Per-agent time and cost estimates come from a new `GET /agents/run-estimates`. Following the spec's Simplicity constraints, nothing else is added: no SSE channel, no grouping contract, no new table, no multi-run history list, and no extra LLM call.

## Requirements review

**What I understood:** Build the spec's four surfaces (PR-page picker, Configure run, results page with Columns/Tabs and a disagreement block, and a run-history link) on one new link column, two write/read routes and one estimates route. Grouping and disagreement live entirely in the client.
**Inputs read:** specs/2026-10-11-multi-agent-review.md · specs/designs/multi-agent-review/ (PNG 01, 04; source/screen_multiagent.jsx) · request text (caller brief: ≤3 parallel implementers, simplest implementation, boundaries, AC-16 manual) · AGENTS.md · server/AGENTS.md · client/AGENTS.md · e2e/AGENTS.md · INSIGHTS.md · server/INSIGHTS.md · client/INSIGHTS.md · e2e/INSIGHTS.md · .claude/skills/pr-self-review/routing.md
**Execution mode:** stated by the caller as a choice ("multi-agent only if it pays off … single-agent is fine too"). Multi-agent was chosen because three tracks share no file once step 0 lands: server, client picker, and client results. See *Risks* for the shared client `typecheck`.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "the dropdown shall show the header "PICK AGENTS TO RUN" with a "Select all"/"Clear" switch … one checkbox row per enabled agent … time hint … run button and a "Configure agents…" link … merged warning stays above the list" | spec §AC-1 | clear |
| R2 | "read "Select an agent" (disabled) with none checked, and "Run <agent name>" with one checked … starts the existing single-agent run unchanged … "Run multi-agent review (N)"" | spec §AC-2 | clear |
| R3 | "start one multi-agent run on that PR with exactly the checked agents and open its results page" | spec §AC-3 | clear |
| R4 | "show "Run a Multi-Agent Review" with step 1 "Pull request" … "#<number> · <title>" … "Pick a pull request first" … run button … disabled" | spec §AC-4 | clear |
| R5 | "every enabled agent as a checkbox card with its name, its description and an estimate "<seconds>s · $<cost>" … average duration and the average known cost … "Select all"/"Clear all"" | spec §AC-5 | clear |
| R6 | ""≈ <max estimated seconds>s · $<sum of estimated costs> · parallel fan-out" … "Run multi-agent review (N)" … "Run 1 agent" … "Select agents" (disabled)" | spec §AC-6 | clear (Rec 5: "Run 1 agent" goes through the multi-review endpoint) |
| R7 | "create one multi-agent run for the PR plus one agent run per requested agent, each recorded as belonging to it … return their ids before any agent finishes" | spec §AC-7 | clear |
| R8 | "`POST /pulls/:id/review` … same body … same response shape … belong to no multi-agent run" | spec §AC-8 | clear |
| R9 | "meta row "#<number> <title>" … "<N> agents · parallel fan-out · <T>s total · $<C>". T is the wall time from start to the last agent's end" | spec §AC-9 | ambiguous: T while a run is still in flight is undefined. See Q3 |
| R10 | "WHILE any agent run … is queued or running … re-read … about every 2 seconds … stop re-reading once every run has ended" | spec §AC-10 | contradicts tree: there is no `queued` status. A run row is created as `running` ([run.repo.ts:164](server/src/modules/reviews/repository/run.repo.ts:164)). Rec 3 |
| R11 | "one tab per agent … full finding cards: confidence, suggested fix, Accept, Dismiss, Turn into eval case. Each action changes the same finding the PR page shows" | spec §AC-11 | clear (Rec 1: the cards live under the PR route and must be promoted) |
| R12 | "open that run in the same trace drawer the PR page uses … Live log tab streams while the run is running, opens first in that case" | spec §AC-12 | clear (the drawer already has `running`, [RunTraceDrawer.tsx:25-44](client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx:25)) |
| R13 | "same file path, and their line ranges overlap once each range is widened by 3 lines … connected components … any input order produce the same groups" | spec §AC-13 | clear |
| R14 | "one row per location … exactly one AC-13 group, including a group of one … `file:line` and the title of its highest-severity finding … original rationale and line range, unchanged" | spec §AC-14 | clear |
| R15 | "one cell for every agent selected … "did not flag" … While "Show only conflicts" is on, rows where every completed agent gave the same severity shall be hidden" | spec §AC-15 | ambiguous: whether "did not flag" counts as a different answer, and what a still-running agent's cell shows. See Q1, Q2 |
| R16 | "a person shall … Record in `docs/multi-agent-review-benchmark.md` … wall time, tokens in/out, cost, findings count and the number of match groups, plus the ratio as measured" | spec §AC-16 | clear (manual step M1, never the implementer) |
| R17 | "an "Open multi-agent results" link on every agent run that belongs to a multi-agent run … A run that belongs to none shall show no new element" | spec §AC-17 | clear (Rec 2: `.nullish()`) |
| R18 | "Security Reviewer → shield, red; Performance Reviewer → lightning, amber; Test Quality Reviewer → lightbulb, blue; API Contract Reviewer → users, purple; General Reviewer → boxes, green; any other name → a neutral icon and a neutral colour" | spec §AC-18, Q-9 | clear |
| R19 | "IF one agent run … fails or is cancelled, THEN the server shall still run the other agents to completion and persist their reviews" | spec §EC-1 | clear |
| R20 | "its column shall show that status and the error text, keep "View trace", and leave the other columns and the meta row showing their own results" | spec §EC-2 | clear |
| R21 | "IF the shared preparation (loading the PR diff) fails, THEN every agent run … shall end failed with that reason" | spec §EC-3 | clear (it is verified hermetically, Rec 9) |
| R22 | "IF the request body is not `{agentIds}` with 1–10 unique non-empty strings and no other key, THEN … 422 naming the field and create nothing" | spec §EC-4 | clear |
| R23 | "IF the PR or any requested agent is not in the caller's workspace, THEN … 404 and create no multi-agent run and no agent run" | spec §EC-5 | ambiguous: a well-formed but non-uuid id would currently reach Postgres and give a 500 (`agents.id` is a uuid; no `22P02` handling in `src/app.ts`). See Q4 |
| R24 | "IF an agent has no completed past run, or none with a known cost, THEN its estimate shall show "—" … aggregate shall leave it out of the time maximum and show its cost as "—"" | spec §EC-6 | clear |
| R25 | "IF a completed agent run has an unknown cost, THEN its column shall show "—" for cost and the meta row total shall show "—"" | spec §EC-7 | clear |
| R26 | "IF the results page is opened or reloaded while agent runs are in flight, THEN it shall show each run's current status … and resume the periodic re-read" | spec §EC-8 | clear |
| R27 | "IF the results page is opened for an unknown multi-run id, or one from another workspace, THEN it shall show a not-found state with a link to Configure run" | spec §EC-9 | clear (a malformed id gets 422 from `IdParams`; the page treats 404 and 422 alike) |
| R28 | "WHILE a multi-run start request is in flight, the run buttons in the dropdown and on Configure run shall be disabled" | spec §EC-10 | clear |
| R29 | "its cell in every location row shall read "no result" rather than "did not flag", and the cell shall not count toward a conflict" | spec §EC-11 | clear |
| R30 | "IF the workspace has no enabled agent, THEN the dropdown and Configure run shall show … "Enable agents to run reviews", with a "Go to Agents" link" | spec §EC-12 | clear |
| R31 | "the agent runs of one multi-run shall overlap in time … wall time is less than the sum of the three runs' durations" | spec §NFR-1 | clear |
| R32 | "no model call beyond each agent's own review calls. The diff load and the intent run once per multi-run" | spec §NFR-2 | clear |
| R33 | "at most 10 agents and at most 10 requests per minute, the same limit as `POST /pulls/:id/review`" | spec §NFR-3 | ambiguous: the rate half is not observable in tests, because "the global rate limit is disabled under `NODE_ENV=test`" (server/AGENTS.md, Gotchas). The route config is checked by reading it; the size half is tested |
| R34 | "every new user-facing string shall come from `client/messages/en/<namespace>.json`" | spec §NFR-4 | clear |
| R35 | "every agent row is a checkbox with the agent's name as its accessible name … Columns/Tabs switch and "Show only conflicts" have accessible names and pressed or checked state … status and severity is shown as text" | spec §NFR-5 | clear |
| R36 | "survive a page reload and a server restart. Deleting the PR removes them. Deleting one agent run … leaves the multi-run and its other runs readable" | spec §NFR-6 | clear |
| R37 | "on an unindexed repo each agent shall run diff-only exactly as a single review does" | spec §NFR-7 | clear |
| R38 | "with more than 5 agents … each column shall keep at least 220 px and the row shall scroll horizontally" | spec §NFR-8 | clear (manual, M1) |
| R39 | "the change shall touch no file under `ci/` or `agent-runner/`" | spec §NFR-9 | clear |
| R40 | "`agentIds` body … a strict object, 1–10 unique non-empty strings … 422 naming `agentIds`; nothing created" | spec §Untrusted inputs | clear |
| R41 | "each agent id, `:id` PR param … resolves within the caller's workspace … 404; nothing created" | spec §Untrusted inputs | clear (see R23) |
| R42 | "`:id` multi-run param … resolves within the caller's workspace … 404 → not-found state" | spec §Untrusted inputs | clear |
| R43 | "finding title, rationale, suggestion … titles as plain text, rationale and suggestion only through the existing markdown renderer" | spec §Untrusted inputs | clear |
| R44 | "PR title, agent name and description … plain text … overflow is truncated with an ellipsis" | spec §Untrusted inputs | clear |
| R45 | "live-log lines, raw output … plain text; copy goes to the clipboard verbatim" | spec §Untrusted inputs | clear (unchanged drawer) |
| R46 | "use at most 3 implementer agents in total (hard cap of 3, never more than 5)" | request text | ambiguous: read as ≤3 parallel track agents and ≤5 invocations. Single-agent is the fallback (header) |
| R47 | "the SIMPLEST implementation that meets the spec — follow the spec's "Simplicity constraints" … Do not add scope" | request text | clear |
| R48 | "no changes under `ci/` or `agent-runner/`; `POST /pulls/:id/review` and its `RunRequest` contract stay unchanged; never edit applied migrations" | request text | clear |
| R49 | "AC-16 (1-vs-3 benchmark doc) is a manual step after implementation … not for the implementer to fabricate numbers" | request text | clear |
| R50 | "Read the relevant INSIGHTS.md (root, server, client) and state the entries that constrain the plan" | request text | clear |

### Recommendations
1. **Promote `FindingsPanel` and `FindingCard` along with the drawer, and move `github-urls.ts` to `src/lib/`.** **Adopted (default; Q5).** Why: AC-11 needs the PR page's full cards and their actions. Today they live under the PR route ([FindingsPanel.tsx:9-11](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:9), [FindingCard.tsx:23](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:23) imports `../../github-urls`). A results route importing them would be a feature→feature import, which `routing.md` (frontend severity table) grades CRITICAL. `src/components` may not import `src/app` (client/AGENTS.md). This is the same move-not-fork treatment DR-5 gives the drawer. Plan change: step B1 moves four modules, with no behaviour change.
2. **`RunSummary.multi_run_id` is `.nullish()`, not `.nullable()`.** **Adopted.** Why: a required key would break the client fixture builder ([RunHistory.test.tsx:16-36](client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx:16)). It would also break the `mcp` fake API, which builds `RunSummary` objects without the key (`mcp/test/helpers/fixtures.ts`, parsed by `RunSummary.array()` in [mcp/src/api-client.ts:165](mcp/src/api-client.ts:165)). Either break would pull `mcp` into scope. The server always sends the field, so it stays additive and nullable on the wire. Plan change: step 0.
3. **No `queued` state.** **Adopted.** Why: rows are created `running` ([run.repo.ts:164](server/src/modules/reviews/repository/run.repo.ts:164)). The page treats `status === "running"` or `null` as in flight. Plan change: steps 0 (refetch rule) and B3.
4. **The picker gets its own small popover.** **Adopted.** Why: the vendored `Dropdown` closes on every item click ([Dropdown.tsx:12-15](client/src/vendor/ui/kit/Dropdown.tsx:12)), so a checkbox list cannot live in it. `src/vendor/ui` is do-not-touch except `nav.ts`. Plan change: A2 copies `Dropdown`'s open/outside-mousedown pattern locally and uses the kit `Checkbox`.
5. **Configure run always calls `POST /pulls/:id/multi-review`, including for one agent.** **Adopted.** Why: AC-16 step 3 ("Run the same PR with 1 agent through the Configure run screen") needs a results page and its numbers. EC-4 allows 1 agent. The PR-page dropdown keeps the single-agent `POST /review` path for one agent (AC-2). Plan change: A3.
6. **All new copy goes in one new namespace, `messages/en/multiReview.json`, written in step 0.** **Adopted.** Why: both client tracks need strings, and two tracks must never edit one file. The stale `runs.json` `page.*` strings (`"fan-out via p-queue"`, [runs.json:120](client/messages/en/runs.json:120)) are left untouched and unused. Plan change: step 0.
7. **Top-level routes `/multi-agent` and `/multi-agent/[multiRunId]`.** **Adopted.** Why: `activeKeyFor` already maps any path containing `/multi-agent` to the `multi-agent` sidebar key ([helpers.ts:28](client/src/components/app-shell/helpers.ts:28)), and `shell.json` already has `nav.multi-agent` ([shell.json:26](client/messages/en/shell.json:26)). A repo-free URL lets the PR run history link to results without threading `repoId` through `FindingsTab`. Configure run reads the active repo from `useActiveRepo()`. Plan change: A3, A4, B3.
8. **A contract-sync test for the three vendored contract files that are byte-identical today** (`platform.ts`, `review-api.ts`, `observability.ts`, checked with `diff --strip-trailing-cr`). **Adopted.** Why: the copies have drifted before (root INSIGHTS, 2026-09-15), and the precedent exists ([eval-contract-sync.test.ts](client/src/test/eval-contract-sync.test.ts)). `trace.ts` already differs in comments only, so it is mirrored by hand and not asserted. Plan change: step 0.
9. **EC-3 is verified by a hermetic executor test, not the integration lane.** **Adopted.** Why: `loadDiff` swallows git errors and falls back to `pr_files` ([diff-loader.ts:19-29](server/src/modules/reviews/diff-loader.ts:19)), so against real Postgres it does not fail. A fake repository whose `getPrFiles` throws reaches `failAll` ([run-executor.ts:84-113](server/src/modules/reviews/run-executor.ts:84)). Plan change: S1.
10. **Reuse the stale `MultiAgentRun` contract** ([observability.ts:74-85](server/src/vendor/shared/contracts/observability.ts:74)). **Not adopted.** Why: it carries server-side `columns`/`conflicts`, which is the grouping-on-the-wire the Simplicity constraints forbid. It is not deleted either, which is out of scope.
11. **A bounded concurrency limiter for the fan-out** (the evals module has one, `RUN_ALL_CONCURRENCY`). **Not adopted.** Why: the 10-agent cap (EC-4) already bounds it, and the spec asks for no new machinery.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | Naming table (`*.it.test.ts`, `.js` imports, `messages/en/<ns>.json`, migrations via `pnpm db:generate`), do-not-touch list, `verify.mjs` flags |
| [server/AGENTS.md](server/AGENTS.md) | Declarative zod validation; rate limit disabled under `NODE_ENV=test`; modules registered statically |
| [client/AGENTS.md](client/AGENTS.md) | `src/components`/`src/lib` never import `src/app`; `nav.ts` is app-owned; server-component pages |
| [server/src/modules/reviews/run-executor.ts:63-162](server/src/modules/reviews/run-executor.ts:63) | Shared diff and intent once, then the sequential `for` loop at `:134`; per-agent try/catch already isolates failures |
| [server/src/modules/reviews/service.ts:103-138](server/src/modules/reviews/service.ts:103) | Run rows created up front, execution fire-and-forget; shape to reuse for multi-review |
| [server/src/modules/reviews/routes.ts:27-44](server/src/modules/reviews/routes.ts:27) | `/pulls/:id/review` rate config `{ max: 10, timeWindow: '1 minute' }`; `RunRequest.parse` in the handler stays as is (R48) |
| [server/src/modules/reviews/repository/run.repo.ts:41-98,146-169](server/src/modules/reviews/repository/run.repo.ts:41) | `listRunsForPull` → `RunSummary`; `createAgentRun` inserts `status: 'running'` |
| [server/src/db/schema/runs.ts:17-86](server/src/db/schema/runs.ts:17) | `agent_runs` (FK indexes listed), `multi_agent_runs` (cascades from workspace and PR) |
| [server/src/vendor/shared/contracts/trace.ts:118-145](server/src/vendor/shared/contracts/trace.ts:118) | `RunSummary` shape |
| [server/src/vendor/shared/contracts/review-api.ts:15-57](server/src/vendor/shared/contracts/review-api.ts:15) | `FindingRecord`, `ReviewRunTarget` |
| [server/src/modules/agents/routes.ts](server/src/modules/agents/routes.ts) · [repository.ts:195-217](server/src/modules/agents/repository.ts:195) | Where `GET /agents/run-estimates` and its query go |
| [server/test/reviews.it.test.ts:1-138](server/test/reviews.it.test.ts:1) | The `intentStub` + `appWith` + `setupRepoAndPr` pattern for a hermetic-LLM integration test |
| [client/src/app/repos/[repoId]/pulls/[number]/page.tsx:17,228-236](client/src/app/repos/[repoId]/pulls/[number]/page.tsx:17) | Drawer mount and props |
| [client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx](client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx) | Current dropdown (all agents, Run all, merged warning, Configure agents) |
| [client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:238-330](client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:238) | Run row is a `div`; the link goes beside the trace button |
| [client/src/lib/hooks/reviews.ts:137-181](client/src/lib/hooks/reviews.ts:137) | `useRunReview`, `useFindingAction` (invalidates by `prId` only) |
| [client/src/vendor/ui/nav.ts](client/src/vendor/ui/nav.ts) · [kit/Checkbox.tsx](client/src/vendor/ui/kit/Checkbox.tsx) · [primitives/Toggle.tsx](client/src/vendor/ui/primitives/Toggle.tsx) · [icons.tsx](client/src/vendor/ui/icons.tsx) | No GLOBAL section yet; `Checkbox` is a labelled `button role=checkbox`; `Toggle` is `role=switch aria-checked`; `Shield`, `Zap`, `Lightbulb`, `Users`, `Boxes`, `Cpu` exist |
| [client/src/components/run-cost-badge/RunCostBadge.tsx:17-22](client/src/components/run-cost-badge/RunCostBadge.tsx:17) | `formatRunCost` (includes `$`); unknown renders "—" |
| [client/src/i18n/request.ts](client/src/i18n/request.ts) | Every `messages/en/*.json` is auto-loaded as a namespace |
| [e2e/specs/15-onboarding-tour.flow.json](e2e/specs/15-onboarding-tour.flow.json) | Sidebar-entry flow shape to copy |
| [specs/designs/multi-agent-review/source/screen_multiagent.jsx](specs/designs/multi-agent-review/source/screen_multiagent.jsx) | Copy not fixed by an AC (subtitles, empty-state body), the column/tab layout, `minmax(220px, 1fr)` |
| [INSIGHTS.md](INSIGHTS.md) · [server/INSIGHTS.md](server/INSIGHTS.md) · [client/INSIGHTS.md](client/INSIGHTS.md) · [e2e/INSIGHTS.md](e2e/INSIGHTS.md) | See *Insights that bind this work* |

## Insights that bind this work
1. **Unknown cost renders "—", never "$0.00"; aggregates skip nulls.** [INSIGHTS.md:292-297](INSIGHTS.md:292) and [server/INSIGHTS.md:169-172](server/INSIGHTS.md:169) (failed/cancelled runs store `cost_usd: null`). How the plan honours it: `avg_cost_usd` uses SQL `avg()`, which ignores nulls, and stays `null` when no known cost exists (S4). The Configure-run aggregate, each column and the meta row show "—" as soon as a counted value is unknown and never add it as 0 (A1, B2).
2. **`reviews.it.test.ts` is not hermetic unless `intent` is stubbed.** [server/INSIGHTS.md](server/INSIGHTS.md) What Doesn't Work, 2026-09-24: every review run calls `container.intent.ensure`, which would be a paid OpenRouter call. How the plan honours it: `multi-review.it.test.ts` copies the `intentStub` from [reviews.it.test.ts:15-21](server/test/reviews.it.test.ts:15). Its `ensure` counts calls, which is also the NFR-2 assertion (exactly one per multi-run).
3. **A new FK column needs a deliberate index decision; Postgres does not index FKs.** [server/INSIGHTS.md:192-200](server/INSIGHTS.md:192). How the plan honours it: `agent_runs.multi_run_id` gets `index('agent_runs_multi_run_idx')`. It is the target of `ON DELETE SET NULL` from `multi_agent_runs` (a PR delete cascades there), and the results read could filter on it.

Also binding:
- **client/INSIGHTS.md, 2026-09-18 (`feature-models.ts`):** importing a runtime value from `vendor/shared` breaks the webpack build. Every client import from `@devdigest/shared` in this plan is `import type`. Severity order and the line-slack constant are local constants.
- **client/INSIGHTS.md, 2026-09-18 (`TraceBody.tsx`):** the drawer's own subtree imports its parent with the `@/app/…/RunTraceDrawer/…` alias, so moving it means re-pointing 7 alias imports. A relative-only search misses them (B1).
- **server/INSIGHTS.md, 2026-10-02 (`pnpm typecheck` never sees `server/test/**`):** S2 widens `ReviewRepository` and `createAgentRun`. Grep `server/test` for fakes of them by hand.
- **Root INSIGHTS, What Doesn't Work, 2026-09-29 (`pnpm exec` in a junctioned worktree):** this worktree has **no** `node_modules` at all today. Precondition **P** installs them; a junction to the main checkout is the case that INSIGHTS entry warns about.
- **Root INSIGHTS, What Doesn't Work, 2026-10-01 ("did not touch X"):** NFR-9 is checked against base commit `6739e6d` plus untracked files, never with `git diff main`.
- **e2e/INSIGHTS.md, 2026-09-27:** always `wait --text` for an element before `find … click` it (A5).

No step repeats a "What Doesn't Work" entry.

## Constraints
- **Onion rings (server, enforced by `pnpm lint` + `pnpm arch`):** `modules/reviews/repository.ts` and `repository/*.repo.ts` are ring 3 (only these touch Drizzle). `service.ts`, `run-executor.ts` and `constants.ts` are ring 2. `routes.ts` is ring 4. Same for `modules/agents/`. A route never runs a query. No new module, so `modules/index.ts` is unchanged. `/multi-reviews/:id` is registered by the existing `reviews` plugin.
- **Contract written once, mirrored once.** `server/src/vendor/shared/contracts/*` is canonical. Every edit to `platform.ts`, `review-api.ts`, `trace.ts` and `observability.ts` is repeated byte-for-byte in `client/src/vendor/shared/contracts/` in step 0. Check with `diff --strip-trailing-cr` (root INSIGHTS, 2026-10-01).
- **Declarative validation:** the new routes declare `params`/`body`/`response` zod schemas. No `.parse()` in a handler. `POST /pulls/:id/review` and `RunRequest` are not touched (R48).
- **Relative imports carry `.js`** in `server/`.
- **`*.it.test.ts`** for every Postgres-backed test (`multi-review.it.test.ts`, `agents-run-estimates.it.test.ts`). The executor test is hermetic and named `multi-review-executor.test.ts`.
- **Migration:** `cd server && pnpm db:generate` produces `0021_<generated>.sql` + `meta/0021_snapshot.json` + a `meta/_journal.json` change. Never hand-write or rename it, and never edit `0000`–`0020`.
- **Client naming:** a new route component is `_components/<Name>/<Name>.tsx` + `<Name>.test.tsx` + `index.ts`. Shared components are `src/components/<kebab-name>/<Name>.tsx`. Every user-facing string comes from `messages/en/multiReview.json` (NFR-4). Pages are server components (`async`, `await params`) rendering a `"use client"` leaf (client/INSIGHTS.md, 2026-09-29).
- **No `fetch` in components.** The three new endpoints get hooks in `src/lib/hooks/multi-review.ts` over `src/lib/api.ts`.
- **`src/vendor/ui/**` is do-not-touch except `nav.ts`.** Say "edits the app-owned `nav.ts`" in the commit.
- **Do-not-touch near this work:** `reviewer-core/**` (not touched at all: the executor change is in `server/`), applied migrations, the five lock-files (`pnpm install --frozen-lockfile`/`npm ci` do not change them), `agent-runner/**`, `ci/` (absent in this tree), `client/.next`.
- **Spec bounds down the stack:** the numbers are 10 agents, 10 req/min, 2 s polling, the last 20 runs and ±3 lines. None is pre-empted by a lower layer. The reviews path has no limiter (`p-limit`/`p-queue` appear only in `modules/evals`). The per-route rate limit uses the same plugin config as `/review`. There are no timeouts in this spec, so the OpenRouter 90 s / 2 retries do not interact with it.

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/**` + `client/src/vendor/shared/contracts/**` | `zod` | contract shapes, `.strict()`, `.refine` on the array |
| `server/src/db/schema/runs.ts`, generated migration | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design` | schema ring + FK/index decision |
| `server/src/modules/*/repository.ts`, `repository/*.repo.ts` | `onion-architecture`, `drizzle-orm-patterns` | ring 3 queries (window function for estimates) |
| `server/src/modules/*/service.ts`, `run-executor.ts`, `constants.ts` | `onion-architecture` | ring 2 |
| `server/src/modules/*/routes.ts` | `onion-architecture`, `fastify-best-practices` | ring 4 + HTTP surface (`security` is the gate's, review-time) |
| `client/src/app/**` pages and `_components/**`, `client/src/components/**` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | placement + component rules; every new file is a page or `"use client"` |
| `client/src/lib/hooks/*.ts`, `client/src/lib/*.ts` | `frontend-ui-architecture`, `react-best-practices` (+ `next-best-practices` for the `"use client"` hooks file) | hook placement and shape |
| `client/**/*.test.ts(x)` | `react-testing-library` | component and hook tests |
| `server/test/**`, `client/messages/**`, `e2e/**`, `*.md` | — | convention-only |

Derived from the write-time row of [.claude/skills/pr-self-review/routing.md](.claude/skills/pr-self-review/routing.md). `security` and `typescript-expert` are review-time only. Each skill is loaded **once per implementer run**, at the first step that needs it.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/{platform,review-api,trace,observability}.ts` · the same four under `client/src/vendor/shared/contracts/` · `server/src/db/schema/runs.ts` · `server/src/db/migrations/0021_*.sql` + `meta/0021_snapshot.json` + `meta/_journal.json` (generated) · `server/test/multi-review-contracts.test.ts` · `client/src/test/multi-review-contract-sync.test.ts` · `client/messages/en/multiReview.json` · `client/src/lib/hooks/multi-review.ts` + `multi-review.test.ts` · `client/src/lib/hooks/reviews.ts` · `client/src/components/agent-avatar/**` | 0 | `node scripts/verify.mjs server --file server/test/multi-review-contracts.test.ts` · `node scripts/verify.mjs client --file …` (3 files) · `node scripts/verify.mjs server client --checks` | P |
| S — server | `server/src/modules/reviews/{run-executor,service,routes,constants,repository}.ts` · `server/src/modules/reviews/repository/run.repo.ts` · `server/src/modules/agents/{repository,service,routes,constants}.ts` · `server/test/multi-review-executor.test.ts` · `server/test/multi-review.it.test.ts` · `server/test/agents-run-estimates.it.test.ts` | S1–S4 | `node scripts/verify.mjs server --checks` · `--file` per step · `node scripts/verify.mjs server --it` (S3, S4; Docker) | 0 |
| A — client picker | `client/src/vendor/ui/nav.ts` · `client/src/components/app-shell/nav.test.ts` · `client/src/lib/run-estimates.ts` + `run-estimates.test.ts` · `client/src/app/multi-agent/page.tsx` · `client/src/app/multi-agent/_components/**` · `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` · `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/**` · `e2e/specs/18-multi-agent-configure.flow.json` | A1–A5 | `node scripts/verify.mjs client --file …` per step · `node scripts/verify.mjs client --checks` (see Risks) | 0 |
| B — client results | `client/src/app/multi-agent/[multiRunId]/**` · `client/src/components/run-trace-drawer/**` · `client/src/components/finding-card/**` · `client/src/components/findings-panel/**` · `client/src/lib/github-urls.ts` · in `client/src/app/repos/[repoId]/pulls/[number]/`: `page.tsx`, `github-urls.ts` (removed), `_components/RunTraceDrawer/**` (removed), `_components/FindingCard/**` (removed), `_components/FindingsPanel/**` (removed), `_components/DiffTab/DiffTab.tsx`, `_components/ReviewRunAccordion/ReviewRunAccordion.tsx`, `_components/BlastRadiusPanel/_components/BlastGroup/BlastGroup.tsx`, `_components/BlastRadiusPanel/_components/PriorPrs/PriorPrs.tsx` | B1–B4 | `node scripts/verify.mjs client --file …` per step · `node scripts/verify.mjs client --checks` (see Risks) | 0 |
| shared — integration | `server/README.md` · `client/README.md` | I1 | `node scripts/verify.mjs server client` · `node scripts/verify.mjs server --it` · `node scripts/verify.mjs e2e --checks` · `./scripts/e2e.sh` | S, A, B |

No path appears in two rows. Each of S, A, B is one `implementer` invocation, run in parallel. M1 is a manual step for a person, not a track.

## Steps

### P. Precondition — dependencies installed (orchestrator, before step 0; not an implementer step)
- **Fact:** this worktree has no `server/node_modules`, `client/node_modules` or `e2e/node_modules` (checked with `ls -d */node_modules` → none). `scripts/verify.mjs` and `pnpm db:generate` cannot run without them.
- **Do:** `cd server && pnpm install --frozen-lockfile` · `cd client && pnpm install --frozen-lockfile` · `cd e2e && npm ci`. Lock-files must stay unchanged. **Do not** junction `node_modules` from the main checkout (root INSIGHTS, What Doesn't Work, 2026-09-29).
- **Done when:** `git status --short -- '*lock*'` prints nothing and `node scripts/verify.mjs server client --checks` runs (it is green on `6739e6d`).

### 0. Contracts, link column + migration, client hooks, presentation map, copy
- **Files:** [`server/src/vendor/shared/contracts/platform.ts`](server/src/vendor/shared/contracts/platform.ts) (edit) · [`review-api.ts`](server/src/vendor/shared/contracts/review-api.ts) (edit) · [`trace.ts`](server/src/vendor/shared/contracts/trace.ts) (edit) · [`observability.ts`](server/src/vendor/shared/contracts/observability.ts) (edit) · the same four in [`client/src/vendor/shared/contracts/`](client/src/vendor/shared/contracts/) (edit) · [`server/src/db/schema/runs.ts`](server/src/db/schema/runs.ts) (edit) · `server/src/db/migrations/0021_*.sql`, `meta/0021_snapshot.json`, `meta/_journal.json` (new/edit, **generated**) · `server/test/multi-review-contracts.test.ts` (new) · `client/src/test/multi-review-contract-sync.test.ts` (new) · `client/messages/en/multiReview.json` (new) · `client/src/lib/hooks/multi-review.ts` (new) · `client/src/lib/hooks/multi-review.test.ts` (new) · [`client/src/lib/hooks/reviews.ts`](client/src/lib/hooks/reviews.ts) (edit) · `client/src/components/agent-avatar/agent-look.ts`, `AgentAvatar.tsx`, `AgentAvatar.test.tsx`, `index.ts` (new)
- **Track:** shared
- **Layer:** ring 1 (contracts), schema; client `src/lib/hooks`, `src/components`
- **Skills:** `zod`, `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`, `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **Do — contracts (server copy, then the identical client mirror):**
  - `platform.ts`, after `RunRequest` (which is unchanged):
    ```ts
    export const MultiReviewRequest = z.object({
      agentIds: z.array(z.string().min(1)).min(1).max(10)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'agentIds must be unique' }),
    }).strict();
    export const MultiReviewStarted = z.object({ multi_run_id: z.string(), pr_id: z.string(), runs: z.array(ReviewRunTarget) });
    ```
    `ReviewRunTarget` is imported from `./review-api.js`. That creates no cycle, because `review-api.ts` imports only `findings`/`brief`/`trace`.
  - `review-api.ts`: `MultiReviewAgent = { run: RunSummary, summary: string | null, findings: FindingRecord[] }` and `MultiReviewDetail = { id, pr: { id, number: int, title }, ran_at, agents: MultiReviewAgent[] }`, importing `RunSummary` from `./trace.js`. This carries no grouping field (Simplicity constraints).
  - `trace.ts` `RunSummary`: add `multi_run_id: z.string().nullish()` with a comment: "the multi-agent run this run belongs to; absent/null for a run started through POST /pulls/:id/review" (Rec 2).
  - `observability.ts`: `AgentRunEstimate = { agent_id: string, sample_runs: int ≥ 0, avg_duration_ms: int | null, avg_cost_usd: number | null }`. Leave `MultiAgentRun`/`AgentStats` untouched (Rec 10).
  - Export types with `z.infer`. The barrels already `export *` all four files.
- **Do — schema:** in `agentRuns` add `multiRunId: uuid('multi_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })` (nullable). In its index block add `multiRunIdx: index('agent_runs_multi_run_idx').on(t.multiRunId)`, with a comment naming the FK-index rule. `set null` matches `pr_id`'s behaviour: a PR delete cascades `multi_agent_runs` and leaves agent runs in place (NFR-6). Then `cd server && pnpm db:generate`, which is additive only and raises no rename prompt.
- **Do — client hooks (`src/lib/hooks/multi-review.ts`, `"use client"`, type-only imports from `@devdigest/shared`):**
  - `agentRunEstimatesKey = ["agent-run-estimates"]`; `useAgentRunEstimates()` → `api.get<AgentRunEstimate[]>("/agents/run-estimates")`.
  - `useStartMultiReview()` → `api.post<MultiReviewStarted>(\`/pulls/${prId}/multi-review\`, { agentIds })`. On success it invalidates `["pr-active-runs", prId]` and `["pr-runs", prId]`.
  - `multiReviewKey(id) = ["multi-review", id]`; exported pure `multiReviewRefetchInterval(data?: MultiReviewDetail): number | false`. It returns `2000` when any `agents[i].run.status` is `"running"` or `null`/`undefined`, and `false` otherwise or when `data` is undefined. `useMultiReview(id)` uses it as `refetchInterval: (q) => multiReviewRefetchInterval(q.state.data)` and sets `retry: false` (a 404/422 must surface at once for EC-9).
  - In `reviews.ts` `useFindingAction.onSuccess`, also `qc.invalidateQueries({ queryKey: ["multi-review"] })` (prefix match), so Accept/Dismiss on the results page refreshes it (AC-11). This is the only change to that file.
- **Do — presentation map (`src/components/agent-avatar/`):** `agent-look.ts` exports `agentLook(name: string | null | undefined): { icon: IconName; color: string }`, keyed by **exact** name:

  | name | icon | color |
  |---|---|---|
  | `Security Reviewer` | `Shield` | `#ef4444` |
  | `Performance Reviewer` | `Zap` | `#f59e0b` |
  | `Test Quality Reviewer` | `Lightbulb` | `#3b82f6` |
  | `API Contract Reviewer` | `Users` | `#8b5cf6` |
  | `General Reviewer` | `Boxes` | `#10b981` |
  | anything else (incl. null) | `Cpu` | `#6b7280` |

  `AgentAvatar({ name, size?: "sm" | "md" })` renders the icon in a rounded tile tinted with `color + "1f"` (the design's alpha suffix), `aria-hidden`. The name is always rendered next to it by the caller (AC-18).
- **Do — copy:** create `client/messages/en/multiReview.json` with **exactly** these keys and strings (Rec 6). Every user-facing string in tracks A and B comes from here:
  ```json
  {
    "picker": {
      "header": "PICK AGENTS TO RUN",
      "selectAll": "Select all",
      "clear": "Clear",
      "timeHint": "~{seconds}s",
      "unknown": "—",
      "selectAnAgent": "Select an agent",
      "runOne": "Run {name}",
      "runMulti": "Run multi-agent review ({count})",
      "configureAgents": "Configure agents…",
      "noEnabled": "Enable agents to run reviews",
      "goToAgents": "Go to Agents"
    },
    "configure": {
      "crumb": "Configure run",
      "title": "Run a Multi-Agent Review",
      "subtitle": "Pick a pull request and choose which agents to fan out — they run in parallel and you compare their findings side by side.",
      "stepPr": "Pull request",
      "selectPr": "Select a pull request…",
      "prItem": "#{number} · {title}",
      "stepAgents": "Agents to run",
      "pickPrFirst": "Pick a pull request first",
      "pickPrFirstBody": "Choose which PR to review above, then select the agents to run on it.",
      "selectAll": "Select all",
      "clearAll": "Clear all",
      "estimate": "{time} · {cost}",
      "aggregate": "≈ {time} · {cost} · parallel fan-out",
      "runMulti": "Run multi-agent review ({count})",
      "runOne": "Run 1 agent",
      "selectAgents": "Select agents",
      "noEnabled": "Enable agents to run reviews",
      "goToAgents": "Go to Agents"
    },
    "results": {
      "crumb": "Multi-Agent Review",
      "configureRun": "Configure run",
      "title": "Multi-Agent Review",
      "selected": "{count} selected agents · parallel",
      "columns": "Columns",
      "tabs": "Tabs",
      "viewSwitch": "Results view",
      "prNumber": "#{number}",
      "meta": "{count} agents · parallel fan-out · {time} total · {cost}",
      "runStats": "{time} · {cost}",
      "viewTrace": "View trace",
      "findingsCount": "{count, plural, one {# finding} other {# findings}}",
      "status": { "running": "Running…", "failed": "Failed", "cancelled": "Cancelled" },
      "notFound": {
        "title": "Multi-agent run not found",
        "body": "This multi-agent run does not exist or belongs to another workspace.",
        "cta": "Configure run"
      },
      "disagree": {
        "title": "Where agents disagree",
        "onlyConflicts": "Show only conflicts",
        "didNotFlag": "did not flag",
        "noResult": "no result",
        "lines": "lines {start}–{end}"
      }
    },
    "history": { "openResults": "Open multi-agent results" }
  }
  ```
  `{time}` is a pre-formatted segment: `"6.2s"` when known, else `"—"`. `{cost}` is `formatRunCost(x)` (which includes `$`) or `"—"`. That way the AC wording "<seconds>s · $<cost>" holds when both are known, and EC-6/EC-7 render "—". `findingsCount` reads "<k> findings" for every k ≠ 1 (AC-10).
- **Do — tests:**
  - `server/test/multi-review-contracts.test.ts`: `MultiReviewRequest` accepts 1 id and 10 ids. It rejects 0 ids, **11** ids, a duplicate (`["a","a"]`), an empty string, and an extra key (`{agentIds:["a"], all:true}`). Every rejection's issue path starts with `agentIds`, except the extra-key one, which names the key in its message. `RunSummary.parse` still accepts an object without `multi_run_id`, and one with `null`.
  - `client/src/test/multi-review-contract-sync.test.ts`: copy the `eval-contract-sync.test.ts` shape for `platform.ts`, `review-api.ts`, `observability.ts`.
  - `client/src/lib/hooks/multi-review.test.ts`: `multiReviewRefetchInterval` → `2000` for one `running` run among `done` ones and for a `null` status, `false` for all of `done`/`failed`/`cancelled`, and `false` for `undefined`.
  - `AgentAvatar.test.tsx`: each of the five exact names maps to its icon/colour. Near-misses fall back to `Cpu`/`#6b7280`: `"security reviewer"` (case variant), `"Security Reviewer v2"`, `""`, `null`.
- **Done when:** both copies of each of the four contract files are equal under `diff --strip-trailing-cr` for the edited hunks. `0021_*.sql` adds exactly one column, one FK and one index and drops nothing. Server and client both typecheck.
- **Verify:** `node scripts/verify.mjs server --file server/test/multi-review-contracts.test.ts` · `node scripts/verify.mjs client --file client/src/test/multi-review-contract-sync.test.ts --file client/src/lib/hooks/multi-review.test.ts --file client/src/components/agent-avatar/AgentAvatar.test.tsx` · `node scripts/verify.mjs server client --checks`

### S1. Concurrent per-agent fan-out in the executor (+ EC-3 hermetic test)
- **Files:** [`server/src/modules/reviews/run-executor.ts`](server/src/modules/reviews/run-executor.ts) (edit) · `server/test/multi-review-executor.test.ts` (new)
- **Track:** S
- **Layer:** ring 2
- **Skills:** `onion-architecture`
- **Do:**
  - Replace the sequential `for (const { agent, runId } of jobs)` at [:134-161](server/src/modules/reviews/run-executor.ts:134) with `await Promise.all(jobs.map(async ({ agent, runId }) => { … }))`. The body (start log, `runOneAgent`, the existing `try/catch` that logs and swallows) is unchanged, so one rejection never reaches `Promise.all` (EC-1). Update the two doc comments that say "loop"/"each agent" to say "concurrently".
  - Leave the diff load, intent derivation and `failAll` exactly as they are (NFR-2, EC-3). `runOneAgent` already narrows the logger per run (`parentLog.forRun`), so concurrent runs write to their own buffers.
  - Hermetic test: build `new ReviewRunExecutor(fakeContainer, fakeRepo, fakeAgents)`. Use a real `RunBus` from `src/platform/sse.js`, a `git` whose `diff` throws, and a `fakeRepo` whose `getPrFiles` throws `new Error("db down")` and records `saveRunTrace`/`completeAgentRun` calls. Run `executeRuns` with 3 jobs. Assert that all 3 runs get `completeAgentRun(status: 'failed', error: 'Failed to load PR diff: db down')`, that each trace is saved before its terminal status, and that `llm` is never resolved (EC-3, NFR-2).
- **Done when:** the test passes; `pnpm arch` and `pnpm lint` are green.
- **Verify:** `node scripts/verify.mjs server --file server/test/multi-review-executor.test.ts` then `node scripts/verify.mjs server --checks`

### S2. Repository + service: create and read a multi-run; `multi_run_id` on `RunSummary`
- **Files:** [`server/src/modules/reviews/repository/run.repo.ts`](server/src/modules/reviews/repository/run.repo.ts) (edit) · [`server/src/modules/reviews/repository.ts`](server/src/modules/reviews/repository.ts) (edit) · [`server/src/modules/reviews/service.ts`](server/src/modules/reviews/service.ts) (edit) · [`server/src/modules/reviews/constants.ts`](server/src/modules/reviews/constants.ts) (edit)
- **Track:** S
- **Layer:** ring 3 (repo), ring 2 (service, constants)
- **Skills:** `drizzle-orm-patterns` (onion already loaded)
- **Do:**
  - `run.repo.ts`:
    - `createAgentRun` takes an optional `multiRunId?: string | null` and inserts it (default null, which keeps AC-8).
    - `listRunsForPull` maps `multi_run_id: run.multiRunId`.
    - New `createMultiAgentRun(db, { workspaceId, prId }) → id`.
    - New `getMultiAgentRun(db, workspaceId, id) → { id, prId, ranAt } | undefined`, scoped by `workspace_id`.
    - Facade methods for both in `repository.ts`.
  - `constants.ts`: `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` with a comment: an id that is not a uuid cannot be in the workspace → 404, never a Postgres `22P02` → 500 (Q4).
  - `service.ts`:
    - Extract the row-creation + fire-and-forget body of `runReview` ([:109-137](server/src/modules/reviews/service.ts:109)) into a private `startRuns(workspaceId, pull, repo, targets, logger, multiRunId: string | null)`. `runReview` calls it with `null`, and its signature and return are unchanged (AC-8).
    - New `runMultiReview(workspaceId, prId, agentIds, logger)`:
      1. `getPull` → else `NotFoundError('Pull request not found')`; `getRepo` → else 404.
      2. Resolve **every** id first: `UUID_RE.test(id) ? agents.getById(workspaceId, id) : undefined`. Any miss → `NotFoundError('Agent not found')` **before any insert** (EC-5).
      3. `createMultiAgentRun`.
      4. `startRuns(…, multiRunId)` in request order.
      5. Return `{ multi_run_id, pr_id: prId, runs }` (AC-7: ids before any agent finishes).
    - New `getMultiReview(workspaceId, id): MultiReviewDetail`:
      1. `getMultiAgentRun` → else `NotFoundError('Multi-agent run not found')` (EC-9, workspace-scoped).
      2. `getPull(workspaceId, prId)` for `{ id, number, title }`.
      3. `listRunsForPull(workspaceId, prId)` filtered to `multi_run_id === id`, ordered by `ran_at` asc then `run_id`.
      4. `reviewsForPull(prId)` filtered to `review.runId` in those run ids. Map each run to `{ run, summary: review?.summary ?? null, findings: review ? findings.map(findingRowToDto) : [] }`.
      This reuses two existing reads and adds no new SQL. A run deleted from history simply drops out (NFR-6).
  - Grep `server/test` for fakes of `ReviewRepository`/`createAgentRun` (server INSIGHTS, 2026-10-02) and widen any you find.
- **Done when:** `pnpm typecheck` is green and the existing review tests still pass.
- **Verify:** `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs server --file server/test/reviews-helpers.test.ts`

### S3. Routes `POST /pulls/:id/multi-review` and `GET /multi-reviews/:id` (+ integration test)
- **Files:** [`server/src/modules/reviews/routes.ts`](server/src/modules/reviews/routes.ts) (edit) · `server/test/multi-review.it.test.ts` (new)
- **Track:** S
- **Layer:** ring 4
- **Skills:** `fastify-best-practices`
- **Do:**
  - `app.post('/pulls/:id/multi-review', { schema: { params: IdParams, body: MultiReviewRequest, response: { 200: MultiReviewStarted } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, …)`. The handler does `getContext` → `service.runMultiReview(workspaceId, req.params.id, req.body.agentIds, req.log)`.
  - `app.get('/multi-reviews/:id', { schema: { params: IdParams, response: { 200: MultiReviewDetail } } }, …)` → `service.getMultiReview`.
  - Add both to the header comment block. `POST /pulls/:id/review` is untouched.
  - Integration test, modelled on [reviews.it.test.ts](server/test/reviews.it.test.ts). Copy `setupRepoAndPr` and a counting `intentStub` (`ensure` increments a counter). Use `appWith(structured, { failModel?, delayMs? })` with a test-local `MockLLMProvider` subclass that waits `delayMs` in `completeStructured` and throws when `req.model === 'fail-model'`; `src/adapters/mocks.ts` is unchanged. Create agents through `POST /agents` (provider `openai`). Cases:
    - **AC-7:** 3 agents → 200 with `multi_run_id`, 3 `runs`. Right after the response, the 3 `agent_runs` rows exist with `multi_run_id` set, plus 1 `multi_agent_runs` row.
    - **AC-8:** `POST /pulls/:id/review {agentId}` → the same response keys as before (`pr_id`, `runs`, `reviews`); the row's `multi_run_id` is null; `GET /pulls/:id/runs` shows `multi_run_id: null` for it and the id for the multi runs (AC-17 server half).
    - **NFR-1:** `delayMs: 400`, 3 agents. After `waitForPrRuns(…, { expected: 3 })`, `max(ranAt + duration_ms) − min(ranAt) < Σ duration_ms`.
    - **NFR-2:** the intent counter is incremented exactly once for the multi-run, and the LLM's `completeStructured` calls equal 3 (one-file diff, single-pass).
    - **EC-1:** agents `[ok, fail-model, ok]` → 2 `done` with reviews persisted, 1 `failed` with `error` set and `cost_usd` null.
    - **EC-4:** each of `{}`, `{agentIds: []}`, 11 ids, a duplicate, `[""]`, `{agentIds:[id], all:true}` → 422 whose body names `agentIds` (or the extra key). Exactly 10 valid ids → 200 (boundary). Afterwards the `multi_agent_runs` count is unchanged.
    - **EC-5:** an unknown uuid agent, a non-uuid string `"abc"` (→ 404, not 500), an agent from another workspace, and a PR from another workspace → 404 each, with no rows created.
    - **GET:** the detail has `pr.number === 482`, `agents.length === 3`, findings attached to the right run, and `summary` set for done runs. An unknown uuid or a multi-run of another workspace → 404; `/multi-reviews/not-a-uuid` → 422.
    - **NFR-6:** `DELETE /runs/:oneRunId` → GET still 200 with 2 agents. Deleting the PR row → the `multi_agent_runs` row is gone and the agent runs' `multi_run_id` is null.
    - **NFR-7:** the test repo has no index state, and runs end `done` (diff-only, no multi-run-specific error).
- **Done when:** the file passes with Docker up. Run `docker info` first. A skipped file is not green (server INSIGHTS, 2026-10-02).
- **Verify:** `node scripts/verify.mjs server --checks` then `node scripts/verify.mjs server --it --file server/test/multi-review.it.test.ts`

### S4. `GET /agents/run-estimates` (last 20 completed runs per agent)
- **Files:** [`server/src/modules/agents/repository.ts`](server/src/modules/agents/repository.ts) (edit) · [`service.ts`](server/src/modules/agents/service.ts) (edit) · [`routes.ts`](server/src/modules/agents/routes.ts) (edit) · [`constants.ts`](server/src/modules/agents/constants.ts) (edit) · `server/test/agents-run-estimates.it.test.ts` (new)
- **Track:** S
- **Layer:** ring 3 / 2 / 4
- **Do:**
  - `constants.ts`: `RUN_ESTIMATE_WINDOW = 20`.
  - `AgentsRepository.runEstimates(workspaceId, window)`: one query with a `row_number() over (partition by agent_id order by ran_at desc)` subquery over `agent_runs` where `workspace_id = $1 and status = 'done' and agent_id is not null`, keeping `rn <= window`. It groups by `agent_id`, selecting `count(*)`, `avg(duration_ms)`, `avg(cost_usd)`. `avg` skips nulls, which is the null-not-zero rule.
  - `AgentsService.runEstimates(workspaceId)`: merge with `repo.list(workspaceId)` so **every** agent has a row (`sample_runs: 0`, both averages `null` when it has no done run, EC-6). Round `avg_duration_ms` to an integer and keep `avg_cost_usd` null when no run in the window has a known cost.
  - Route `app.get('/agents/run-estimates', { schema: { response: { 200: z.array(AgentRunEstimate) } } }, …)`. A static path wins over `/agents/:id` in Fastify's router. Add it to the header comment.
  - Integration test, with boundary inputs:
    - **21** done runs for agent X, where the oldest has `duration_ms: 100000` and the 20 newest have `1000` → `avg_duration_ms === 1000`, `sample_runs === 20`. Exactly 20 runs including the outlier → the outlier is counted.
    - A `failed` run with a huge duration is ignored (status near-miss).
    - Runs with `cost_usd` null plus one with `0.01` → `avg_cost_usd === 0.01`, not 0.005. All null → `null`.
    - An agent with no runs → `sample_runs: 0`, `null`, `null`.
    - Another workspace's runs are not counted.
- **Done when:** the test passes with Docker up.
- **Verify:** `node scripts/verify.mjs server --checks` then `node scripts/verify.mjs server --it --file server/test/agents-run-estimates.it.test.ts`

### A1. Estimate formatting helpers
- **Files:** `client/src/lib/run-estimates.ts` (new) · `client/src/lib/run-estimates.test.ts` (new)
- **Track:** A
- **Layer:** `src/lib` (shared by the PR-route dropdown and the Configure run route, so not route-local)
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- **Do:** pure functions (type-only import of `AgentRunEstimate`):
  - `formatSeconds1(ms: number | null): string | null` → `"6.2"`.
  - `estimateParts(est?: AgentRunEstimate): { time: string; cost: string }` → time `"6.2s"` or `"—"`; cost `formatRunCost(avg_cost_usd)` or `"—"`.
  - `hintSeconds(est?): number | null` → `Math.round(avg_duration_ms / 1000)` for the `~{seconds}s` hint.
  - `aggregateParts(selected: (AgentRunEstimate | undefined)[]): { time: string; cost: string }`. Time is the max over agents **with** a duration; it is `"—"` when none has one. Cost is the sum over the selected agents, or `"—"` when **any** selected agent's cost is null/missing (EC-6: never counts unknown as $0).
- **Done when:** tests cover a known estimate; a missing estimate; `avg_cost_usd: null` with a known time; the aggregate where one of three has no duration (excluded from the max); one of three with null cost (`"—"`); all three known (sum); an empty selection.
- **Verify:** `node scripts/verify.mjs client --file client/src/lib/run-estimates.test.ts`

### A2. PR-page agent picker (AC-1, AC-2, AC-3, EC-10, EC-12)
- **Files:** [`RunReviewDropdown.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx) (edit) · [`RunReviewDropdown.test.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx) (edit) · [`constants.ts`](client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/constants.ts) (edit) · `styles.ts` (edit)
- **Track:** A
- **Layer:** PR route feature folder
- **Skills:** `next-best-practices` (others already loaded)
- **Do:**
  - Keep the props and the trigger button (`Run Review`, `loading`, merged dimming). Replace the vendored `Dropdown` with a local popover: `open` state, an outside-`mousedown` close copied from [Dropdown.tsx:73-80](client/src/vendor/ui/kit/Dropdown.tsx:73), Escape to close, and the panel aligned right at `DROPDOWN_WIDTH`. Rec 4.
  - Panel order (AC-1):
    1. the existing merged warning (`prReview` `runReview.mergedWarning`) when `warnMerged`;
    2. a header row with `picker.header` ("PICK AGENTS TO RUN") and a text button reading `picker.clear` ("Clear") when every enabled agent is checked, else `picker.selectAll` ("Select all");
    3. one row per **enabled** agent (Q-1) built from `@devdigest/ui` `Checkbox` with `label` = `<AgentAvatar size="sm" name> <name>`, so the accessible name is the agent name (NFR-5). The hint (`picker.timeHint` "~{seconds}s" from `useAgentRunEstimates()`, or `picker.unknown` "—") sits **outside** the label;
    4. the run button;
    5. the link button `picker.configureAgents` ("Configure agents…") → `router.push("/agents")`.
  - Initial selection is all enabled agents (Q-2). Re-seed it when the enabled set first loads.
  - Run button label/action (AC-2):
    - 0 checked → `picker.selectAnAgent` ("Select an agent"), disabled.
    - 1 → `picker.runOne` ("Run {name}"). It calls the **existing** `kick({ agentId })` path unchanged (`useRunReview`, `onRunStart`/`onRunsStarted`/`onRunSettled`).
    - ≥2 → `picker.runMulti` ("Run multi-agent review ({count})"). It calls `useStartMultiReview().mutateAsync({ prId, agentIds })`, then `router.push(\`/multi-agent/${res.multi_run_id}\`)` (AC-3).
    - Disabled while either mutation `isPending` (EC-10). Close the popover on start.
  - No enabled agent → in place of the list, one line with `picker.noEnabled` ("Enable agents to run reviews") and a link button `picker.goToAgents` ("Go to Agents") → `/agents` (EC-12).
  - `useTranslations("multiReview")` for new strings, and keep `useTranslations("prReview")` for the existing ones. Remove the now-unused `runReview.runAll` usage, but leave the key in `prReview.json`.
- **Done when:** the test (mock `@/lib/hooks/agents`, `@/lib/hooks/reviews`, `@/lib/hooks/multi-review`; provider messages `{ prReview, multiReview }`) shows:
  - the header text; only enabled agents as `getAllByRole("checkbox")` with `aria-checked="true"` for all;
  - "Clear" → none checked → the button reads "Select an agent" and is disabled → "Select all" restores;
  - one checked → "Run Security Reviewer" calls `useRunReview().mutateAsync` with `{ prId, agentId }`;
  - two checked → "Run multi-agent review (2)" calls the multi mutation with exactly those ids and pushes `/multi-agent/m1`;
  - while `isPending` the button is disabled;
  - `warnMerged` → the merged warning renders above the header;
  - zero enabled → "Enable agents to run reviews" + "Go to Agents";
  - a missing estimate → "—".
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx"`

### A3. Sidebar item + Configure run screen (AC-4, AC-5, AC-6, EC-6, EC-10, EC-12)
- **Files:** [`client/src/vendor/ui/nav.ts`](client/src/vendor/ui/nav.ts) (edit, app-owned) · [`client/src/components/app-shell/nav.test.ts`](client/src/components/app-shell/nav.test.ts) (edit) · `client/src/app/multi-agent/page.tsx` (new) · `client/src/app/multi-agent/_components/ConfigureRunView/ConfigureRunView.tsx`, `ConfigureRunView.test.tsx`, `styles.ts`, `index.ts` (new)
- **Track:** A
- **Do:**
  - `nav.ts`: append a group `{ section: "GLOBAL", items: [{ key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/multi-agent" }] }`, as in design 01/04 (Q6). The key matches `activeKeyFor` and `shell.json` `nav.multi-agent`. `nav.test.ts`: assert the item and `activeKeyFor("/multi-agent") === "multi-agent"` and `activeKeyFor("/multi-agent/x") === "multi-agent"`.
  - `page.tsx`: a server component that renders `<ConfigureRunView />` (client/INSIGHTS.md, 2026-09-29).
  - `ConfigureRunView` (`"use client"`) inside `AppShell` with crumb `[results.crumb, configure.crumb]`:
    - `h1` `configure.title` ("Run a Multi-Agent Review") + `configure.subtitle`.
    - Step "1" `configure.stepPr` ("Pull request"): a PR picker over `usePulls(activeRepo?.id)` showing `configure.prItem` ("#{number} · {title}") per PR, with `configure.selectPr` as the empty label. A native `<select>` or a `SearchableSelect` from `@devdigest/ui` is fine; the title is plain text with ellipsis (R44).
    - Step "2" `configure.stepAgents` ("Agents to run"). With no PR picked it shows the empty state `configure.pickPrFirst` ("Pick a pull request first") + `configure.pickPrFirstBody`. With a PR it shows one card per **enabled** agent: `Checkbox` labelled by `AgentAvatar` + name, the description (plain text), and the estimate `configure.estimate` ("{time} · {cost}") from `estimateParts`. Next to the step title is a switch reading `configure.clearAll` ("Clear all") when all are checked, else `configure.selectAll` ("Select all"). All enabled agents start checked (Q-2).
    - Run bar: button `configure.runMulti` ("Run multi-agent review ({count})") for N ≥ 2, `configure.runOne` ("Run 1 agent") for 1, `configure.selectAgents` ("Select agents") disabled for 0. It is also disabled with no PR (AC-4) and while the mutation is pending (EC-10). When a PR and ≥1 agent are picked, show `configure.aggregate` ("≈ {time} · {cost} · parallel fan-out") from `aggregateParts`. Click → `useStartMultiReview` with the PR's uuid `id` (from the pulls list) → `router.push(\`/multi-agent/${multi_run_id}\`)`, for one agent too (Rec 5).
    - No enabled agents → `configure.noEnabled` + a `configure.goToAgents` link to `/agents` (EC-12).
- **Done when:** component tests (mock the hooks) show:
  - no PR → "Pick a pull request first" and the run button disabled;
  - after picking "#482 · Add rate limiting" → 2 enabled cards (a disabled third agent absent), each with "6.2s · $0.012"-style text and one with "— · —" when its estimate is missing;
  - the aggregate "≈ 7.4s · $0.026 · parallel fan-out" for two known agents, and "≈ 6.2s · — · parallel fan-out" when one checked agent has an unknown cost;
  - labels "Run multi-agent review (2)" → uncheck one → "Run 1 agent" → uncheck → "Select agents" (disabled);
  - "Clear all"/"Select all" toggling;
  - submit calls the mutation with exactly the checked ids and pushes the results URL;
  - the zero-enabled empty state.
- **Verify:** `node scripts/verify.mjs client --file client/src/app/multi-agent/_components/ConfigureRunView/ConfigureRunView.test.tsx --file client/src/components/app-shell/nav.test.ts`

### A4. "Open multi-agent results" in the PR run history (AC-17)
- **Files:** [`RunHistory.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx) (edit) · [`RunHistory.test.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx) (edit)
- **Track:** A
- **Do:** in a run row (`:238-330`), when `r.multi_run_id` is truthy, render a `next/link` `Link` to `/multi-agent/${r.multi_run_id}` with text `history.openResults` ("Open multi-agent results") (`useTranslations("multiReview")`), placed before the trace button. Render nothing new when it is null or absent.
- **Done when:** the test (add `multiReview` to the provider messages) shows: a run with `multi_run_id: "m1"` → a link named "Open multi-agent results" with `href="/multi-agent/m1"`; runs with `multi_run_id: null` and with the key absent → no such link. Existing tests still pass.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx"`

### A5. e2e flow for AC-4
- **Files:** `e2e/specs/18-multi-agent-configure.flow.json` (new)
- **Track:** A
- **Do:** copy the shape of [15-onboarding-tour.flow.json](e2e/specs/15-onboarding-tour.flow.json). Steps:
  1. `open {BASE}/`;
  2. `wait --url /pulls`;
  3. `wait --load networkidle`;
  4. `wait --text "Multi-Agent Review"` (sidebar GLOBAL item);
  5. `find text "Multi-Agent Review" click`;
  6. `wait --url /multi-agent`;
  7. `wait --load networkidle`;
  8. `wait --text "Run a Multi-Agent Review"`;
  9. `wait --text "Pick a pull request first"`.

  The description states AC-4 of the spec, that it never picks a PR or clicks Run (no model call), and that it is read-only on seeded data.
- **Done when:** `node scripts/verify.mjs e2e --checks` is green. The flow runs in I1.
- **Verify:** `node scripts/verify.mjs e2e --checks`

### B1. Promote the drawer and the finding cards to shared locations (move, no fork)
- **Files:**
  - moved (use `git mv` to keep history):
    - `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**` → `client/src/components/run-trace-drawer/**` (same internal tree, `_components/` included);
    - `…/_components/FindingCard/**` → `client/src/components/finding-card/**`;
    - `…/_components/FindingsPanel/**` → `client/src/components/findings-panel/**`;
    - `…/pulls/[number]/github-urls.ts` → `client/src/lib/github-urls.ts`.
  - edited: [`page.tsx`](client/src/app/repos/[repoId]/pulls/[number]/page.tsx) (`:17`, `:23`) · [`DiffTab.tsx:26`](client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:26) · [`ReviewRunAccordion.tsx:11`](client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:11) · [`BlastGroup.tsx:12`](client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/_components/BlastGroup/BlastGroup.tsx:12) · [`PriorPrs.tsx:11`](client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/_components/PriorPrs/PriorPrs.tsx:11)
- **Track:** B
- **Layer:** `src/components` (shared UI), `src/lib` (pure util)
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **Do:**
  - Rewrite every `@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/<x>` import inside the drawer tree (7 sites: `FindingsSection.tsx:14`, `PromptBlock.tsx:8`, `ToolCallRow.tsx:8`, `TraceBody.tsx:10-12`, `TraceSection.tsx:6`) to `@/components/run-trace-drawer/<x>`.
  - In the moved `FindingCard.tsx` change `../../github-urls` → `@/lib/github-urls`. In `FindingsPanel.tsx` and `findings-panel/helpers.ts` change `../FindingCard` → `@/components/finding-card`.
  - Re-point the five importers listed above.
  - Fix the moved tests' relative `messages/en/*.json` imports for the new depth (`src/components/<x>/` → `../../../messages/en/…`) and any relative `vi.mock` paths.
  - No other line changes: no prop, style or behaviour change (DR-5).
- **Done when:**
  - `rg "@/app" client/src/components client/src/lib` finds nothing (the lint rule `no-restricted-imports` also enforces this);
  - `rg "_components/(RunTraceDrawer|FindingCard|FindingsPanel)|pulls/\[number\]/github-urls" client/src` finds nothing;
  - the three moved test files pass unchanged in substance;
  - `client` typecheck is green for B's files.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/run-trace-drawer/RunTraceDrawer.test.tsx --file client/src/components/finding-card/FindingCard.test.tsx --file client/src/components/findings-panel/FindingsPanel.test.tsx --file client/src/components/findings-panel/helpers.test.ts`

### B2. Pure grouping, disagreement and meta helpers (AC-13, AC-14, AC-15, AC-9, EC-7, EC-11)
- **Files:** `client/src/app/multi-agent/[multiRunId]/_components/MultiReviewView/helpers.ts` (new) · `helpers.test.ts` (new) · `constants.ts` (new)
- **Track:** B
- **Do (type-only imports from `@devdigest/shared`):**
  - `constants.ts`: `MATCH_LINE_SLACK = 3` (the one tunable, Q-7); `SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 }`; `POLL_MS` is not needed (step 0 owns it).
  - `groupFindings(agents: MultiReviewAgent[]): MatchGroup[]`:
    - Two findings **from different runs** link when `a.file === b.file` (exact, case-sensitive) and `a.start_line − 3 ≤ b.end_line + 3 && b.start_line − 3 ≤ a.end_line + 3`.
    - Groups are connected components (union-find), so two findings of one agent can share a group only through another agent.
    - Output is deterministic: members sorted by `(file, start_line, end_line, agent index, finding id)`, groups sorted by their first member. Title and category are ignored.
  - `disagreementRows(agents, groups): Row[]`, one per group (a group of one included):
    - header `{ file, line, title }` from the member with the lowest `SEVERITY_RANK`, ties broken by `start_line` then agent order;
    - `cells` — exactly one per agent in `agents`, in order:
      - `{ kind: "flagged", findings }` (that agent's members, originals untouched) when it has members in the group;
      - else `{ kind: "didNotFlag" }` when its `run.status === "done"`;
      - else `{ kind: "noResult" }` for `failed`/`cancelled` (EC-11), and for a still-running run (Q2);
    - `isConflict`: over cells from `done` runs only, take each one's answer (the highest severity among its findings, or `"none"` for didNotFlag). It is a conflict when those answers are not all equal (Q1). `noResult` cells never count.
  - `wallTimeMs(detail)`: `null` while any run is `running`/null (Q3), else `max(Date.parse(run.ran_at) + run.duration_ms) − Date.parse(detail.ran_at)` over runs with both values.
  - `totalCost(detail)`: the sum of `cost_usd` over `status === "done"` runs, or `null` when any done run has `cost_usd == null` (EC-7). Failed and cancelled runs are excluded.
- **Done when:** `helpers.test.ts` pins:
  - **boundary:** A `src/a.ts` 10–10 vs B 16–16 → one group (widened edges meet at 13); A 10–10 vs B 17–17 → two groups (one past the cap);
  - **near-misses:** `src/A.ts` vs `src/a.ts` (case variant) and root-level `config.ts` vs `src/config.ts` → never grouped;
  - two findings of the **same** agent at the same lines with no other agent → two groups of one;
  - a transitive chain A(10)–B(15)–C(20) → one group;
  - shuffling the input order (agents and findings) → deep-equal output;
  - rows:
    - all-WARNING from two done agents → `isConflict: false`;
    - WARNING + didNotFlag → `true`;
    - WARNING + failed agent → cell `noResult` and `false`;
    - CRITICAL vs SUGGESTION → header is the CRITICAL finding's `file:line` and title;
  - `totalCost` with one done run at null cost → `null`, and with a failed run → excluded;
  - `wallTimeMs` → `null` while one run is `running`.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/multi-agent/[multiRunId]/_components/MultiReviewView/helpers.test.ts"`

### B3. Results page: route, header, meta, Columns, Tabs, polling, drawer, not-found (AC-9…AC-12, EC-2, EC-7, EC-8, EC-9, NFR-5, NFR-8)
- **Files:** `client/src/app/multi-agent/[multiRunId]/page.tsx` (new) · `…/_components/MultiReviewView/MultiReviewView.tsx`, `MultiReviewView.test.tsx`, `styles.ts`, `index.ts` (new) · `…/_components/AgentColumn/AgentColumn.tsx`, `AgentColumn.test.tsx`, `index.ts` (new) · `…/_components/AgentTabs/AgentTabs.tsx`, `AgentTabs.test.tsx`, `index.ts` (new)
- **Track:** B
- **Do:**
  - `page.tsx`: a server component that does `const { multiRunId } = await params` and renders `<MultiReviewView id={multiRunId} />`.
  - `MultiReviewView` (`"use client"`):
    - Reads `useMultiReview(id)`, which re-reads every 2 s while in flight and stops after (AC-10, EC-8, step 0).
    - Loading → `Skeleton`s.
    - `ApiError` with status 404 or 422 → `EmptyState` with `results.notFound.title` / `.body` and a CTA `results.notFound.cta` ("Configure run") linking to `/multi-agent` (EC-9).
    - Header row: a link button `results.configureRun` ("Configure run") → `/multi-agent`; `h1` `results.title` ("Multi-Agent Review"); `results.selected` ("{count} selected agents · parallel") with `count = agents.length`; a two-button switch labelled by `results.viewSwitch`, with buttons `results.columns` ("Columns") and `results.tabs` ("Tabs") carrying `aria-pressed` (NFR-5). Default is Columns.
    - Meta row: `results.prNumber` ("#{number}") + the PR title (plain text, ellipsis) … `results.meta` ("{count} agents · parallel fan-out · {time} total · {cost}"). `time` is `wallTimeMs` formatted `"8.2s"` or `"—"`, and `cost` is `totalCost` through `formatRunCost` or `"—"` (AC-9, EC-7).
    - Crumb: `[{ label: results.crumb, href: "/multi-agent" }, { label: "#482", mono: true }]`.
    - Columns: a grid `repeat(N, minmax(220px, 1fr))` in a wrapper with `overflowX: "auto"` (NFR-8), one `AgentColumn` per agent, then `DisagreementBlock` (B4).
    - Tabs: `AgentTabs`, then `DisagreementBlock`.
    - Drawer: local state `traceRunId`. "View trace" → mount `<RunTraceDrawer key={runId} runId agentName={run.agent_name} prNumber={pr.number} findings={agent.findings} running={run.status === "running"} onClose />` from `@/components/run-trace-drawer` (AC-12: the Live log opens first and streams while running; the drawer is otherwise unchanged).
  - `AgentColumn({ agent, onViewTrace })`:
    - Header: `AgentAvatar md` + agent name (ellipsis) + `results.runStats` ("{time} · {cost}"), with `time` from `run.duration_ms` and cost `"—"` when null (EC-7). A `CircularScore` appears when `status === "done"` and `score != null`.
    - Body:
      - `running`/null → `results.status.running` text;
      - `failed`/`cancelled` → `results.status.failed` / `.cancelled` + `run.error` text (EC-2);
      - `done` → one mini row per finding: the SEV icon **and** label text from `SEV` (`src/vendor/ui/primitives/tokens.ts`), the title (plain text), and `file:start_line` (mono).
    - Footer: a `results.viewTrace` ("View trace") button, **always** shown including on failed runs (EC-2), plus `results.findingsCount`.
    - Top border is the agent colour (AC-18).
  - `AgentTabs({ agents, prId, onViewTrace })`:
    - One tab per agent: `AgentAvatar sm` + name + score text (or the status label when not done). Use `role="tab"`/`aria-selected`, or the kit `Tabs` if its labels accept nodes.
    - Selected panel header: `CircularScore`, name, `summary` (plain text), "View trace", `results.runStats`.
    - Below it: `<FindingsPanel findings={agent.findings} prId={prId} evalAgentAvailable={!!run.agent_id && !!run.agent_name} />` from `@/components/findings-panel`. That gives confidence, the suggested fix, Accept, Dismiss and Turn into eval case with the PR page's own hooks, so the finding changed is the same row (AC-11). "Learn" is not built (Q-4).
- **Done when:** tests (mock `@/lib/hooks/multi-review`; stub `@/components/run-trace-drawer` and `@/components/findings-panel` to marker elements) show:
  - **AC-9:** "Configure run", "Multi-Agent Review", "3 selected agents · parallel", "#482", the title, and "3 agents · parallel fan-out · 8.2s total · $0.03"-style meta;
  - **EC-7:** one done run with null cost → that column's "· —" and the meta "· —";
  - **AC-10/EC-8:** a detail with one `running` run renders "Running…" in that column and finished columns in full;
  - **EC-2:** a failed run shows "Failed", its error text and a "View trace" button, while the other columns show scores;
  - **AC-12:** clicking "View trace" mounts the drawer marker with that `runId` and `running` true/false per status;
  - **AC-11:** Tabs → 3 tabs; selecting the second shows its summary and the FindingsPanel marker with its findings;
  - **EC-9:** a 404 `ApiError` → "Multi-agent run not found" + a "Configure run" link to `/multi-agent`;
  - **NFR-5:** the Columns/Tabs buttons expose `aria-pressed`.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/multi-agent/[multiRunId]/_components/MultiReviewView/MultiReviewView.test.tsx" --file "client/src/app/multi-agent/[multiRunId]/_components/AgentColumn/AgentColumn.test.tsx" --file "client/src/app/multi-agent/[multiRunId]/_components/AgentTabs/AgentTabs.test.tsx"`

### B4. "Where agents disagree" block (AC-14, AC-15, EC-11, NFR-5)
- **Files:** `client/src/app/multi-agent/[multiRunId]/_components/DisagreementBlock/DisagreementBlock.tsx`, `DisagreementBlock.test.tsx`, `index.ts` (new)
- **Track:** B
- **Do:**
  - `DisagreementBlock({ agents })` memoises `disagreementRows(agents, groupFindings(agents))`.
  - Title: `SectionLabel` with `results.disagree.title` ("Where agents disagree"). On the right, `<label>` text `results.disagree.onlyConflicts` ("Show only conflicts") wrapping the vendored `Toggle` (`role="switch"`, `aria-checked`), which gives it an accessible name (NFR-5).
  - Rows: header `file:line` (mono) + the header finding's title. Cells: a grid with one cell per agent, each showing `AgentAvatar sm` + agent name (AC-18). Then, by `kind`:
    - `flagged` → per finding, the SEV label text + the original title, as a `button` with `aria-expanded` that reveals `<Markdown>` of the original `rationale` and `results.disagree.lines` ("lines {start}–{end}") (AC-14, R43);
    - `didNotFlag` → `results.disagree.didNotFlag` ("did not flag"), with **no** explanation text (AC-15, DR-17);
    - `noResult` → `results.disagree.noResult` ("no result") (EC-11).
  - With the toggle on, rows with `isConflict === false` are hidden.
- **Done when:** the test shows:
  - a group-of-one location renders as a row;
  - every selected agent has exactly one cell per row, and no unselected agent appears;
  - "did not flag" carries no note;
  - a failed agent reads "no result";
  - expanding a cell shows the rationale and "lines 10–12";
  - with the toggle on, an all-same-severity row disappears and a WARNING-vs-did-not-flag row stays;
  - `getByRole("switch", { name: /Show only conflicts/ })` exists.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/multi-agent/[multiRunId]/_components/DisagreementBlock/DisagreementBlock.test.tsx"`

### I1. Integration — docs, boundaries, the one full run, e2e
- **Files:** [`server/README.md`](server/README.md) (edit: the `reviews` node in the API diagram at `:106` gains `/pulls/:id/multi-review · /multi-reviews/:id`, and the agents route list gains `GET /agents/run-estimates`) · [`client/README.md`](client/README.md) (edit: the UI route map at `:19-50` gains `/multi-agent` (Configure run) and `/multi-agent/:id` (results), with their API edges, and a note that the drawer, FindingsPanel and FindingCard now live under `src/components/`)
- **Track:** shared
- **Do:**
  - Wiring needs no code: the dropdown and Configure run push `/multi-agent/<id>`, which B's route serves. Confirm it by reading.
  - **NFR-9:** `git diff --stat 6739e6d -- agent-runner ci` and `git status --short -- agent-runner ci` both print nothing.
  - **R48:** `git diff 6739e6d -- server/src/db/migrations` shows only the new `0021_*` files and `_journal.json`. The `RunRequest` block in `platform.ts` and the `/pulls/:id/review` handler are byte-identical to `6739e6d`.
  - Check that `client/src/vendor/shared/contracts/*` equals the server copies for the edited hunks (`diff --strip-trailing-cr`).
  - Run `./scripts/e2e.sh` (needs Docker + agent-browser). If they are unavailable, record that flow 18 is unexecuted. Do not report it green.
- **Done when:** every command below is green, the e2e run is green or explicitly reported as not run, and the READMEs name the three new endpoints and two routes.
- **Verify:** `node scripts/verify.mjs server client` (the one full run) · `node scripts/verify.mjs server --it` (after `docker info`) · `node scripts/verify.mjs e2e --checks` · `./scripts/e2e.sh`

### M1. Manual — AC-16 benchmark and NFR-8 look (a person, after the chain; never the implementer)
- **Files:** `docs/multi-agent-review-benchmark.md` (new, **written by the person**)
- **Do (AC-16, verbatim procedure):**
  1. `./scripts/dev.sh`, then open the demo PR #482.
  2. Run a multi-agent review with 3 agents and check the columns, the location rows and the disagreement block.
  3. Run the same PR with 1 agent through the Configure run screen.
  4. Record for both runs: wall time, tokens in/out (from each run's trace Stats), cost, findings count, the number of match groups (the location rows), and the measured ratio. The conclusion is not tuned toward 3×. Name shared preparation, caching and response length as possible causes of any gap.
- **NFR-8:** open a 6-agent results page at 1024 px width. Columns keep ≥220 px and the row scrolls horizontally without overlap.
- **Done when:** the person commits the doc. No implementer writes numbers into it.

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server --file server/test/multi-review-contracts.test.ts` | EC-4 shape boundaries (0 / 1 / 10 / 11 ids, duplicate, empty, extra key), `RunSummary` without `multi_run_id` |
| server | `node scripts/verify.mjs server --file server/test/multi-review-executor.test.ts` | EC-3, NFR-2 (no LLM after a failed diff load) |
| server | `node scripts/verify.mjs server --it --file server/test/multi-review.it.test.ts` | AC-7, AC-8, AC-17 (server half), EC-1, EC-4 (HTTP 422 + nothing created), EC-5 (incl. non-uuid → 404), EC-9 (server 404/422), NFR-1, NFR-2, NFR-6, NFR-7 |
| server | `node scripts/verify.mjs server --it --file server/test/agents-run-estimates.it.test.ts` | AC-5 / EC-6 data: 20-vs-21 window, `failed` excluded, null cost never 0, no-run agent, workspace scope |
| client | `node scripts/verify.mjs client --file client/src/test/multi-review-contract-sync.test.ts` | contract mirror (Rec 8) |
| client | `node scripts/verify.mjs client --file client/src/components/agent-avatar/AgentAvatar.test.tsx` | AC-18 incl. near-miss names |
| client | `node scripts/verify.mjs client --file client/src/lib/hooks/multi-review.test.ts` | AC-10 stop/continue rule, EC-8 |
| client | `node scripts/verify.mjs client --file client/src/lib/run-estimates.test.ts` | EC-6 formatting and aggregate |
| client | `node scripts/verify.mjs client --file "…/RunReviewDropdown/RunReviewDropdown.test.tsx"` | AC-1, AC-2, AC-3, EC-10, EC-12, NFR-5 |
| client | `node scripts/verify.mjs client --file client/src/app/multi-agent/_components/ConfigureRunView/ConfigureRunView.test.tsx --file client/src/components/app-shell/nav.test.ts` | AC-4 (component), AC-5, AC-6, EC-6, EC-10, EC-12, DR-3 nav |
| client | `node scripts/verify.mjs client --file "…/RunHistory/RunHistory.test.tsx"` | AC-17 |
| client | `node scripts/verify.mjs client --file "client/src/app/multi-agent/[multiRunId]/_components/MultiReviewView/helpers.test.ts"` | AC-13 (boundary ±3, case variant, root-level near-miss, transitivity, order independence), AC-14 header, AC-15 conflict rule, EC-7, EC-11 |
| client | the `MultiReviewView`, `AgentColumn`, `AgentTabs`, `DisagreementBlock` tests | AC-9, AC-10, AC-11, AC-12, AC-14, AC-15, EC-2, EC-7, EC-8, EC-9, EC-11, NFR-5 |
| client | the moved `RunTraceDrawer` / `FindingCard` / `FindingsPanel` tests | DR-5 move with no behaviour change |
| e2e | `./scripts/e2e.sh` (flow `18-multi-agent-configure.flow.json`) | AC-4 end-to-end, no model call |
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic suite |
| server | `node scripts/verify.mjs server --it` | + every `*.it.test.ts` (Docker; check `docker info` first) |
| client | `node scripts/verify.mjs client` | lint · typecheck · components |
| e2e | `node scripts/verify.mjs e2e --checks` | lint · typecheck of the e2e package |
| — | static (I1) | NFR-4 (no literal UI strings; gate rule), NFR-9, R48 |
| — | manual (M1) | AC-16, NFR-8 |

## Risks & rollback
- **Two client tracks share one `typecheck`.** A half-written file in track A turns track B's `client --checks` red, and the reverse. Each track verifies with `--file` while it works. At its end it runs `client --checks` and reports only errors in **its own** owned files; red from the other track's files is noted, not fixed. Integration runs the one authoritative full check. · rollback: none needed; it is a sequencing artefact.
- **The concurrent fan-out changes "Run all enabled agents" on `POST /pulls/:id/review` too.** Up to N simultaneous provider calls could hit provider rate limits (429s go through the existing transport retry) or surface an order-dependent assumption in `reviews.it.test.ts`/`conventions.it.test.ts` (both known to flake, server/INSIGHTS.md Recurring Errors). Prove a clean `6739e6d` baseline before blaming S1. · rollback: revert S1 (the `Promise.all` back to `for`). The multi-review feature still works, only sequentially, and NFR-1 fails.
- **The B1 moves touch about 30 files.** The PR will trip the gate's `pr-size` WARNING (>40 files / >1500 lines). That is a WARNING, not a block. · rollback: `git mv` back. No logic lives in the move.
- **Stale INSIGHTS paths.** Entries cite `…/RunTraceDrawer/helpers.ts:27`, `FindingCard/styles.ts:7` and `github-urls` under the PR route. They become stale after B1. `/engineering-insights` should note the move. The implementer does not edit INSIGHTS.
- **Migration on an existing dev DB.** `0021` is additive and nullable, so `pnpm db:migrate` is safe on existing data. · rollback: a new generated migration dropping the column (never edit `0021` once applied).
- **Response schema on `GET /multi-reviews/:id`.** A mapper mismatch surfaces as a generic 500 `internal_error`, not malformed JSON (server/INSIGHTS.md, 2026-09-26). The S3 test parses the body with `MultiReviewDetail.safeParse` to make it visible.
- **Precondition P.** If dependencies are installed by junction instead of a fresh install, `pnpm db:generate`/`pnpm run` can rewrite the main checkout's `node_modules` (root INSIGHTS, 2026-09-29).

## Out of scope
- Per-agent "did not flag" explanations, the "Learn" action, the "+N agents" badge (DR-18), LLM or semantic dedup, a multi-run history list, worktree fan-out, storing a colour or icon on the agent (spec Non-goals).
- Any change under `ci/` or `agent-runner/`; any change to `POST /pulls/:id/review`, `RunRequest`, applied migrations, `reviewer-core/**` or `mcp/**`.
- Deleting or rewriting the stale `MultiAgentRun`/`AgentStats` contracts or the unused `runs.json` `page.*` strings (Rec 10, Rec 6).
- A server guard against two concurrent multi-runs on one PR (Q-8: client disable only).
- Refactoring `RunHistory`/`FindingsTab` beyond the one link; making the PR page pass `running` to the drawer.
- No track edits a file owned by another track (see *Tracks*).
- Writing or amending the spec, or flipping its `Status`. A gap goes back to `spec-creator` or the person, as an Open question.
- Architectural review and security review. Separate agents own those.
- Opening or pushing a PR. `/pr-self-review` and the gate own that.
- Writing benchmark numbers (M1 is the person's).

## Open questions
- **Blocking (precondition, not spec):** dependencies are not installed in this worktree, so no `verify.mjs` or `pnpm db:generate` can run. Who decides: the person / `/run-plan` orchestrator. Default: a fresh `pnpm install --frozen-lockfile` in `server/` and `client/` and `npm ci` in `e2e/` (step P), never a junction.
- **Non-blocking Q1 (AC-15 "conflict"):** does "did not flag" count as a different answer from a severity? Default: **yes**. A row is a conflict unless every *completed* agent gave the same answer, with "did not flag" as its own value. Failed, cancelled and running agents never count. — the person (spec owner)
- **Non-blocking Q2 (AC-15 while in flight):** what does a cell for an agent that is still running show? Default: "no result" (an existing copy string; no new UI state). It is replaced on the next 2 s re-read. — the person
- **Non-blocking Q3 (AC-9 T while in flight):** what does the meta row's total time show before the last agent ends? Default: "—", since T is undefined until then. Columns show per-run status meanwhile. — the person
- **Non-blocking Q4 (EC-4 vs EC-5):** a non-empty, non-uuid agent id. Default: **404** (it is not in the workspace, per EC-5), via `UUID_RE`, never a 500. The 422 alternative would mean `z.string().uuid()` in the contract. — the person
- **Non-blocking Q5 (Rec 1):** promote `FindingsPanel`/`FindingCard` (+ `github-urls` → `src/lib`) as a move. Default: **yes**. Otherwise AC-11 needs either a forked card or a CRITICAL cross-route import. — the person
- **Non-blocking Q6 (nav placement):** Multi-Agent Review goes in a new sidebar section **GLOBAL**, as in designs 01/04, rather than WORKSPACE. Default: GLOBAL. — the person
- **Non-blocking (R46):** "3 implementer agents in total" is read as ≤3 parallel track agents and ≤5 invocations. If it means 3 invocations, run single-agent (header). — the person / orchestrator
