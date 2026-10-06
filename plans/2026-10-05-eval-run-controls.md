# Implementation Plan: Eval run controls and history views (Promote vN, Run all agents, time window, agent switcher, Evals-tab trend)

**Plan ID:** 2026-10-05-eval-run-controls  ·  **Spec:** [specs/2026-10-05-eval-run-controls.md](specs/2026-10-05-eval-run-controls.md)  ·
**Execution mode:** multi-agent (step 0 → tracks A, B in parallel → Integration)  ·  **Packages:** server, client, e2e  ·
**Assumptions:** Q-1…Q-4 of the spec take their stated defaults. The plan's own Q1–Q5 (see *Open questions*) take the defaults written there. The baseline is commit `9c59097` (eval case authoring, built on `b6c1529`). Every route, table, component and hook those two commits added is used as-is unless a step says otherwise.

**Revision 2026-10-06.** This plan was re-derived against the tree after the sibling `plans/2026-10-05-eval-case-authoring.md` landed as `9c59097`. What changed: the migration number is now `0020`+, agent-facing run reads use `AGENT_SUITE`, the limiter goes through `launch`, this plan's tests are in new files, the client owned-files list is explicit, and the dashboard "oldest 500" read is fixed here (Rec 9).

## Summary
This adds five controls on top of the shipped eval pipeline:
- **Promote vX** in Compare. A new transactional `POST /agents/:id/promote` restores the version-snapshot fields and the run's recorded skill set. It records the result as version current+1, and the new version carries an `origin` in a new nullable `agent_versions.origin` column.
- **Run all agents** on `/eval`. A new `POST /eval/run-all` returns one outcome per agent. A batch-wide limiter, threaded through the single `launch` path, caps the batch at 6 review calls in flight.
- **Time window** and **agent switcher** on `/eval/[agentId]`. Both are kept in the URL. The table reads `GET /agents/:id/eval-runs?since=`, and the trend filters `dashboard.trend` on the client.
- **Evals-tab trend.** The existing recharts `MetricTrendChart` (it already draws gaps) moves to `src/components/eval-metrics/`. It loses its 20-point cap and gains a tooltip.
- **Dashboard read fix.** Both dashboards read the **newest** 500 completed runs, not the oldest.

Server and client share only the step-0 contracts, so the work splits into two disjoint tracks. The seed, the e2e flow and the docs go in the Integration step.

## Requirements review

**What I understood:** The plan extends the shipped eval pipeline with promotion-as-new-version, a cost-confirmed batch run, a URL-backed window and agent switcher, and a trend on the AgentEditor Evals tab. It never rewrites `agent_versions` or `eval_runs`, and every agent-facing run read stays agent-owned (`owner_kind = 'agent'`).
**Inputs read:** specs/2026-10-05-eval-run-controls.md · parent specs/2026-10-05-eval-pipeline.md (AC-6, AC-12, EC-8, EC-11) · sibling plans/2026-10-05-eval-case-authoring.md and commit `9c59097` (`git show --stat`) · request text (revision brief) · AGENTS.md · server/AGENTS.md · client/AGENTS.md · server/src/modules/evals/README.md · INSIGHTS.md (incl. the 2026-10-06 session note) · server/INSIGHTS.md (incl. the 2026-10-06 entries at :324-331) · client/INSIGHTS.md · e2e/INSIGHTS.md · .claude/skills/pr-self-review/routing.md

**Execution mode:** stated by the caller in the original invocation ("planner's choice" → **multi-agent**) and kept in this revision. `server/` and `client/` share only the two contract files, which step 0 writes. Each track stays in one package, so their `typecheck` runs are independent.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "offer "Promote vX" for each run whose recorded configuration differs from the agent's current configuration" | spec §AC-1 | clear |
| R2 | "ask for confirmation … lists each configuration field and each skill-set change" | spec §AC-2 | clear |
| R3 | "set the agent's linked enabled skills and their order to the set recorded on the promoted run, and record the result as a new version (current + 1)" | spec §AC-3 | ambiguous — see Q1 (links outside the run's set) |
| R4 | "existing versions 1 … current shall stay unchanged. The new version's history entry shall state that it was promoted from vX and from which eval run" | spec §AC-4 | ambiguous — see Q4. There is no agent version-history UI, so the "history entry" is the `GET /agents/:id/versions` item |
| R5 | "the modal shall close and a confirmation shall name the new version number. The page shall show that version as the agent's current version" | spec §AC-5 | clear. `/eval/[agentId]` shows no version today ([AgentEvalView.tsx:35-56](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx:35)); step B4 adds one |
| R6 | "WHEN the user activates "Run eval" on an agent's dashboard page … exactly as the parent's "Run all evals" does" | spec §AC-6 | clear |
| R7 | "confirmation that lists each eligible agent (enabled, at least one case) with its case count … total number of paid review calls, and an estimated cost … "—" for agents never run" | spec §AC-7 | ambiguous — see Q2. `EvalAgentCard` has no `enabled` ([eval-ci.ts:237-245](server/src/vendor/shared/contracts/eval-ci.ts:237)) |
| R8 | "try to start one suite run per eligible agent … started, or skipped with a reason (already running, no cases, disabled). A skipped agent shall not stop the others" | spec §AC-8 | clear. "Already running" is the 409 from `launch` ([service.ts:448-451](server/src/modules/evals/service.ts:448)), backed by the `owner_id` unique index ([schema/eval.ts](server/src/db/schema/eval.ts), `eval_runs_one_running_suite_uq`). A skill run hosted on the agent does not block it |
| R9 | "the landing page shall show that agent's card as running until the run completes" | spec §AC-9 | clear. The card has no running flag. The landing page polls only on the 20 newest agent-owned runs ([evals.ts:195](client/src/lib/hooks/evals.ts:195)). Step 0 and A1 add a server-side flag read through `AGENT_SUITE` |
| R10 | "time window of 7 days, 30 days, 90 days or all, defaulting to 30 days … limit the runs table and the trend chart to suite runs completed inside the window" | spec §AC-10 | ambiguous — see Q3 |
| R11 | "metric tiles and the regression banner shall always reflect the agent's latest two suite runs, whatever the selected window" | spec §AC-11 | contradicts tree. The window part is clear, since tiles come from `agentDashboard`, which no window touches. However, the dashboard reads the **oldest** 500 completed runs ([service.ts:744-750](server/src/modules/evals/service.ts:744), [repository.ts:433](server/src/modules/evals/repository.ts:433)). Past 500 runs, the tiles show an old pair, which [evals/README.md:353-355](server/src/modules/evals/README.md:353) records as a known limit. Fixed in A1 (Rec 9) |
| R12 | "agent switcher that lists every agent with at least one case … clear the run selection and keep the selected window" | spec §AC-12 | clear |
| R13 | "WHEN the user reloads the page or navigates Back … restore the selected agent and window from the URL" · verify: e2e | spec §AC-13 | clear. There is no eval seed and no eval e2e flow (`e2e/specs/` ends at `16-pr-brief`), so Integration adds both |
| R14 | "Evals tab shall plot recall, precision and citation accuracy across all of the agent's suite runs … Single-case runs shall be excluded" | spec §AC-14 | contradicts tree. `toChartRows` keeps only the newest 20 ([MetricTrendChart/helpers.ts:4](client/src/app/eval/[agentId]/_components/MetricTrendChart/helpers.ts:4), `:18`), and the dashboard read above returns the oldest 500. Single-case and skill runs are already excluded by `OWNER_SUITE` → `AGENT_SUITE` ([repository.ts:114-126](server/src/modules/evals/repository.ts:114)) |
| R15 | "WHEN the user hovers over or focuses a point … show that run's date, agent version and cost, with "—" for an unknown cost" | spec §AC-15 | clear. `EvalTrendPoint` carries `ran_at`, `agent_version` and `cost_usd` ([eval-ci.ts:269-281](server/src/vendor/shared/contracts/eval-ci.ts:269)) |
| R16 | "IF a compared run's recorded configuration equals the agent's current configuration, THEN its Promote action shall be disabled and labelled as the current configuration" | spec §EC-1 | clear |
| R17 | "IF a skill in the promoted run's set has since been deleted … name the missing skills … promote without them … history entry shall list them as missing" | spec §EC-2 | clear |
| R18 | "IF a skill … has a different skill version now … warn that only the link is restored … name the skill with both versions" | spec §EC-3 | clear |
| R19 | "IF the agent's current version changed after the Compare modal was opened, THEN the promotion shall be rejected with 409. Nothing shall change" | spec §EC-4 | clear |
| R20 | "IF snapshot vX cannot be read, THEN "Promote vX" shall be disabled with a reason, and the metric deltas shall stay visible" | spec §EC-5 | clear. `useAgentVersion` has `retry: false` ([agents.ts:85-92](client/src/lib/hooks/agents.ts:85)). Seeded agents have **no** `agent_versions` row (`server/src/db/seed.ts:268` inserts raw), so on seed data this path shows unless the seed is fixed (Rec 6) |
| R21 | "IF the user confirms the same promotion twice (double submit), THEN the system shall record exactly one new version" | spec §EC-6 | clear |
| R22 | "IF a suite run of the agent is running when a promotion is recorded, THEN that run shall stay recorded against the version it started with" | spec §EC-7 | clear. This is structural: `launch` stamps `agentVersion` at insert ([service.ts:437](server/src/modules/evals/service.ts:437)), and `execute` uses the captured agent (`:464-472`). Only a test is needed |
| R23 | "IF no agent is eligible, THEN "Run all agents" shall be disabled and say why" | spec §EC-8 | clear |
| R24 | "IF every eligible agent already has a running suite run, THEN "Run all agents" shall start no run and report every agent as skipped" | spec §EC-9 | clear |
| R25 | "IF no suite run falls inside the selected window … empty state that offers a wider window. The tiles shall keep showing the latest runs" | spec §EC-10 | clear |
| R26 | "IF the URL names an agent that does not exist in the workspace or has no case, THEN the page shall show the dashboard landing with a notice" | spec §EC-11 | clear |
| R27 | "IF a run's metric is not available … every trend chart shall leave a gap … never plot it as 0" | spec §EC-12 | contradicts tree, in the safe direction. The dashboard chart already uses recharts with `connectNulls={false}` ([MetricTrendChart.tsx:8](client/src/app/eval/[agentId]/_components/MetricTrendChart/MetricTrendChart.tsx:8), `:48`), not the vendored `LineChart`. It is reused, and `vendor/ui` stays untouched |
| R28 | "exactly one review call per case of each started agent and no other model call. Promotion makes no model call" | spec §NFR-1 | clear. The single-shot client is in place ([routes.ts:94](server/src/modules/evals/routes.ts:94)) |
| R29 | "at most 6 review calls are in flight at once. A second "Run all agents" while a batch is still starting is rejected with 409" | spec §NFR-2 | ambiguous — see Q5. The per-run width is 3 ([constants.ts:17](server/src/modules/evals/constants.ts:17)), so without a shared limiter a batch of N agents could reach 3·N calls |
| R30 | "no action in this spec updates or deletes an existing `agent_versions` entry or an eval run" | spec §NFR-3 | clear |
| R31 | "every new string is read from `messages/en/eval.json` (or `agents.json` for agent-version text)" | spec §NFR-4 | clear |
| R32 | "confirmations, the window selector and the agent switcher are operable by keyboard, with accessible names … outcome is stated in text" | spec §NFR-5 | clear |
| R33 | "every contract added or changed here is mirrored in the client copy of `@devdigest/shared` in the same change" | spec §NFR-6 | clear. Enforced by [client/src/test/eval-contract-sync.test.ts](client/src/test/eval-contract-sync.test.ts) (byte equality for `eval-ci.ts` and `knowledge.ts`). Both copies are equal today |
| R34 | "each promotion logs the agent, the from-version, the new version and the source eval run. Each "Run all agents" logs each agent's outcome" | spec §NFR-7 | clear |
| R35 | Promote request: "uuid and positive integers in a strict body … the run belongs to this agent and workspace, and its version exists" → "422 naming the field; 404 … 409 on a version mismatch" | spec §Untrusted inputs | clear. "Belongs to this agent" = `owner_kind = 'agent' AND owner_id = :id`, never `agent_id` alone ([server/INSIGHTS.md:327-331](server/INSIGHTS.md:327)) |
| R36 | Run-all request: "strict object with no fields" → "422" | spec §Untrusted inputs | clear |
| R37 | URL `since`/window and agent id: "one of `7d`, `30d`, `90d`, `all`; … uuid in this workspace" → "Fall back to `30d`; landing with a notice (EC-11)" | spec §Untrusted inputs | clear |

### Recommendations
1. **The trend on the agent page is `dashboard.trend` filtered by `ran_at` on the client. `GET …/eval-runs?since=` serves only the table.** Adopted. Why: `agentDashboard` already returns the completed runs chronologically up to 500 ([service.ts:744-750](server/src/modules/evals/service.ts:744), `:780`). The runs route caps `limit` at 100 ([routes.ts:31](server/src/modules/evals/routes.ts:31)), so a trend built from it would truncate "all". Plan change: A1 adds `since` to the agent runs route only, and B3/B4 use `dashboard.trend`. This departs from the spec's module-interactions row ("Evals tab trend → `GET /agents/:id/eval-runs?since=…`"). The contracts are unchanged.
2. **Reuse and promote the existing recharts `MetricTrendChart` instead of working around the vendored `LineChart`.** Adopted (R27/R14). It moves to `client/src/components/eval-metrics/MetricTrendChart/`, because two features now use it. Plan change: B2.
3. **The batch limiter's slot is acquired before the 120 s case timer starts.** Adopted. Why: `reviewWithTimeout` arms its timer as soon as it is called ([service.ts:650-665](server/src/modules/evals/service.ts:650)). Without this, a case queued behind the 6-slot limiter would be recorded `errored: timeout` without ever making its call. Plan change: A2.
4. **Promotion is one DB transaction: `SELECT … FOR UPDATE` on the agent, a version check, then a plain `agent_versions` insert.** Adopted. Why: `AgentsRepository.update` is not transactional ([agents/repository.ts:126-160](server/src/modules/agents/repository.ts:126)), and `snapshotVersion` swallows a PK conflict with `onConflictDoNothing` (`:180`). Plan change: A4.
5. **Store the origin in a new nullable `agent_versions.origin` jsonb column (one additive generated migration), not inside `config_json`.** Adopted. Why: `config_json` is parsed as `AgentVersionConfig` and is the "configuration" that AC-1 compares ([agents/helpers.ts:35-39](server/src/modules/agents/helpers.ts:35)). The precedent is the separate `skill_versions.note` column ([schema/skills.ts:36](server/src/db/schema/skills.ts:36)). Plan change: A3.
6. **The eval seed also writes the missing `agent_versions` snapshot for the agents it seeds runs for.** Adopted. Why: seeded agents have no version row (`seed.ts:268`), so on a fresh clone Compare always shows "prompt diff unavailable" and Promote is always disabled. This is the [server/INSIGHTS.md:57](server/INSIGHTS.md:57) mistake. Plan change: I1.
7. **`EvalAgentCard` gains `enabled` and `running`, so eligibility (AC-7) and the running card (AC-9) come from the server.** Adopted (R7/R9). Plan change: steps 0, A1, B1, B5.
8. **Reject a no-op promotion on the server too.** Not adopted. EC-1 is a client rule, and a second error code would complicate the EC-4 race.
9. **Fix the dashboards' "oldest 500" read here (new in this revision).** Adopted. Why: `listRuns(..., { limit: 500, order: 'asc' })` sorts ascending, then limits ([repository.ts:433-434](server/src/modules/evals/repository.ts:433)). Past 500 completed runs, the trend, the tiles, the deltas and the banner all describe the **oldest** runs. That breaks AC-11 ("always reflect the latest two"), and it makes AC-14's "all runs" and AC-10's window show stale history. This spec removes the trend's 20-point cap and adds the window, so it is the change that exposes the bug. The gate flagged it on `9c59097` and did not fix it. The fix is one service-private read used by **both** `agentDashboard` and `skillDashboard` (`:744`, `:798`): take the newest `DASHBOARD_RUN_CAP` (500) completed runs (default `desc`) and reverse them. `listRuns` and its `order` option are unchanged, so the three test fakes stay valid. The skill dashboard is sibling code. It is included because it is the same two-line read, and fixing only the agent path would leave the two views on different rules. Plan change: A1, I2 (README "Known limits").
10. **Reuse the existing, unused `eval.dashboard.runEval` ("Run eval ({count})") and `dashboard.running` keys for AC-6 (new in this revision).** Adopted. Why: both keys already exist in [eval.json](client/messages/en/eval.json), and no component reads `runEval` (grep). A new "Run eval" key would duplicate it. Plan change: B4's literal copy.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) · [server/AGENTS.md](server/AGENTS.md) · [client/AGENTS.md](client/AGENTS.md) | contract-once + mirror, `*.it.test.ts`, `.js` imports, verify flags, do-not-touch (migrations, `vendor/ui`) |
| `git show --stat 9c59097` | the sibling touched `evals/{constants,helpers,repository,routes,service,types}.ts`, `schema/eval.ts`, `skills/repository.ts`, migration `0019_absent_king_bedlam`, `eval-ci.ts` (both copies), `hooks/evals.ts`, `eval.json`, the agent `EvalsTab`, new `components/eval-cases/**` and the skill `EvalsTab`. It did not touch `modules/agents/**`, `client/src/app/eval/**`, `components/eval-metrics/**`, `hooks/agents.ts`, the seed or `e2e/` |
| [server/src/modules/evals/repository.ts](server/src/modules/evals/repository.ts) | `AGENT_SUITE` `:114`, `OWNER_SUITE` `:118`. `listRuns(ws, owner: EvalOwner, opts)` `:420-436` (asc-then-limit at `:433`). `failStaleRunning` is workspace-wide (`:411`). `agentsWithCases` (`:479`) has no `enabled`. `getRun` is `AGENT_SUITE` (`:442`) |
| [server/src/modules/evals/service.ts](server/src/modules/evals/service.ts) | `startRun(ws, agentId)` → `launch(spec)` (`:306-332`, `:411-493`) is the one path for suite, single and skill runs. `execute` worker pool `:495-561`. `runCase` → `reviewWithTimeout` `:564-665`. The dashboards are at `:739`, `:793` and `:844` |
| [server/src/modules/evals/types.ts](server/src/modules/evals/types.ts) · [constants.ts](server/src/modules/evals/constants.ts) · [routes.ts](server/src/modules/evals/routes.ts) | `EvalsStore`, `AgentWithCases`, `EvalOwner`. `EVAL_CONCURRENCY = 3` (`:17`). `RunsQuery` (`:31`) is shared by the agent and skill run lists |
| [server/src/db/schema/eval.ts](server/src/db/schema/eval.ts) · [migrations/](server/src/db/migrations) | `eval_runs` has `kind`, `owner_kind`, `owner_id` and `single_case_id`, and the running-suite unique index is on `owner_id`. Latest migration: `0019_absent_king_bedlam.sql` |
| [server/src/modules/agents/repository.ts](server/src/modules/agents/repository.ts) · [helpers.ts](server/src/modules/agents/helpers.ts) · [service.ts](server/src/modules/agents/service.ts) · [routes.ts](server/src/modules/agents/routes.ts) | no restore route. Non-transactional `update`. `snapshotVersion` uses `onConflictDoNothing`. `toAgentVersionDto` `.parse`s `config_json` (`helpers.ts:35-39`). `AgentsService(app.container)` (`routes.ts:85`), and `container.log` exists |
| [server/src/modules/skills/repository.ts:232-253](server/src/modules/skills/repository.ts:232) | the run's skill set = enabled links ∧ `skills.enabled`, in link order |
| [server/src/db/schema/agents.ts:52-63](server/src/db/schema/agents.ts:52) | `agent_versions` PK `(agent_id, version)`, no origin |
| [server/src/vendor/shared/contracts/eval-ci.ts](server/src/vendor/shared/contracts/eval-ci.ts) · [knowledge.ts:514-532](server/src/vendor/shared/contracts/knowledge.ts:514) | `EvalAgentCard`, `EvalTrendPoint`, `EvalDashboard`, `AgentVersionConfig`, `AgentVersion` |
| `server/test/evals-{service,create-case,authoring-service,routes}.test.ts` · `server/test/evals-authoring.it.test.ts` | three `EvalsStore` fakes, all sorting by `started_at` then honouring `order`. The workspace-card test is `evals-create-case.test.ts:506-521`. The sibling's own-file it-test setup is the template for this plan's new it file |
| [client/src/lib/hooks/evals.ts](client/src/lib/hooks/evals.ts) · [agents.ts](client/src/lib/hooks/agents.ts) | keys, `invalidateEvals` (`:55-62`, now including `eval-case-runs` and `skill-eval-dashboard`). `useAgentEvalRuns` (`:146`) has no caller. `useEvalDashboard` polls on `recent_runs` (`:195`) |
| `client/src/app/eval/**`, [EvalsTab.tsx](client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx) | the agent `EvalsTab` now renders `MetricTiles` at `:86`, and the start/409 handling is at `:40-45` and `:62-71`. `AgentEvalView.test.tsx:10` mocks `../MetricTrendChart` by relative path. `EvalRunsTable` gets `runs` as a prop |
| [client/messages/en/eval.json](client/messages/en/eval.json) | namespaces `dashboard`, `caseEditor`, `evalsTab`, `page`, `metrics`, `agentPage`, `compare`. `dashboard.runEval` and `dashboard.running` exist |
| [e2e/README.md](e2e/README.md) · [e2e/INSIGHTS.md:129-134](e2e/INSIGHTS.md:129) · [server/src/db/seed-brief.ts](server/src/db/seed-brief.ts) | flows run on read-only seeded data. A feature seed is a `seed-<x>.ts` called from `seed.ts`. Late flows are sensitive to the rate limit (`RATE_LIMIT_MAX` is set by `scripts/e2e.sh`) |

## Insights that bind this work
1. **Agent-facing run reads go through `AGENT_SUITE`, never `agent_id` alone** ([server/INSIGHTS.md:327-331](server/INSIGHTS.md:327)). A skill eval run stores its host's id in `eval_runs.agent_id`. So in this plan:
   - the `running` card flag, `?since=`, the trend, Compare, "Run all agents" and the landing-page poll all read through `listRuns(ws, { kind: 'agent', id })` → `OWNER_SUITE` → `AGENT_SUITE`;
   - Promote's run lookup in `agents/repository.ts` writes the same predicate inline (`workspace_id`, `kind = 'suite'`, `owner_kind = 'agent'`, `owner_id = :id`), because `AGENT_SUITE` is module-private and `agents` may not import `modules/evals`;
   - a new it-test pins that a skill run hosted on agent H leaks into none of these.
2. **A table with a companion history must get its history on every write path** ([server/INSIGHTS.md:57](server/INSIGHTS.md:57)). The promotion writes the agent row, the links and the `agent_versions` row in one transaction inside `AgentsRepository`. The eval seed writes the missing v1 snapshot (Rec 6).
3. **`pnpm typecheck` never sees `server/test/**`** ([server/INSIGHTS.md:139](server/INSIGHTS.md:139)). The port changes here are both additive (`since?` in `listRuns` opts, `enabled` on `AgentWithCases`), and no existing fake needs them to keep its tests green. This plan's hermetic tests use their **own** minimal fake in a new file. The implementer still greps `server/test/` for `agentsWithCases` / `listRuns(` fakes and confirms each still passes.

Also checked against *What Doesn't Work*:
- `drizzle-kit` hangs when one table both gains and loses a column ([server/INSIGHTS.md:345](server/INSIGHTS.md:345)). A3 only **adds** a column.
- `pnpm exec` / `pnpm run` in a worktree whose `node_modules` is a junction re-points the main tree's links ([INSIGHTS.md:213-222](INSIGHTS.md:213); repeated a third time on 2026-10-06, [INSIGHTS.md:902-907](INSIGHTS.md:902)). Run `pnpm db:generate` and every verify in the main checkout, never in such a worktree.
- A green `--it` with Docker down is a skip ([server/INSIGHTS.md:143](server/INSIGHTS.md:143)). A5 and I2 run `docker info` first.
- "Fails alone" is not proof of a regression ([server/INSIGHTS.md:436-442](server/INSIGHTS.md:436)). If an unrelated it-test (e.g. `conventions.it.test.ts`) goes red in I2, re-run it on a clean HEAD before blaming this change.
- Moving a module ⇒ `typecheck` is the gate, not `test` ([client/INSIGHTS.md:42](client/INSIGHTS.md:42)). B2 verifies with `--checks`.
- New modals need `body: { padding: 24 }` ([client/INSIGHTS.md:48](client/INSIGHTS.md:48)).

## Constraints
- **Onion rings (server):** `routes.ts` is the HTTP edge, with declarative zod `params`/`querystring`/`body`/`response` and no `.parse()` in a handler. `service.ts`, `helpers.ts`, `types.ts` and `constants.ts` are ring 2: no drizzle or fastify import. `repository.ts` is ring 3. `server/src/db/seed-eval.ts` is ring 3 (`db/**`).
- **No cross-module import:** `modules/agents/**` must not import `modules/evals/**`, and vice versa. Promote reads `t.evalRuns` through the schema inside `agents/repository.ts` (precedent: `deleteById` touching `t.evalCases`, `agents/repository.ts:79-96`).
- **Agent-owned reads only (Insight 1):** no new query in this plan filters runs on `agent_id` alone.
- **`launch` is the single execution path.** The limiter is an optional field of the `launch` spec, carried through to `execute` and `runCase`. `startCaseRun` and `startSkillRun` never pass one, so their behaviour is unchanged.
- **Contract once + mirror:** every edit to `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts` is copied byte for byte to `client/src/vendor/shared/contracts/` in the same step.
- **`.js` on relative imports** in every new or edited `server/` file.
- **`*.it.test.ts`** for any test touching Postgres: `agents-promote.it.test.ts`, `evals-run-controls.it.test.ts`, `seed-eval.it.test.ts`. Hermetic tests must not import `db/client`.
- **Migrations:** generate with `cd server && pnpm db:generate` (main checkout). Never hand-write or rename one. Never edit `0000`–`0019`. This plan's migration is `0020_<generated>` unless another migration lands first; then it takes the next free number.
- **Unknown cost is "—", never 0** ([INSIGHTS.md:287](INSIGHTS.md:287)): in the run-all estimate, the tooltip and the outcome list.
- **Do not touch:** `client/src/vendor/ui/**`, `reviewer-core/**`, applied migrations, lock-files, and the sibling's `client/src/components/eval-cases/**` and `client/src/app/skills/**`. No new dependency is needed (`recharts@^2.15.0` is in `client/package.json:22`).
- **Client:** no `fetch` in components; hooks go in `src/lib/hooks/*` over `src/lib/api.ts`. Every user-facing string comes from `messages/en/eval.json` (or `agents.json`). Each new `_components/<Name>/<Name>.tsx` ships `<Name>.test.tsx`. `src/components/**` must not import `src/app/**`. A component test that mocks `@/lib/hooks/evals` with an explicit factory must add every new hook the component calls.
- **POST bodies are `z.object({}).strict()`** (`EmptyBody`, [routes.ts:30](server/src/modules/evals/routes.ts:30)). The client always sends `{}`.
- **Sibling state (built, `9c59097`).** `AGENT_SUITE`/`OWNER_SUITE`, `launch`, the `owner_id` running index, the workspace-wide sweep and `listRuns(ws, EvalOwner, …)` are existing code. Do not rename or restructure them; extend them only where a step says so.

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/**` (+ client mirror) | `zod` | wire contracts (`typescript-expert` is review-time only) |
| `server/src/db/schema/agents.ts` (+ generated migration) | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design` | schema column + generate flow |
| `server/src/modules/{agents,evals}/routes.ts` | `onion-architecture`, `fastify-best-practices` | ring edge + HTTP surface (`security` is the gate's) |
| `server/src/modules/{agents,evals}/repository.ts`, `server/src/db/seed*.ts` | `onion-architecture`, `drizzle-orm-patterns` | ring 3, transactions, `FOR UPDATE` |
| `server/src/modules/{agents,evals}/{service,helpers,types,constants}.ts` | `onion-architecture` | ring 2 |
| `client/src/app/**`, `client/src/components/**`, `client/src/lib/hooks/**` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | placement/promotion, components, `next/navigation` + `'use client'` |
| `client/**/*.test.tsx?` | `react-testing-library` | component/hook tests |
| `server/test/**`, `e2e/specs/**`, `client/messages/**`, READMEs | none | convention-only group |

Derived from the write-time row of [.claude/skills/pr-self-review/routing.md](.claude/skills/pr-self-review/routing.md). Each implementer loads each skill once, at the first step that needs it.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/knowledge.ts`, `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `server/test/contracts.test.ts` | 0 | `--file` on the two contract tests | — |
| A — server | `server/src/modules/agents/**`; `server/src/modules/evals/{constants,helpers,types,repository,service,routes}.ts`; `server/src/db/schema/agents.ts`; `server/src/db/migrations/0020_*.sql`, `server/src/db/migrations/meta/0020_snapshot.json`, `server/src/db/migrations/meta/_journal.json` (all generated); `server/test/agents-promote.test.ts`, `server/test/agents-promote.it.test.ts`, `server/test/evals-run-controls.test.ts`, `server/test/evals-run-controls.it.test.ts` (all new); `server/test/evals-routes.test.ts` (rows only) | A1–A5 | `node scripts/verify.mjs server --checks` · `--file …` | step 0 |
| B — client | `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/evals.test.tsx`, `client/src/lib/hooks/agents.ts`, `client/src/lib/hooks/agents.test.tsx` (new); `client/src/components/eval-metrics/index.ts`, `client/src/components/eval-metrics/MetricTrendChart/**` (new); `client/src/app/eval/**`; `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`, `…/EvalsTab/EvalsTab.test.tsx`; `client/messages/en/eval.json`, `client/messages/en/agents.json` | B1–B6 | `node scripts/verify.mjs client --checks` · `--file …` | step 0 |
| shared — integration | `server/src/db/seed.ts`, `server/src/db/seed-eval.ts` (new), `server/test/seed-eval.it.test.ts` (new), `e2e/specs/17-eval-run-controls.flow.json` (new), `e2e/README.md`, `server/src/modules/evals/README.md`, `server/README.md`, `client/README.md` | I1–I2 | the one full run | A, B |

No path appears in two rows. Each track is one `implementer` invocation. Track A does not edit the sibling's `evals-service.test.ts`, `evals-create-case.test.ts`, `evals-authoring-*.test.ts` or `evals.it.test.ts`. Track B does not edit `client/src/components/eval-cases/**` or `client/src/app/skills/**`.

## Steps

### 0. Contracts: promotion, origin, run-all outcome, card flags (both copies)
- **Files:** [`server/src/vendor/shared/contracts/knowledge.ts`](server/src/vendor/shared/contracts/knowledge.ts) (edit) · [`server/src/vendor/shared/contracts/eval-ci.ts`](server/src/vendor/shared/contracts/eval-ci.ts) (edit) · [`client/src/vendor/shared/contracts/knowledge.ts`](client/src/vendor/shared/contracts/knowledge.ts) (edit, byte copy) · [`client/src/vendor/shared/contracts/eval-ci.ts`](client/src/vendor/shared/contracts/eval-ci.ts) (edit, byte copy) · [`server/test/contracts.test.ts`](server/test/contracts.test.ts) (edit)
- **Track:** shared
- **Layer:** innermost ring (contracts). Pure zod; no new imports.
- **Skills:** `zod`
- **Do:**
  - In `knowledge.ts` (after `AgentVersion`, `:526-532`):
    - add `AgentPromoteInput`, a strict object of `from_version` (int > 0), `eval_run_id` (uuid) and `expected_version` (int > 0);
    - add `AgentVersionOrigin`, illustratively `{ kind: 'promotion', from_version, eval_run_id, missing_skills: { skill_id, name }[] }`;
    - extend `AgentVersion` with `origin: AgentVersionOrigin.nullish()`. Use `.nullish()`, so older payloads and existing fixtures stay valid.
  - In `eval-ci.ts`:
    - extend `EvalAgentCard` (`:237-245`) with `enabled: z.boolean()` and `running: z.boolean()`;
    - add `EvalRunAllOutcome` = `{ agent_id, agent_name, status: 'started' | 'skipped', reason: 'already_running' | 'no_cases' | 'disabled' | null, run_id: string | null }`;
    - add `EvalRunAllResult` = `{ outcomes: EvalRunAllOutcome[] }`.
  - Copy both files to the client, byte for byte.
  - Add parse cases to `server/test/contracts.test.ts`:
    - `AgentPromoteInput` rejects an extra key, `from_version: 0` and a non-uuid run id, and accepts the boundary `from_version: 1`;
    - `AgentVersion` parses both with and without `origin`.
- **Done when:** both copies are byte-identical and the new contract tests pass.
  - **Known red window:** `server` and `client` `typecheck` are red after this step, because the `EvalAgentCard` producers and fixtures lack the two new fields. A1 (server) and B1 (client) turn them green. Do not weaken the fields to `.optional()` to avoid it.
- **Verify:** `node scripts/verify.mjs server --file server/test/contracts.test.ts` · `node scripts/verify.mjs client --file client/src/test/eval-contract-sync.test.ts`

### A1. Cards carry `enabled` and `running`; the agent runs list takes `since`; dashboards read the newest 500
- **Files:** [`server/src/modules/evals/types.ts`](server/src/modules/evals/types.ts) (edit) · [`repository.ts`](server/src/modules/evals/repository.ts) (edit) · [`service.ts`](server/src/modules/evals/service.ts) (edit) · [`constants.ts`](server/src/modules/evals/constants.ts) (edit) · [`routes.ts`](server/src/modules/evals/routes.ts) (edit) · `server/test/evals-run-controls.test.ts` (new) · [`server/test/evals-routes.test.ts`](server/test/evals-routes.test.ts) (edit, rows only)
- **Track:** A
- **Layer:** types/service/constants ring 2 · repository ring 3 · routes edge
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices`
- **Do:**
  - **Cards:**
    - `AgentWithCases` gains `enabled: boolean`. `agentsWithCases` (`repository.ts:479`) selects `t.agents.enabled` and adds it to `groupBy`.
    - `workspaceDashboard` (`service.ts:844`) fills each card's `enabled` from that field, and its `running` from `(await repo.listRuns(ws, { kind: 'agent', id }, { limit: 1, statuses: ['running'] })).length > 0`. That read goes through `OWNER_SUITE` → `AGENT_SUITE`, so a skill run hosted on the agent never sets it (Insight 1). It runs after the existing sweep, and the port gets no new method.
  - **`since`:**
    - `listRuns` opts gain `since?: Date`, applied as `gte(t.evalRuns.ranAt, since)` (start time, Q3) and added to the `EvalsStore` signature in `types.ts`.
    - `EvalsService.listRuns(ws, agentId, limit, since?)` passes it through. `listSkillRuns` is unchanged.
    - In `routes.ts`, add `AgentRunsQuery = RunsQuery.extend({ since: z.string().datetime().optional() })` and use it only on `GET /agents/:id/eval-runs` (`:255-262`). Pass `new Date(req.query.since)` when present. The skill run list keeps `RunsQuery`. `limit` keeps its default of 20 and its max of 100.
  - **Dashboard read (Rec 9):**
    - add `DASHBOARD_RUN_CAP = 500` to `constants.ts`;
    - add a private `completedChronological(ws, owner)` in `service.ts` that returns `(await repo.listRuns(ws, owner, { limit: DASHBOARD_RUN_CAP, statuses: ['completed', 'partial'] })).reverse()`;
    - use it in both `agentDashboard` (`:744-748`) and `skillDashboard` (`:798-802`), replacing their `order: 'asc'` reads. Nothing else in either method changes.
  - **Test file:** `server/test/evals-run-controls.test.ts` (new) builds `EvalsService` over its **own** minimal in-memory store that implements only what these paths call. Cast it as `EvalsStore`; tests are not typechecked. Its `listRuns` honours `owner.kind`, `owner.id`, `statuses`, `since`, `order` and `limit` like the real query: sort by `started_at`, then `order`, then `limit`. A2 extends the same file.
- **Done when:** `evals-run-controls.test.ts` pins the following.
  - **Cards:** a disabled agent's card has `enabled: false`. An agent with a `running` agent-owned suite run has `running: true`. An agent whose only running run is a skill-owned run hosted on it (`owner_kind: 'skill'`, `agent_id` = the agent) has `running: false`.
  - **`since` pass-through:** `service.listRuns(WS, AGENT, 20, since)` forwards `since` to the store.
  - **Dashboard cap boundaries:**
    - exactly 500 completed runs → `trend.length === 500` and `trend[0]` is the oldest;
    - 501 completed runs → `trend.length === 500`, `trend[0]` is the **second** oldest, `trend.at(-1)` and `current` are the newest, and `delta` compares the two newest.
  - `evals-routes.test.ts` gains the rows `list-runs: since is not a datetime` (`?since=yesterday`) → 422 and `list-runs: since without a time zone` (`?since=2026-10-01T00:00:00`) → 422. The second is a near-miss: `z.string().datetime()` requires a zone by default.
  - `server` `typecheck` is green again.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-run-controls.test.ts --file server/test/evals-routes.test.ts` then `node scripts/verify.mjs server --checks`

### A2. `POST /eval/run-all` with a batch-wide limiter threaded through `launch`
- **Files:** [`server/src/modules/evals/constants.ts`](server/src/modules/evals/constants.ts) (edit) · [`helpers.ts`](server/src/modules/evals/helpers.ts) (edit) · [`service.ts`](server/src/modules/evals/service.ts) (edit) · [`routes.ts`](server/src/modules/evals/routes.ts) (edit) · `server/test/evals-run-controls.test.ts` (edit, from A1) · [`server/test/evals-routes.test.ts`](server/test/evals-routes.test.ts) (edit, rows only)
- **Track:** A
- **Layer:** constants/helpers/service ring 2 · routes edge
- **Skills:** (already loaded)
- **Do:**
  - `constants.ts`: add `RUN_ALL_CONCURRENCY = 6`.
  - `helpers.ts`: add a pure counting limiter, `createLimiter(n)` → `{ run<T>(fn: () => Promise<T>): Promise<T> }`. It has no timers and releases its slot on resolve and on reject.
  - **Threading:**
    - `startRun(workspaceId, agentId, opts?: { limiter?: Limiter })` passes `opts.limiter` into its `launch({...})` call (`service.ts:319-331`);
    - the `launch` spec gains `limiter?: Limiter` and puts it on the `execute` ctx, and `execute` passes it to `runCase`;
    - in `runCase`, the review call becomes `limiter ? limiter.run(() => this.reviewWithTimeout(input)) : this.reviewWithTimeout(input)`. The 120 s timer is armed only once the slot is held (Rec 3). Read the case's `started` timestamp after the slot is acquired, so `duration_ms` excludes the queue wait;
    - the per-run worker width (`EVAL_CONCURRENCY = 3`) is unchanged. `startCaseRun` and `startSkillRun` pass no limiter.
  - **`runAll(workspaceId)`:**
    - while the in-process `runAllStarting` flag is set, throw `AppError('eval_run_all_in_progress', 'A run of all agents is still starting', 409)` (Q5);
    - otherwise set the flag, create one `createLimiter(RUN_ALL_CONCURRENCY)`, and iterate `repo.agentsWithCases(ws)` (agent-owned cases only):
      - a disabled agent → `skipped`/`disabled`;
      - every other agent → `startRun(ws, id, { limiter })`. `AppError` `eval_run_in_progress` (409) → `skipped`/`already_running`, and `eval_set_empty` (422) → `skipped`/`no_cases`. Any other error propagates;
    - clear the flag in `finally`.
    - Log `eval run-all outcome` once per agent with `{ agentId, status, reason, runId }` through `deps.log.info` (NFR-7).
  - **Route:** `app.post('/eval/run-all', { schema: { body: EmptyBody, response: { 200: EvalRunAllResult } } }, …)`, with a line added to the route doc comment (`routes.ts:35-71`).
- **Done when:**
  - In `evals-run-controls.test.ts`, the limiter never exceeds n = 6 with 10 queued tasks, and it releases after a rejection.
  - On the file's fake store with a deferred fake `review`:
    - (a) three eligible agents with 4 cases each never put more than 6 review calls in flight, and no single run puts more than 3 (NFR-2);
    - (b) a case queued for a slot longer than `caseTimeoutMs` (set to e.g. 50 ms in the test) is **not** recorded as `errored: timeout`;
    - (c) outcomes are `started` / `skipped:disabled` / `skipped:already_running` in one batch, and a skipped agent does not stop the next one (AC-8);
    - (d) every agent already running → every outcome is skipped and no run row is inserted (EC-9);
    - (e) a second `runAll` while the first is inside its start loop → 409 `eval_run_all_in_progress`, and once the first returns, a third call is accepted;
    - (f) exactly one `review` call per case of each started agent (NFR-1);
    - (g) a single-case run started during the batch is not throttled by the batch limiter.
  - `evals-routes.test.ts` gains the row `run-all: extra body key` → 422.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-run-controls.test.ts --file server/test/evals-routes.test.ts`

### A3. `agent_versions.origin` column (generated migration `0020`)
- **Files:** [`server/src/db/schema/agents.ts`](server/src/db/schema/agents.ts) (edit) · `server/src/db/migrations/0020_<generated>.sql` (new, generated) · `server/src/db/migrations/meta/0020_snapshot.json` (new, generated) · [`server/src/db/migrations/meta/_journal.json`](server/src/db/migrations/meta/_journal.json) (edit, generated). The latest migration is `0019_absent_king_bedlam`; this one is `0020` unless another lands first.
- **Track:** A
- **Layer:** ring 3 (db schema)
- **Skills:** `postgresql-table-design` (plus the ones already loaded)
- **Do:**
  - Add `origin: jsonb('origin')` (nullable, no default) to `agentVersions` (`:52-63`).
  - Run `cd server && pnpm db:generate` in the main checkout. The change is additive only, so no prompt fires.
  - Do not edit the generated SQL.
- **Done when:**
  - the new SQL is a single `ALTER TABLE "agent_versions" ADD COLUMN "origin" jsonb;`;
  - `_journal.json` has the new entry after `0019`;
  - `git status` shows only the two new files plus the journal under `migrations/`, and `0000`–`0019` are unchanged.
- **Verify:** `node scripts/verify.mjs server --checks`

### A4. `POST /agents/:id/promote`: transactional restore as a new version
- **Files:** [`server/src/modules/agents/repository.ts`](server/src/modules/agents/repository.ts) (edit) · [`helpers.ts`](server/src/modules/agents/helpers.ts) (edit) · [`service.ts`](server/src/modules/agents/service.ts) (edit) · [`routes.ts`](server/src/modules/agents/routes.ts) (edit) · `server/test/agents-promote.test.ts` (new, hermetic)
- **Track:** A
- **Layer:** helpers/service ring 2 · repository ring 3 · routes edge
- **Skills:** (already loaded)
- **Do:**
  - **helpers.ts:**
    - add a pure `planSkillLinks(runSkills, existingSkillIds, currentLinks)` that returns the new ordered link list and `missing`:
      - the run's skills that still exist go first, enabled, in run order, at `order` 0…k-1;
      - every other currently linked skill is kept but **disabled**, after them, in its prior relative order (Q1);
      - the run's skills that no longer exist become `missing` `{ skill_id, name }`, with the name taken from the run record;
    - `toAgentVersionDto` (`:35-39`) maps `row.origin` through `AgentVersionOrigin.safeParse`, giving `null` when it is absent or malformed.
  - **repository.ts:** add `promote(workspaceId, agentId, input)` in **one** `db.transaction`:
    1. `select … for update` the agent, scoped by workspace. None → `not_found`.
    2. Read the run header from `t.evalRuns` where `workspace_id = ws`, `id = input.eval_run_id`, `kind = 'suite'`, `owner_kind = 'agent'` and `owner_id = agentId`. None → `not_found`. Never match on `agent_id` alone: a skill run hosted on this agent has `agent_id = agentId`, but its skill set is `[skill]` (Insight 1).
    3. If `run.agentVersion !== input.from_version` → `invalid('from_version')`.
    4. Read `agent_versions(agentId, from_version)`. None → `not_found`. If `AgentVersionConfig.safeParse` fails → `unreadable`.
    5. If `agent.version !== input.expected_version` → `conflict`. Nothing has been written yet.
    6. Look up which run skill ids still exist in `t.skills` for this workspace, apply `planSkillLinks`, then delete and re-insert `agent_skills` for this agent.
    7. Update the agent's provider, model, system_prompt, output_schema, strategy, ci_fail_on and repo_intel from the snapshot, with `version = current + 1`. Name, description and enabled stay untouched (spec Q-1).
    8. **Plain insert** into `agent_versions`: `config_json` is built from the updated row plus the new linked ids (all links, as `snapshotVersion` does), and `origin = { kind: 'promotion', from_version, eval_run_id, missing_skills }`. A PK conflict throws and rolls back (Rec 4).
    - It never updates or deletes an existing `agent_versions` or `eval_runs` row (NFR-3). It returns a typed result union, not an HTTP error.
  - **service.ts:** `promote()` maps the union:
    - `not_found` → `NotFoundError`;
    - `invalid` → `AppError('promotion_invalid', …, 422, { field })`;
    - `unreadable` → `AppError('agent_version_unreadable', …, 422, { version })`;
    - `conflict` → `AppError('agent_version_conflict', …, 409, { current_version })`.
    - On success it logs `agent promoted` with `{ agentId, fromVersion, newVersion, evalRunId, missingSkills }` via `container.log.info` (NFR-7), and returns the `Agent` DTO.
  - **routes.ts:** `app.post('/agents/:id/promote', { schema: { params: IdParams, body: AgentPromoteInput, response: { 200: Agent } } }, …)`, with a line added to the doc comment (`:30-43`). No model call (NFR-1).
- **Done when:** `agents-promote.test.ts` covers the following.
  - `planSkillLinks` boundaries:
    - an empty run set → every current link becomes disabled;
    - a run set equal to the current set → order unchanged;
    - one deleted skill → in `missing`, absent from the links;
    - a currently linked skill not in the run → kept, disabled, after the run's skills;
    - a run order different from the current one → the run order wins.
  - `toAgentVersionDto` with `origin` absent, valid and malformed (→ `null`).
  - The hermetic route table (the `evals-routes.test.ts` pattern):
    - non-uuid `:id` → 422;
    - extra body key → 422;
    - `from_version: 0` → 422;
    - `expected_version: -1` → 422;
    - non-uuid `eval_run_id` → 422.
- **Verify:** `node scripts/verify.mjs server --file server/test/agents-promote.test.ts` then `node scripts/verify.mjs server --checks`

### A5. Integration tests for promotion, run-all, `since`, the dashboard read and agent-owned isolation (Postgres)
- **Files:** `server/test/agents-promote.it.test.ts` (new) · `server/test/evals-run-controls.it.test.ts` (new)
- **Track:** A
- **Layer:** tests (`*.it.test.ts`, Docker-gated)
- **Skills:** none (convention-only)
- **Do:**
  - Run `docker info` first. If Docker is down, report it; a skip is not a pass.
  - Model both files on [`server/test/evals-authoring.it.test.ts`](server/test/evals-authoring.it.test.ts) (setup `:1-60`): `startPg`, `seed`, `buildApp` with a stubbed `MockLLMProvider` that can be held behind a gate.
  - Insert rows directly where no route creates them: completed runs at fixed `ran_at`, skill-owned runs.
- **Done when:**
  - `agents-promote.it.test.ts`:
    - **AC-3:** after promoting v1 from a run, the agent's fields equal snapshot v1, the enabled links equal the run's skills in order, and `version` = previous + 1;
    - **AC-4 / NFR-3:** every pre-existing `agent_versions` row is byte-equal before and after, the new row's `origin` names `from_version` and `eval_run_id`, and the `eval_runs` row is unchanged;
    - **EC-2:** delete one skill, then promote → the link is absent and `origin.missing_skills` names it;
    - **EC-4:** a stale `expected_version` → 409 `agent_version_conflict`, and the agent row, links and versions are unchanged;
    - **EC-6:** two concurrent identical promotes (`Promise.all`) → exactly one 200, one 409, and one new version;
    - **EC-7:** start a run with the gated LLM, promote, release → the run's `agent_version` is the pre-promotion version;
    - a run of another agent or of another workspace → 404;
    - a **skill-owned run hosted on this agent** (`owner_kind: 'skill'`, `agent_id` = this agent) → 404;
    - `from_version` ≠ the run's version → 422 `promotion_invalid`;
    - **NFR-1:** the stub LLM's call count is unchanged by a promotion;
    - **NFR-7:** a log spy sees `agent promoted` with the four fields.
  - `evals-run-controls.it.test.ts`:
    - **AC-8:** run-all over one enabled agent, one disabled agent and one already-running agent → `started` / `skipped:disabled` / `skipped:already_running`;
    - **EC-9:** all running → no new `eval_runs` row;
    - a skill suite running on host H does **not** make H `already_running` in run-all, and does **not** set H's card `running`;
    - `GET /agents/:id/eval-runs?since=<a run's exact started_at>` includes that run, and `since` = that time + 1 ms excludes it;
    - a completed skill-owned run hosted on agent H appears in none of H's `?since=` list, H's dashboard `trend`, or H's Compare (422 `eval_compare_invalid`);
    - `GET /eval/dashboard` cards carry `enabled` and `running`;
    - **Rec 9:** with 501 completed agent-owned runs inserted in one batch, `GET /agents/:id/eval-dashboard` has `trend.length === 500`, and its last point and `current` are the newest run. The same holds for `GET /skills/:id/eval-dashboard` with 501 skill-owned runs.
- **Verify:** `docker info` then `node scripts/verify.mjs server --it --file server/test/agents-promote.it.test.ts --file server/test/evals-run-controls.it.test.ts`

### B1. Hooks: run-all, promote, windowed runs; fixtures for the new card fields
- **Files:** [`client/src/lib/hooks/evals.ts`](client/src/lib/hooks/evals.ts) (edit) · [`client/src/lib/hooks/agents.ts`](client/src/lib/hooks/agents.ts) (edit) · [`client/src/lib/hooks/evals.test.tsx`](client/src/lib/hooks/evals.test.tsx) (edit) · `client/src/lib/hooks/agents.test.tsx` (new) · [`client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx`](client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx) (edit, fixtures at `:77-80`)
- **Track:** B
- **Layer:** `src/lib/hooks` over `src/lib/api.ts`
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **Do:**
  - `useAgentEvalRuns(agentId, opts?: { since?: string })` (`:146`, no current caller):
    - the key becomes `["eval-runs", agentId, since ?? "all"]`, still under the `["eval-runs"]` prefix that `invalidateEvals` clears;
    - the URL is `/agents/${id}/eval-runs?since=${encodeURIComponent(since)}` when `since` is set;
    - polling is unchanged.
  - `useRunAllAgents()`: `api.post<EvalRunAllResult>("/eval/run-all", {})`, calling `invalidateEvals(qc)` on settle (success and error).
  - `useEvalDashboard` (`:191-197`): poll while `data.agents.some(a => a.running) || data.recent_runs.some(r => r.status === "running")` (AC-9).
  - `usePromoteAgent(agentId)` in `agents.ts`:
    - posts `AgentPromoteInput` to `/agents/${agentId}/promote`;
    - on success, invalidates `["agents"]`, `["agent", agentId]`, `["agent-version", agentId]`, `["agent-skills", agentId]`, `["eval-dashboard"]` and `["agent-eval-dashboard"]`. The card's provider and model come from the agent row.
    - It does not import `invalidateEvals` (module-private). The sibling hooks are unchanged.
  - Add `enabled: true, running: false` to every `EvalAgentCard` fixture.
- **Done when:**
  - hook tests pin:
    - the run-all POST body `{}`;
    - the `since` query string (and that it is absent for `all`);
    - the dashboard polling while one card is `running` and every recent run is `completed`;
    - the promote invalidations;
  - `client` `typecheck` is green again.
- **Verify:** `node scripts/verify.mjs client --file client/src/lib/hooks/evals.test.tsx --file client/src/lib/hooks/agents.test.tsx` then `node scripts/verify.mjs client --checks`

### B2. Promote `MetricTrendChart` to `components/eval-metrics`: all points, gaps, tooltip
- **Files:**
  - `client/src/app/eval/[agentId]/_components/MetricTrendChart/**` (5 files, deleted) → `client/src/components/eval-metrics/MetricTrendChart/MetricTrendChart.tsx`, `MetricTrendChart.test.tsx`, `helpers.ts`, `helpers.test.ts`, `index.ts` (new at the destination);
  - `client/src/components/eval-metrics/MetricTrendChart/TrendTooltip.tsx` (new; a private sub-part, tested through `MetricTrendChart.test.tsx`);
  - [`client/src/components/eval-metrics/index.ts`](client/src/components/eval-metrics/index.ts) (edit: export `MetricTrendChart`);
  - [`AgentEvalView.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx) and [`AgentEvalView.test.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx) (edit: the import becomes `@/components/eval-metrics`, and the `vi.mock("../MetricTrendChart")` at `:10` becomes a partial mock of `@/components/eval-metrics`);
  - [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit).
- **Track:** B
- **Layer:** shared component (`src/components`), now with two feature consumers
- **Skills:** (already loaded)
- **Do:**
  - Remove `TREND_MAX_POINTS` and the slice (`helpers.ts:4`, `:18`). The caller decides the range: the window on the agent page, all runs on the Evals tab.
  - `TrendRow` also carries `ran_at`, `agent_version` and `cost_usd`.
  - Add a recharts `<Tooltip content={<TrendTooltip/>}>` that shows the date (`formatRunDate`), "v{version}" (reuse `dashboard.table.versionValue`) and the cost (`formatCost`, "—" when null).
  - Set `accessibilityLayer` on `LineChart`, so the points are keyboard-focusable and focus shows the same tooltip (AC-15, NFR-5).
  - Keep `connectNulls={false}` (EC-12).
  - **Mock pattern for consumers:** keep `MetricTiles` real and stub only the chart, using the partial-mock form already used at `client/src/lib/hooks/evals.test.tsx:17`. Illustration: `vi.mock("@/components/eval-metrics", async (orig) => ({ ...(await orig<typeof import("@/components/eval-metrics")>()), MetricTrendChart: (p: { trend: unknown[] }) => <div data-testid="trend" data-count={p.trend.length} /> }))`.
  - **Literal copy (add to `eval.json`):** the tooltip's cost label "Cost" (or reuse `dashboard.table.cost`) and the date label "Ran at" (reuse `dashboard.table.ranAt`). Add no key that an existing one already covers.
- **Done when:**
  - `helpers.test.ts` covers:
    - 25 points in → 25 rows out (no cap; 20 was the old boundary, so test 20 and 21 as well);
    - a `null` recall stays `null`, not 0;
    - each row carries the run's version and cost.
  - `MetricTrendChart.test.tsx` renders `TrendTooltip` directly with a payload and asserts the date, "v3", and "—" for a null cost.
  - Nothing remains under `src/app/eval/[agentId]/_components/MetricTrendChart`.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/eval-metrics/MetricTrendChart/helpers.test.ts --file client/src/components/eval-metrics/MetricTrendChart/MetricTrendChart.test.tsx --file "client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx"` then `node scripts/verify.mjs client --checks` (a move ⇒ typecheck is the gate)

### B3. Evals-tab trend (AC-14, AC-15, EC-12)
- **Files:** [`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`](client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx) (edit) · [`EvalsTab.test.tsx`](client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx) (edit)
- **Track:** B
- **Layer:** feature component
- **Skills:** (already loaded)
- **Do:**
  - Directly after `<MetricTiles dashboard={dashboard} />` (`:86`), render a section titled with the existing key `dashboard.metricTrend` ("Metric trend") containing `<MetricTrendChart trend={dashboard?.trend ?? []} />`. That is every completed agent-owned suite run (newest ≤ 500, chronological; single-case and skill runs are excluded by `AGENT_SUITE`).
  - Do not change the case list, the editor wiring or the run buttons the sibling added.
- **Done when:** with the chart stubbed through the partial mock (B2), the test asserts the chart receives all N points of a fixture with N = 25, in `ran_at` order. The sibling's existing `EvalsTab.test.tsx` cases still pass.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx"`

### B4. Agent page: window, switcher, Run eval, current version, URL state, EC-10/EC-11
- **Files:**
  - [`client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx) (edit) · [`AgentEvalView.test.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx) (edit) · [`styles.ts`](client/src/app/eval/[agentId]/_components/AgentEvalView/styles.ts) (edit)
  - `client/src/app/eval/[agentId]/_components/AgentEvalView/helpers.ts` + `helpers.test.ts` (new)
  - `client/src/app/eval/[agentId]/_components/WindowSelect/WindowSelect.tsx` + `WindowSelect.test.tsx` + `index.ts` (new)
  - `client/src/app/eval/[agentId]/_components/AgentSwitcher/AgentSwitcher.tsx` + `AgentSwitcher.test.tsx` + `index.ts` (new)
  - [`EvalRunsTable.tsx`](client/src/app/eval/[agentId]/_components/EvalRunsTable/EvalRunsTable.tsx) + [`EvalRunsTable.test.tsx`](client/src/app/eval/[agentId]/_components/EvalRunsTable/EvalRunsTable.test.tsx) (edit only if a prop is needed; the selection reset is a `key`)
  - [`client/src/app/eval/page.tsx`](client/src/app/eval/page.tsx) (edit) · [`EvalDashboardView.tsx`](client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx) (edit: `notice` prop)
  - [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit)
- **Track:** B
- **Layer:** feature components under `app/eval/[agentId]`. The landing `page.tsx` is a server component: it reads `searchParams` and passes the notice as a prop, so the landing view needs no `useSearchParams`.
- **Skills:** (already loaded)
- **Do:**
  - **helpers.ts:**
    - `parseWindow(raw)` returns one of `'7d' | '30d' | '90d' | 'all'` and falls back to `'30d'` for anything else (R37);
    - `sinceFor(window, now)` returns an ISO string, or `undefined` for `all`.
  - **Window (AC-10):**
    - `AgentEvalView` reads `?window=` with `useSearchParams` (precedent: `client/src/app/agents/[id]/page.tsx:19-33`);
    - a change calls `router.replace` with the new `window`;
    - the runs table renders `useAgentEvalRuns(agentId, { since }).data`, not `dashboard.recent_runs`;
    - the trend is `dashboard.trend.filter(p => !since || p.ran_at >= since)` (Rec 1);
    - the tiles and `RegressionBanner` keep reading the unfiltered `dashboard` (AC-11).
  - **Switcher (AC-12):**
    - a `SelectInput` from `@devdigest/ui` with an accessible label, listing `useEvalDashboard().agents` (agents with ≥ 1 agent-owned case);
    - picking one calls `router.push(`/eval/${id}?window=${window}`)`. `push` makes Back return to the previous agent (AC-13);
    - `EvalRunsTable` gets `key={agentId}`, so its selection resets.
  - **Run eval (AC-6):** a header button using `useStartEvalRun(agentId)`, labelled with the existing `dashboard.runEval` ("Run eval ({count})", count = `dashboard.cases_total`) and `dashboard.running` ("Running…") while running. It copies the disabled/loading/409 handling of the agent `EvalsTab.tsx:40-45`, `:62-71`.
  - **Current version (AC-5):** a header line "Current version v{version}" from `useAgent(agentId)`.
  - **EC-10:** when both the windowed runs and the windowed trend are empty, show one empty state in place of the table and the trend. It offers a "Show all runs" button that sets `window=all`, and the tiles still render.
  - **EC-11:** once the workspace dashboard has loaded, if `agentId` is not among its `agents`, call `router.replace('/eval?notice=agent_not_found')`. The same applies to a non-uuid id; the agent dashboard's 422/404 is not shown as an error.
    - `client/src/app/eval/page.tsx` reads `searchParams.notice` (an async prop in Next 15) and passes `notice` to `EvalDashboardView`;
    - `EvalDashboardView` renders it with `role="status"`. Any value other than `agent_not_found` is ignored.
  - **Mocks:** `AgentEvalView.test.tsx` mocks `@/lib/hooks/evals` with an explicit factory. Add `useAgentEvalRuns`, `useEvalDashboard` and `useStartEvalRun` to it, and mock `@/lib/hooks/agents` (`useAgent`) and `next/navigation`.
  - **Literal copy (new keys under `agentPage` in `eval.json`):**
    - `windowLabel` "Time window";
    - `window7d` "7 days", `window30d` "30 days", `window90d` "90 days", `windowAll` "All";
    - `switcherLabel` "Agent";
    - `currentVersion` "Current version v{version}";
    - `emptyWindow` "No runs in this time window.";
    - `showAllRuns` "Show all runs";
    - and under `dashboard`: `notFoundNotice` "That agent was not found or has no eval cases.".
- **Done when:**
  - `helpers.test.ts`:
    - `parseWindow` covers `'7d'`, `'all'`, `'30D'` (case variant → `'30d'` fallback), `'14d'` (near-miss → fallback), `''` and `null`;
    - `sinceFor('7d', fixedNow)` is exactly 7 × 24 h earlier, and `sinceFor('all', fixedNow)` is `undefined`.
  - `AgentEvalView.test.tsx`:
    - with no `window`, the runs hook is called with a 30-day `since`;
    - a trend point exactly at `since` is kept, and one 1 ms earlier is dropped;
    - the tiles get the unfiltered dashboard;
    - an empty window shows "No runs in this time window." with the tiles present, and "Show all runs" calls `router.replace` with `window=all`;
    - an unknown agent id calls `router.replace('/eval?notice=agent_not_found')`;
    - "Run eval (4)" calls the start mutation;
    - "Current version v5" renders.
  - `AgentSwitcher.test.tsx`: it lists the cards' agents by name; picking one pushes `/eval/<id>?window=7d` when the window is `7d`; it is reachable by keyboard with the accessible name "Agent".
  - `WindowSelect.test.tsx`: four options with the exact labels, and `onChange` receives the key.
  - `EvalDashboardView.test.tsx`: `notice="agent_not_found"` renders "That agent was not found or has no eval cases.", and `notice="other"` renders nothing.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/eval/[agentId]/_components/AgentEvalView/helpers.test.ts" --file "client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx" --file "client/src/app/eval/[agentId]/_components/AgentSwitcher/AgentSwitcher.test.tsx" --file "client/src/app/eval/[agentId]/_components/WindowSelect/WindowSelect.test.tsx" --file client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx`

### B5. "Run all agents" on the landing page (AC-7, AC-8 display, AC-9, EC-8)
- **Files:** [`EvalDashboardView.tsx`](client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx) + test (edit) · `client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/RunAllAgentsModal.tsx` + `RunAllAgentsModal.test.tsx` + `helpers.ts` + `helpers.test.ts` + `index.ts` (new) · [`AgentEvalCard.tsx`](client/src/app/eval/_components/EvalDashboardView/_components/AgentEvalCard/AgentEvalCard.tsx) (edit) + `AgentEvalCard.test.tsx` (new) · [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit)
- **Track:** B
- **Layer:** feature components
- **Skills:** (already loaded)
- **Do:**
  - `helpers.ts`: `runAllSummary(cards)` returns:
    - `eligible`: cards with `enabled && cases_total > 0`;
    - `calls`: the sum of `cases_total` over eligible cards;
    - `estimate`: the sum of each eligible card's known `latest?.cost_usd`, or `null` when none is known;
    - `unknownCount`: eligible cards whose latest cost is null, or that have no latest run (Q2).
  - **Button:** "Run all agents" opens `RunAllAgentsModal` (on `Modal`; body wrapper `padding: 24`).
  - **Confirmation:** one row per eligible agent with "{n} cases" and its latest cost ("—" when unknown), then the total line "{calls} paid review calls · estimated {cost}". When `unknownCount > 0`, add "{n} agents have no cost estimate".
  - **Confirm:** calls `useRunAllAgents()`. The modal then switches to an outcome list with one text line per agent: "{agent}: started" or "{agent}: skipped — {reason}". The reasons are "already running", "no cases" and "disabled" (NFR-5). A 409 `eval_run_all_in_progress` shows "Another run of all agents is still starting.".
  - **EC-8:** with no eligible agent, the button is disabled and the helper text reads "No enabled agent has eval cases.".
  - **AC-9:** `AgentEvalCard` shows a "Running" `Badge`, with text, while `card.running`.
  - Add `useRunAllAgents` to the `@/lib/hooks/evals` mock factory in `EvalDashboardView.test.tsx` (`:11`).
  - **Literal copy (new keys under `dashboard` in `eval.json`):**
    - `runAllAgents` "Run all agents";
    - `runAllTitle` "Run all agents";
    - `runAllCases` "{count} cases";
    - `runAllTotal` "{calls} paid review calls · estimated {cost}";
    - `runAllUnknown` "{count} agents have no cost estimate";
    - `runAllConfirm` "Start runs";
    - `runAllCancel` "Cancel";
    - `runAllStarted` "{agent}: started";
    - `runAllSkipped` "{agent}: skipped — {reason}";
    - `reasonAlreadyRunning` "already running", `reasonNoCases` "no cases", `reasonDisabled` "disabled";
    - `runAllInProgress` "Another run of all agents is still starting.";
    - `runAllNone` "No enabled agent has eval cases.";
    - `cardRunning` "Running".
- **Done when:**
  - `helpers.test.ts` covers mixed cards: a disabled card excluded, a zero-case card excluded, a null cost counted in `unknownCount` and not as 0, and all costs unknown → `estimate` null.
  - `RunAllAgentsModal.test.tsx` covers:
    - the confirmation lists each eligible agent with its case count and "—";
    - the total calls value;
    - confirm → the outcome lines render the three reasons as text;
    - Escape and Cancel close without calling the mutation.
  - `EvalDashboardView.test.tsx`: EC-8 disabled with the reason text.
  - `AgentEvalCard.test.tsx`: `running: true` shows "Running", and `running: false` does not.
- **Verify:** `node scripts/verify.mjs client --file client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/RunAllAgentsModal.test.tsx --file client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/helpers.test.ts --file client/src/app/eval/_components/EvalDashboardView/_components/AgentEvalCard/AgentEvalCard.test.tsx --file client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx`

### B6. "Promote vX" in Compare (AC-1, AC-2, AC-5, EC-1, EC-2/EC-3 display, EC-4 display, EC-5)
- **Files:** [`CompareRunsModal.tsx`](client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.tsx) + [`CompareRunsModal.test.tsx`](client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.test.tsx) (edit) · `client/src/app/eval/[agentId]/_components/CompareRunsModal/helpers.ts` + `helpers.test.ts` (new) · `client/src/app/eval/[agentId]/_components/CompareRunsModal/_components/PromoteConfirm/PromoteConfirm.tsx` + `PromoteConfirm.test.tsx` + `index.ts` (new) · [`client/messages/en/eval.json`](client/messages/en/eval.json), [`client/messages/en/agents.json`](client/messages/en/agents.json) (edit)
- **Track:** B
- **Layer:** feature components; the pure diff goes in the modal's `helpers.ts`
- **Skills:** (already loaded)
- **Do:**
  - **`promotionDiff(snapshot, run, agent, links, skills)`** (pure) returns:
    - `fieldChanges`: each of provider, model, system_prompt (changed or not; no inline diff), output_schema (deep compare), strategy, ci_fail_on and repo_intel where the snapshot ≠ the current agent;
    - `skillChanges`: added, removed or reordered relative to the current effective set. The effective set is enabled links ∧ `skill.enabled`, by `order`, the same rule as [skills/repository.ts:232-253](server/src/modules/skills/repository.ts:232);
    - `missing`: run skills that are no longer in `useSkills()`;
    - `versionDrift`: a run skill whose current `version` ≠ the recorded `version`;
    - `same`: true when there are no field or skill changes.
  - **Footer:** one button per run, labelled "Promote v{version}":
    - disabled with "Current configuration" when `same` (EC-1);
    - disabled with "Version v{version} cannot be read" when its `useAgentVersion` (`CompareRunsModal.tsx:127-128`) errors (EC-5). The metric rows stay rendered.
  - **Confirmation:** activating a button opens `PromoteConfirm`, which lists:
    - the field changes (field names from `agents.json`);
    - the skill changes;
    - "Missing skills: {names} — they will not be restored" (EC-2);
    - for each drift, "Only the link to {skill} is restored, not its text (v{then} → v{now})" (EC-3).
  - **Confirm:** calls `usePromoteAgent(agentId)` with `{ from_version: run.agent_version, eval_run_id: run.id, expected_version }`.
    - `expected_version` is the `useAgent(agentId).data.version` captured the first time it loads after the modal opens, held in a ref, and not re-read at confirm time.
    - The confirm button is disabled while pending (EC-6, client half).
  - **Success (AC-5):** close Compare and show the toast "Promoted — now v{version}" via `useToast`. The page's version line (B4) updates through invalidation.
  - **409 (EC-4):** show the inline alert "This agent changed since you opened Compare. Reload to see its current version.". Nothing else changes.
  - **Literal copy (new keys under `compare` in `eval.json`):**
    - `promote` "Promote v{version}";
    - `promoteCurrent` "Current configuration";
    - `promoteUnreadable` "Version v{version} cannot be read";
    - `promoteTitle` "Promote v{version}";
    - `promoteConfirm` "Promote";
    - `promoteCancel` "Cancel";
    - `promoteMissing` "Missing skills: {names} — they will not be restored";
    - `promoteDrift` "Only the link to {skill} is restored, not its text (v{then} → v{now})";
    - `promoteSkillAdded` "Skill added: {name}", `promoteSkillRemoved` "Skill removed: {name}", `promoteSkillOrder` "Skill order changed";
    - `promoted` "Promoted — now v{version}";
    - `promoteConflict` "This agent changed since you opened Compare. Reload to see its current version.".
  - **New keys in `agents.json`** under a `fields` group, unless it already has field labels to reuse: "Provider", "Model", "System prompt", "Output schema", "Strategy", "CI policy", "Repo intel".
- **Done when:**
  - `helpers.test.ts` covers:
    - an identical config → `same: true`;
    - only the order of two skills differs → reorder, `same: false`;
    - a globally disabled skill in the current links is not counted as current;
    - a deleted skill → `missing`;
    - a skill at version 3 then 4 → drift;
    - an `output_schema` that is deep-equal but a different object → no change.
  - `CompareRunsModal.test.tsx` covers:
    - two buttons, "Promote v2" and "Promote v5";
    - EC-1 disabled with "Current configuration";
    - EC-5 disabled with its reason while the delta rows still render;
    - confirm → the mutation is called with the captured `expected_version`, even if `useAgent` re-renders with a newer version;
    - success → `onClose` is called and the toast text contains "v6";
    - 409 → the reload message renders.
  - `PromoteConfirm.test.tsx`: it lists the field and skill changes, the missing-skill line and the drift line, and is keyboard-operable (Tab to Promote, Enter).
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/helpers.test.ts" --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.test.tsx" --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/_components/PromoteConfirm/PromoteConfirm.test.tsx"` then `node scripts/verify.mjs client --checks`

### I1. Eval seed and e2e flow for AC-13 / EC-11 (Integration)
- **Files:** `server/src/db/seed-eval.ts` (new) · [`server/src/db/seed.ts`](server/src/db/seed.ts) (edit: one call after `seedBrief`, `:336`) · `server/test/seed-eval.it.test.ts` (new) · `e2e/specs/17-eval-run-controls.flow.json` (new) · [`e2e/README.md`](e2e/README.md) (edit: flow table row)
- **Track:** shared
- **Layer:** ring 3 (`db/**`), following the `seed-brief.ts` precedent
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`
- **Do:**
  - **Seed**, for "General Reviewer" and "Security Reviewer":
    - make sure an `agent_versions` row exists for the agent's current version, built from the agent row and its linked skill ids (`onConflictDoNothing`, Rec 6);
    - insert two `source: 'manual'` eval cases (`owner_kind: 'agent'`): a small frozen diff, one `must_find` and one `must_not_flag`;
    - insert four `completed` suite runs with `kind: 'suite'`, `owner_kind: 'agent'`, `owner_id = agent_id = the agent`, `single_case_id: null` and `agent_version` = the agent's version. They start 60, 20, 3 and 1 days before now, with fixed metrics. One has a `null` precision (the EC-12 gap) and one a `null` cost.
  - The seed is idempotent: skip an agent that already owns eval cases.
  - Other it-tests call `seed()` (`evals.it.test.ts`, `evals-authoring*.it.test.ts`, `conventions.it.test.ts`, …). The seeded rows are completed runs on two existing agents, so they never block a `running` index. The full `--it` run in I2 is the check that no existing assertion counted those agents' cases or runs.
  - **Flow** (it never clicks Run, Run all, Promote or Compare):
    - open `/eval`, click the "General Reviewer" card, then wait for the URL `/eval/`;
    - pick "7 days" → the URL contains `window=7d`;
    - `reload` → "7 days" is still selected and the table shows 2 runs;
    - switch the agent to "Security Reviewer" → the URL changes and keeps `window=7d`;
    - `back` → "General Reviewer" with `window=7d`;
    - open `/eval/00000000-0000-4000-8000-000000000000` → the URL becomes `/eval?notice=agent_not_found`, and the text "That agent was not found or has no eval cases." is visible.
    - `find … --name` is a substring match ([e2e/INSIGHTS.md:121](e2e/INSIGHTS.md:121)); use `--exact` where "General Reviewer" could collide.
- **Done when:**
  - `seed-eval.it.test.ts`: running `seed()` twice leaves exactly 4 eval cases and 8 suite runs on the two agents, each agent has an `agent_versions` row for its current version, and every seeded run has `owner_kind = 'agent'`;
  - the flow passes in the hermetic runner (in I2).
- **Verify:** `node scripts/verify.mjs server --it --file server/test/seed-eval.it.test.ts` (after `docker info`) · `node scripts/verify.mjs e2e --checks`

### I2. Docs and the one full run (Integration)
- **Files:**
  - [`server/src/modules/evals/README.md`](server/src/modules/evals/README.md) (edit):
    - the route table gains `POST /eval/run-all` and `?since=` on the agent run list;
    - the status table gains `409 eval_run_all_in_progress`;
    - "Time and width" (`:217-220`) names the 6-wide batch limiter, which only `runAll` passes to `launch`, and the slot-before-timer rule;
    - "Known limits" (`:353-355`) changes from "oldest first … describe an old pair" to "the dashboards read the newest 500 completed runs; the trend shows at most those 500".
  - [`server/README.md`](server/README.md) (edit): the agents route list gains `POST /agents/:id/promote`, its error codes and `agent_versions.origin`.
  - [`client/README.md`](client/README.md) (edit): the Eval section covers the window, the switcher, Run all agents, Promote, the Evals-tab trend and the promoted `components/eval-metrics/MetricTrendChart`.
- **Track:** shared
- **Done when:** every check below is green, and the e2e run includes flow `17-eval-run-controls`.
- **Verify:** `node scripts/verify.mjs server client` · `docker info` then `node scripts/verify.mjs server --it` · `./scripts/e2e.sh`

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic: contracts (step 0); `evals-run-controls.test.ts` (A1–A2: cards, `since`, dashboard cap boundaries 500/501, limiter, timer-after-slot, AC-8, EC-9, NFR-1, NFR-2, Q5); `agents-promote.test.ts` (A4: `planSkillLinks`, R35); `evals-routes.test.ts` (R36, `since` 422 rows) |
| server | `node scripts/verify.mjs server --it` | `agents-promote.it.test.ts` (AC-3, AC-4, EC-2, EC-4, EC-6, EC-7, NFR-1, NFR-3, NFR-7, skill-run 404) · `evals-run-controls.it.test.ts` (AC-8, EC-9, `since` boundary, agent-owned isolation, cards, Rec 9 on both dashboards) · `seed-eval.it.test.ts` (idempotent seed). Needs Docker; run `docker info` first |
| client | `node scripts/verify.mjs client` | lint · typecheck · hooks (B1) · trend/tooltip (B2: AC-15, EC-12) · Evals tab (B3: AC-14) · agent page (B4: AC-5, AC-6, AC-10, AC-11, AC-12, EC-10, EC-11, R37) · run-all (B5: AC-7, AC-9, EC-8, NFR-5) · promote (B6: AC-1, AC-2, AC-5, EC-1, EC-3, EC-4 display, EC-5) · contract sync (NFR-6) |
| e2e | `./scripts/e2e.sh` | flow 17: AC-13 reload + Back, EC-11 notice |
| static | the gate (`/pr-self-review`) | NFR-4 (no hardcoded strings), NFR-6 `shared-drift` |

## Risks & rollback
- **Step 0 makes both packages' typecheck red until A1/B1.** Each track's first step fixes its own package, so a track that verifies `--checks` before that step sees a red it did not cause. · Rollback: revert step 0's `EvalAgentCard` edit in both copies.
- **Queued cases timing out.** If the slot is acquired inside `reviewWithTimeout`, batches larger than 6 cases record `errored: timeout`. A2(b) pins this. · Rollback: drop the `limiter` field from the `launch` spec. `runAll` then degrades to per-run width 3, which violates NFR-2.
- **The limiter leaks into other run kinds.** If `launch` defaulted to a shared limiter, single-case and skill runs would queue behind a batch. A2(g) pins that only `runAll` passes one.
- **The dashboard read change (Rec 9) touches the sibling's `skillDashboard`.** It is a read-only change of which 500 rows are read, pinned by A5 on both dashboards. · Rollback: restore `order: 'asc'` in the two calls.
- **The promotion transaction locks the agent row** for a few small queries, so a concurrent `PUT /agents/:id` waits instead of interleaving. This is intended (EC-4). · Rollback: revert A4. The A3 migration is additive and harmless on its own.
- **Moving `MetricTrendChart`.** `AgentEvalView.test.tsx:10` mocks it by relative path, and a stale mock makes recharts render in jsdom. B2 switches it to a partial mock of the barrel. `--checks` is the gate after the move.
- **The seed changes the data every `seed()`-based it-test sees.** The rows are completed runs on two existing agents. I2's full `--it` run is the check. If an unrelated it-test goes red, re-run it on a clean HEAD first ([server/INSIGHTS.md:436-442](server/INSIGHTS.md:436)).
- **Migration number race.** If another branch lands a `0020` first, `pnpm db:generate` must be re-run on top of it. Never rename the file.
- **A skill that is globally disabled now but is in the run's set** is restored as an enabled link that has no effect (`blocksForAgent` also requires `skills.enabled`). The confirmation does not call this out; see Open questions.

## Out of scope
- An agent version-history UI in `client/`. The origin is exposed through `GET /agents/:id/versions` only (Q4).
- Restoring skill text, spend caps, scheduling, thresholds on the trend, and the Stats/CI tabs (the spec's Non-goals).
- A trend on the **skill** Evals tab, and any other change to `client/src/app/skills/**` or `client/src/components/eval-cases/**`.
- Server-side rejection of an identical promotion (Rec 8, not adopted).
- Paginating the runs table beyond the parent's 20 newest within the window (Q3), or the trend beyond the newest 500 runs.
- Moving the agent and skill delete cleanups into a shared helper (`server/INSIGHTS.md:324-326`, follow-up).
- Any change to `client/src/vendor/ui/**`, `reviewer-core/**` or applied migrations.
- In multi-agent mode, no track edits a file owned by another track.
- Writing or amending the spec. Gaps go back to `spec-creator` or the user as Open questions.
- Architectural review and security review; separate agents own those.
- Opening or pushing a PR; `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking (Q1, AC-3):** Skills linked now but absent from the run's set: keep them linked but disabled, or unlink them? — the user · **default taken: keep them linked, disabled, after the run's skills** (non-destructive; reversible from the Skills tab).
- **Non-blocking (Q2, AC-7):** The estimated total when some eligible agents have no known cost: sum the known costs and state "{n} agents have no cost estimate", or show "—" for the whole total? — the user · **default taken: sum the known costs plus the count of unknowns; the total is "—" only when none is known.**
- **Non-blocking (Q3, AC-10):** Does the window filter on run start (`ran_at`) or finish, and does the table keep the parent's 20-newest cap inside the window? — the user · **default taken: start time (`ran_at`, so a running run shows in its window); the 20-row cap is kept (parent AC-12).**
- **Non-blocking (Q4, AC-4):** Where is the promotion's "history entry" shown? — the user · **default taken: API only (`AgentVersion.origin`); a UI is a follow-up.**
- **Non-blocking (Q5, NFR-2):** Is "a second Run all agents while a batch is still starting" scoped to the start loop, or to the whole batch while any of its runs is running? — the user · **default taken: the start loop only (in-process flag). The per-agent 409 covers the running phase.**
- **Non-blocking:** Should the Promote confirmation warn when a restored skill is now globally disabled? — the user · **default taken: no warning** (not in the spec; listed in Risks).
- **Non-blocking (new):** The fix in Rec 9 also changes the skill dashboard, which is sibling code. — the user · **default taken: fix both,** since they share one read and a half fix would leave the two dashboards on different rules. Drop the `skillDashboard` line if the user wants the sibling untouched.
