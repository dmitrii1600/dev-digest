# Implementation Plan: Eval run controls and history views (Promote vN, Run all agents, time window, agent switcher, Evals-tab trend)

**Plan ID:** 2026-10-05-eval-run-controls  ·  **Spec:** [specs/2026-10-05-eval-run-controls.md](specs/2026-10-05-eval-run-controls.md)  ·
**Execution mode:** multi-agent (step 0 → tracks A, B in parallel → Integration)  ·  **Packages:** server, client, e2e  ·
**Assumptions:** Q-1…Q-4 of the spec take their stated defaults. The five gaps in *Open questions* take the defaults written there. The parent pipeline (commit `b6c1529`) is the baseline, and every route, table and component it added is used as-is unless a step says otherwise.

## Summary
This adds five controls on top of the shipped eval pipeline:
- **Promote vX** in Compare. A new transactional `POST /agents/:id/promote` restores the version-snapshot fields plus the run's recorded skill set, and records the result as version current+1. The new version carries an `origin` on a new nullable `agent_versions.origin` column.
- **Run all agents** on `/eval`. A new `POST /eval/run-all` returns one outcome per agent, and a batch-wide limiter caps the batch at 6 review calls in flight.
- **Time window** and **agent switcher** on `/eval/[agentId]`. Both live in the URL. The table reads `GET /agents/:id/eval-runs?since=`, and the trend filters `dashboard.trend` on the client.
- **Evals-tab trend**. The existing recharts `MetricTrendChart` (it already draws gaps) moves to `src/components/eval-metrics/`. It loses its 20-point cap and gains a tooltip.

Server and client share only the step-0 contracts, so the work splits into two disjoint tracks. The seed, the e2e flow and the docs go in the Integration step.

## Requirements review

**What I understood:** The plan extends the shipped eval pipeline with promotion-as-new-version, a cost-confirmed batch run, a URL-backed window and agent switcher, and a trend on the AgentEditor Evals tab. It never rewrites `agent_versions` or `eval_runs`.
**Inputs read:** specs/2026-10-05-eval-run-controls.md · parent specs/2026-10-05-eval-pipeline.md (AC-6, AC-12, EC-8, EC-11) · plans/2026-10-05-eval-pipeline.md (existence) · sibling plans/2026-10-05-eval-case-authoring.md (file overlap and build order, see *Constraints → Sibling sequencing*) · request text · AGENTS.md · client/AGENTS.md · server/src/modules/evals/README.md · INSIGHTS.md · server/INSIGHTS.md · client/INSIGHTS.md · reviewer-core/INSIGHTS.md (b6c1529 entry) · .claude/skills/pr-self-review/routing.md

**Execution mode:** stated by the caller as "planner's choice". I chose **multi-agent**: `server/` and `client/` share nothing but the two contract files, which step 0 writes. Each track stays inside one package, so no shared `typecheck` couples them.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "offer "Promote vX" for each run whose recorded configuration differs from the agent's current configuration" | spec §AC-1 | clear |
| R2 | "ask for confirmation … lists each configuration field and each skill-set change" | spec §AC-2 | clear |
| R3 | "set the agent's linked enabled skills and their order to the set recorded on the promoted run, and record the result as a new version (current + 1)" | spec §AC-3 | ambiguous — see Q1 (what happens to links outside the run's set) |
| R4 | "existing versions 1 … current shall stay unchanged. The new version's history entry shall state that it was promoted from vX and from which eval run" | spec §AC-4 | ambiguous — see Q4. There is no agent version-history UI in `client/` (only `skills/[id]/…/VersionsTab` exists), so the "history entry" is the `GET /agents/:id/versions` item |
| R5 | "the modal shall close and a confirmation shall name the new version number. The page shall show that version as the agent's current version" | spec §AC-5 | clear. `/eval/[agentId]` shows no version today ([AgentEvalView.tsx:35-56](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx:35)), so step B4 adds one |
| R6 | "WHEN the user activates "Run eval" on an agent's dashboard page … exactly as the parent's "Run all evals" does" | spec §AC-6 | clear |
| R7 | "confirmation that lists each eligible agent (enabled, at least one case) with its case count … total number of paid review calls, and an estimated cost … "—" for agents never run" | spec §AC-7 | ambiguous — see Q2 (the total when some costs are unknown). `EvalAgentCard` has no `enabled` ([eval-ci.ts:167-175](server/src/vendor/shared/contracts/eval-ci.ts:167)) |
| R8 | "try to start one suite run per eligible agent … started, or skipped with a reason (already running, no cases, disabled). A skipped agent shall not stop the others" | spec §AC-8 | clear |
| R9 | "the landing page shall show that agent's card as running until the run completes" | spec §AC-9 | clear. The card has no running flag, and the landing page polls only on the 20 newest runs ([evals.ts:124](client/src/lib/hooks/evals.ts:124)), so step 0 and step A1 add one |
| R10 | "time window of 7 days, 30 days, 90 days or all, defaulting to 30 days … limit the runs table and the trend chart to suite runs completed inside the window" | spec §AC-10 | ambiguous — see Q3 (filter on start time, and whether the 20-row cap stays) |
| R11 | "metric tiles and the regression banner shall always reflect the agent's latest two suite runs, whatever the selected window" | spec §AC-11 | clear. Tiles come from `agentDashboard`, which no window touches ([service.ts:483-530](server/src/modules/evals/service.ts:483)) |
| R12 | "agent switcher that lists every agent with at least one case … clear the run selection and keep the selected window" | spec §AC-12 | clear |
| R13 | "WHEN the user reloads the page or navigates Back … restore the selected agent and window from the URL" · verify: e2e | spec §AC-13 | clear. No eval seed and no eval e2e flow exist (`e2e/specs/` ends at `16-pr-brief`), so Integration adds both |
| R14 | "Evals tab shall plot recall, precision and citation accuracy across all of the agent's suite runs … Single-case runs shall be excluded" | spec §AC-14 | contradicts tree — `toChartRows` keeps only the newest 20 ([MetricTrendChart/helpers.ts:3](client/src/app/eval/[agentId]/_components/MetricTrendChart/helpers.ts:3), `:15`). Single-case exclusion already holds because every run query filters `kind = 'suite'` ([repository.ts:105](server/src/modules/evals/repository.ts:105)) |
| R15 | "WHEN the user hovers over or focuses a point … show that run's date, agent version and cost, with "—" for an unknown cost" | spec §AC-15 | clear. `EvalTrendPoint` already carries `ran_at`, `agent_version` and `cost_usd` ([eval-ci.ts:199-211](server/src/vendor/shared/contracts/eval-ci.ts:199)) |
| R16 | "IF a compared run's recorded configuration equals the agent's current configuration, THEN its Promote action shall be disabled and labelled as the current configuration" | spec §EC-1 | clear |
| R17 | "IF a skill in the promoted run's set has since been deleted … name the missing skills … promote without them … history entry shall list them as missing" | spec §EC-2 | clear |
| R18 | "IF a skill … has a different skill version now … warn that only the link is restored … name the skill with both versions" | spec §EC-3 | clear |
| R19 | "IF the agent's current version changed after the Compare modal was opened, THEN the promotion shall be rejected with 409. Nothing shall change" | spec §EC-4 | clear |
| R20 | "IF snapshot vX cannot be read, THEN "Promote vX" shall be disabled with a reason, and the metric deltas shall stay visible" | spec §EC-5 | clear. `useAgentVersion` has `retry: false` ([agents.ts:85-92](client/src/lib/hooks/agents.ts:85)). Seeded agents have **no** `agent_versions` rows (`server/src/db/seed.ts` never writes one), so on seed data this is the path users see unless the seed is fixed (Rec 6) |
| R21 | "IF the user confirms the same promotion twice (double submit), THEN the system shall record exactly one new version" | spec §EC-6 | clear |
| R22 | "IF a suite run of the agent is running when a promotion is recorded, THEN that run shall stay recorded against the version it started with" | spec §EC-7 | clear. Already structural: `startRun` stamps `agentVersion` at insert and `execute` uses the captured agent ([service.ts:214](server/src/modules/evals/service.ts:214), `:233-240`). Only a test is needed |
| R23 | "IF no agent is eligible, THEN "Run all agents" shall be disabled and say why" | spec §EC-8 | clear |
| R24 | "IF every eligible agent already has a running suite run, THEN "Run all agents" shall start no run and report every agent as skipped" | spec §EC-9 | clear |
| R25 | "IF no suite run falls inside the selected window … empty state that offers a wider window. The tiles shall keep showing the latest runs" | spec §EC-10 | clear |
| R26 | "IF the URL names an agent that does not exist in the workspace or has no case, THEN the page shall show the dashboard landing with a notice" | spec §EC-11 | clear |
| R27 | "IF a run's metric is not available … every trend chart shall leave a gap … never plot it as 0" | spec §EC-12 (and "Request vs tree" on `LineChart`) | contradicts tree, in the safe direction. The dashboard chart already bypasses the vendored `LineChart` and uses recharts with `connectNulls={false}` ([MetricTrendChart.tsx:1-3](client/src/app/eval/[agentId]/_components/MetricTrendChart/MetricTrendChart.tsx:1), `:48`). Reuse it; `vendor/ui` stays untouched |
| R28 | "exactly one review call per case of each started agent and no other model call. Promotion makes no model call" | spec §NFR-1 | clear. The single-shot client is already in place ([routes.ts:62](server/src/modules/evals/routes.ts:62)) |
| R29 | "at most 6 review calls are in flight at once. A second "Run all agents" while a batch is still starting is rejected with 409" | spec §NFR-2 | ambiguous — see Q5 (what "still starting" means). Per-run width is 3 ([constants.ts:13](server/src/modules/evals/constants.ts:13)), so a batch of N agents could reach 3·N without a shared limiter |
| R30 | "no action in this spec updates or deletes an existing `agent_versions` entry or an eval run" | spec §NFR-3 | clear |
| R31 | "every new string is read from `messages/en/eval.json` (or `agents.json` for agent-version text)" | spec §NFR-4 | clear |
| R32 | "confirmations, the window selector and the agent switcher are operable by keyboard, with accessible names … outcome is stated in text" | spec §NFR-5 | clear |
| R33 | "every contract added or changed here is mirrored in the client copy of `@devdigest/shared` in the same change" | spec §NFR-6 | clear. Enforced by [client/src/test/eval-contract-sync.test.ts](client/src/test/eval-contract-sync.test.ts), which checks byte equality for `eval-ci.ts` and `knowledge.ts` |
| R34 | "each promotion logs the agent, the from-version, the new version and the source eval run. Each "Run all agents" logs each agent's outcome" | spec §NFR-7 | clear |
| R35 | Promote request: "uuid and positive integers in a strict body … the run belongs to this agent and workspace, and its version exists" → "422 naming the field; 404 … 409 on a version mismatch" | spec §Untrusted inputs | clear |
| R36 | Run-all request: "strict object with no fields" → "422" | spec §Untrusted inputs | clear |
| R37 | URL `since`/window and agent id: "one of `7d`, `30d`, `90d`, `all`; … uuid in this workspace" → "Fall back to `30d`; landing with a notice (EC-11)" | spec §Untrusted inputs | clear |

### Recommendations
1. **Trend on the agent page = `dashboard.trend` filtered by `ran_at` on the client. `GET …/eval-runs?since=` serves only the table.** Adopted. Why: `agentDashboard` already returns every completed run oldest-first, up to 500 ([service.ts:487-491](server/src/modules/evals/service.ts:487), `:523`). The runs route caps `limit` at 100 ([routes.ts:26](server/src/modules/evals/routes.ts:26)), so a trend built from it would truncate "all". Plan change: step A1 adds `since` to the runs route only, and steps B4 and B3 use `dashboard.trend`. This departs from the spec's module-interactions row ("Evals tab trend → `GET /agents/:id/eval-runs?since=…`"). The contract (`EvalTrendPoint`/`EvalSuiteRun`) is unchanged.
2. **Reuse and promote the existing recharts `MetricTrendChart` instead of working around the vendored `LineChart`.** Adopted. Why: R27/R14. It is used by two features (`/eval/[agentId]` and the AgentEditor Evals tab), so it moves to `client/src/components/eval-metrics/MetricTrendChart/`. Plan change: step B2.
3. **The batch limiter starts the 120 s case timer only after a slot is acquired.** Adopted. Why: `reviewWithTimeout` arms its timer as soon as it is called ([service.ts:412-427](server/src/modules/evals/service.ts:412)). A case queued behind the 6-slot batch limiter would otherwise be recorded `errored: timeout` without ever making its call. Plan change: step A2's *Do* and *Done when*.
4. **Promotion is one DB transaction: `SELECT … FOR UPDATE` on the agent, a version check, and a plain `agent_versions` insert.** Adopted. Why: `AgentsRepository.update` is not transactional ([repository.ts:126-160](server/src/modules/agents/repository.ts:126)), and `snapshotVersion` swallows a version-PK conflict with `onConflictDoNothing` ([repository.ts:180](server/src/modules/agents/repository.ts:180)). With those, a double submit or a concurrent edit could produce a version without a snapshot, or two writers on one version. Plan change: step A4.
5. **Store the origin in a new nullable `agent_versions.origin` jsonb column (one additive generated migration), not inside `config_json`.** Adopted. Why: `config_json` is parsed as `AgentVersionConfig` and is the "configuration" that AC-1 compares ([helpers.ts:263](server/src/modules/agents/helpers.ts:263)). An origin is not configuration. The skills precedent is a separate `skill_versions.note` column (`server/src/db/schema/skills.ts:36`). Plan change: step A3.
6. **The eval seed also writes the missing `agent_versions` snapshot for the agents it seeds runs for.** Adopted. Why: seeded agents are inserted raw with no version row (`server/src/db/seed.ts:268`). On a fresh clone, Compare therefore always shows "prompt diff unavailable" and Promote is always disabled (EC-5). This repeats [server/INSIGHTS.md:57](server/INSIGHTS.md:57). Plan change: step I1.
7. **`EvalAgentCard` gains `enabled` and `running`, so eligibility (AC-7) and the running card (AC-9) are server truth.** Adopted. Why: R7/R9. Plan change: steps 0, A1, B1, B5.
8. **Reject a no-op promotion (identical configuration) on the server too.** Not adopted. EC-1 states it as a client rule. Adding a server rule the spec does not state widens scope, and it would also turn an EC-4 race into a second error code. The client disables the button.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | contract-once + mirror, `*.it.test.ts`, `.js` imports, verify flags, do-not-touch (migrations, `vendor/ui`) |
| [client/AGENTS.md](client/AGENTS.md) | `src/vendor/ui` is do-not-touch except `nav.ts` |
| [server/src/modules/evals/README.md](server/src/modules/evals/README.md) | routes, statuses, "completed" = completed\|partial, 500-run dashboard cap, one-running-per-agent index, lazy ports |
| [server/src/modules/evals/service.ts](server/src/modules/evals/service.ts) | `startRun`/`execute` worker pool, timer placement, dashboards, `trendPoint` |
| [server/src/modules/evals/repository.ts](server/src/modules/evals/repository.ts) | `SUITE` filter, `listRuns` options, `agentsWithCases` (no `enabled`) |
| [server/src/modules/evals/types.ts](server/src/modules/evals/types.ts) | `EvalsStore` port, `AgentWithCases` |
| [server/src/modules/agents/repository.ts](server/src/modules/agents/repository.ts) | versioning, `snapshotVersion`, link table semantics, `deleteById` precedent for touching an eval table |
| [server/src/modules/agents/routes.ts](server/src/modules/agents/routes.ts) · [service.ts](server/src/modules/agents/service.ts) · [helpers.ts](server/src/modules/agents/helpers.ts) | no restore route. `AgentsService(container)`. `toAgentVersionDto` parses `config_json` |
| [server/src/modules/skills/repository.ts:207-228](server/src/modules/skills/repository.ts:207) | the run's skill set = enabled links ∧ `skills.enabled`, in link order |
| [server/src/db/schema/agents.ts:52-63](server/src/db/schema/agents.ts:52) | `agent_versions` PK `(agent_id, version)`, no origin |
| [server/src/vendor/shared/contracts/eval-ci.ts](server/src/vendor/shared/contracts/eval-ci.ts) · [knowledge.ts:476-531](server/src/vendor/shared/contracts/knowledge.ts:476) | `EvalAgentCard`, `EvalTrendPoint`, `EvalRunSkill`, `AgentVersion` |
| [client/src/lib/hooks/evals.ts](client/src/lib/hooks/evals.ts) · [agents.ts](client/src/lib/hooks/agents.ts) | query keys, polling rules, `useAgentVersion` no-retry |
| `client/src/app/eval/**`, [EvalsTab.tsx](client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx) | current UI. The trend chart already uses recharts with gaps. The tests mock `../MetricTrendChart` by relative path |
| [client/src/test/eval-contract-sync.test.ts](client/src/test/eval-contract-sync.test.ts) | NFR-6 is already enforced by a byte-equality test |
| [server/test/evals-routes.test.ts](server/test/evals-routes.test.ts) · [server/test/evals.it.test.ts](server/test/evals.it.test.ts) | test patterns: hermetic 422 table, Docker-gated integration |
| [e2e/README.md](e2e/README.md) · [server/src/db/seed-brief.ts](server/src/db/seed-brief.ts) | flows run on read-only seeded data. A feature seed is a `seed-<x>.ts` called from `seed.ts` |
| [server/INSIGHTS.md:57](server/INSIGHTS.md:57), [:139](server/INSIGHTS.md:139), [:143](server/INSIGHTS.md:143), [:315](server/INSIGHTS.md:315), [:336](server/INSIGHTS.md:336) | binding entries, below |
| [INSIGHTS.md:287](INSIGHTS.md:287), [:294](INSIGHTS.md:294) · [client/INSIGHTS.md:42](client/INSIGHTS.md:42), [:48](client/INSIGHTS.md:48) | unknown cost "—", mirror drift, move ⇒ typecheck is the gate, modal padding |

## Insights that bind this work
1. **A table with a companion history must get its history on every write path** ([server/INSIGHTS.md:57](server/INSIGHTS.md:57)). The promotion writes the agent row, the links and the `agent_versions` row in one transaction inside `AgentsRepository`, never as a raw side-insert elsewhere. The eval seed writes the missing v1 snapshot (Rec 6).
2. **`agents` may not import `modules/evals` (`no-cross-module-reach-in`). The precedent is `AgentsRepository.deleteById` touching `t.evalCases` directly** ([server/INSIGHTS.md:315](server/INSIGHTS.md:315)). The promotion reads the run's header from `t.evalRuns` inside `agents/repository.ts` (ring 3, schema import allowed). It returns a plain `{ agentId, agentVersion, skills }` shape and never imports `modules/evals/*`.
3. **`pnpm typecheck` never sees `server/test/**`** ([server/INSIGHTS.md:139](server/INSIGHTS.md:139)). Widening `EvalsStore` (new `since` option, `enabled` on `AgentWithCases`, per-agent running) needs a by-hand update of the fakes in `server/test/evals-service.test.ts` and `server/test/evals-create-case.test.ts` (grep `makeStore`).

Also checked against *What Doesn't Work*:
- `drizzle-kit` hangs when one table both gains and loses a column ([server/INSIGHTS.md:336](server/INSIGHTS.md:336)). Step A3 only **adds** a column, so no prompt fires.
- A green `--it` with Docker down is a skip ([server/INSIGHTS.md:143](server/INSIGHTS.md:143)). Step A5 runs `docker info` first.
- Moving a module ⇒ `typecheck` is the gate, not `test` ([client/INSIGHTS.md:42](client/INSIGHTS.md:42)). Step B2 verifies with `--checks`.
- New modals need `body: { padding: 24 }` ([client/INSIGHTS.md:48](client/INSIGHTS.md:48)).

## Constraints
- **Onion rings (server):** `routes.ts` = HTTP edge with declarative zod `params`/`querystring`/`body`/`response`, no `.parse()` in a handler. `service.ts`/`helpers.ts`/`types.ts`/`constants.ts` = ring 2, no drizzle/fastify import. `repository.ts` = ring 3. `server/src/db/seed-eval.ts` = ring 3 (`db/**`).
- **No cross-module import:** `modules/agents/**` must not import `modules/evals/**` and vice versa. Shared reads go through the DB in the owning repository (Insight 2).
- **Contract once + mirror:** every edit to `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts` is copied byte-identically to `client/src/vendor/shared/contracts/` in the same step. The sync test fails otherwise.
- **`.js` on relative imports** in every new or edited `server/` file.
- **`*.it.test.ts`** for any test touching Postgres: `server/test/agents-promote.it.test.ts`, additions to `server/test/evals.it.test.ts`. Hermetic tests must not import `db/client`.
- **Migrations:** generate with `cd server && pnpm db:generate`, never hand-written or renamed. Never edit `0000`–`0018`.
- **Unknown cost is "—", never 0** ([INSIGHTS.md:287](INSIGHTS.md:287)). This applies to the run-all estimate, the tooltip and the outcome list.
- **Do not touch:** `client/src/vendor/ui/**` (the trend uses recharts directly), `reviewer-core/**`, applied migrations, lock-files. No new dependency is needed; `recharts@^2.15` is already in `client/package.json`.
- **Client:** no `fetch` in components; hooks go in `src/lib/hooks/*` over `src/lib/api.ts`. Every user-facing string comes from `messages/en/eval.json` (or `agents.json`). Each new `_components/<Name>/<Name>.tsx` ships `<Name>.test.tsx`. `src/components/**` must not import `src/app/**`.
- **POST bodies are `z.object({}).strict()`.** The client always sends `{}` ([evals.ts:11-13](client/src/lib/hooks/evals.ts:11)).
- **Sibling sequencing.** `plans/2026-10-05-eval-case-authoring.md` (unbuilt) edits the same server files (`evals/{constants,helpers,types,repository,service,routes}.ts`, `eval-ci.ts`, `evals-service/routes/create-case.test.ts`, `evals.it.test.ts`), the same client files (`hooks/evals.ts`, `eval.json`, the agent `EvalsTab`) and generates its own migration. Build order: **case-authoring first, then this plan**; never both at once. Consequences for this plan when it builds second:
  - the migration in A3 is the **next free number** (`0020` after the sibling's `0019`), never a duplicate;
  - the sibling renames `SUITE` to `AGENT_SUITE` (workspace + `kind='suite'` + `owner_kind='agent'`). A1's `running` card flag and every run read here use that filter, so a skill run hosted on an agent never lights up that agent's card;
  - the sibling refactors `startRun` into a private `launch(...)`. A2 threads `limiter` into `launch` → `execute` → `runCase`, and `startRun(ws, agentId, opts)` stays the thin wrapper;
  - A4 step (2) already requires `owner_kind = 'agent'` on the promoted run. That is correct today (every run is agent-owned) and necessary afterwards: a skill run hosted on agent H has `agent_id = H` but records `[skill]` as its skill set, so promoting from it would strip H's skills.

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
| A — server | `server/src/modules/agents/**`, `server/src/modules/evals/{constants,helpers,types,repository,service,routes}.ts`, `server/src/db/schema/agents.ts`, new files under `server/src/db/migrations/**` (generated), `server/test/agents-promote*.ts`, `server/test/evals-{service,helpers,routes,create-case}.test.ts`, `server/test/evals.it.test.ts` | A1–A5 | `node scripts/verify.mjs server --checks` · `--file …` | step 0 |
| B — client | `client/src/**` except `client/src/vendor/**`, `client/messages/en/eval.json`, `client/messages/en/agents.json` | B1–B6 | `node scripts/verify.mjs client --checks` · `--file …` | step 0 |
| shared — integration | `server/src/db/seed.ts`, `server/src/db/seed-eval.ts` (new), `e2e/specs/17-eval-run-controls.flow.json` (new), `e2e/README.md`, `server/src/modules/evals/README.md`, `server/README.md`, `client/README.md` | I1–I2 | the one full run | A, B |

No path appears in two rows. Each track is one `implementer` invocation.

## Steps

### 0. Contracts: promotion, origin, run-all outcome, card flags (both copies)
- **Files:** [`server/src/vendor/shared/contracts/knowledge.ts`](server/src/vendor/shared/contracts/knowledge.ts) (edit) · [`server/src/vendor/shared/contracts/eval-ci.ts`](server/src/vendor/shared/contracts/eval-ci.ts) (edit) · [`client/src/vendor/shared/contracts/knowledge.ts`](client/src/vendor/shared/contracts/knowledge.ts) (edit, byte copy) · [`client/src/vendor/shared/contracts/eval-ci.ts`](client/src/vendor/shared/contracts/eval-ci.ts) (edit, byte copy) · [`server/test/contracts.test.ts`](server/test/contracts.test.ts) (edit)
- **Track:** shared
- **Layer:** innermost ring (contracts). Pure zod, no imports beyond what each file already has.
- **Skills:** `zod`
- **Do:**
  - `knowledge.ts`:
    - add `AgentPromoteInput`, a strict object of `from_version` (int > 0), `eval_run_id` (uuid) and `expected_version` (int > 0);
    - add `AgentVersionOrigin`, illustratively `{ kind: 'promotion', from_version, eval_run_id, missing_skills: { skill_id, name }[] }`;
    - extend `AgentVersion` with `origin: AgentVersionOrigin.nullish()`. Use `.nullish()`, not `.nullable()`, so older payloads and the client's existing fixtures stay valid.
  - `eval-ci.ts`:
    - extend `EvalAgentCard` with `enabled: z.boolean()` and `running: z.boolean()`;
    - add `EvalRunAllOutcome`: `{ agent_id, agent_name, status: 'started' | 'skipped', reason: 'already_running' | 'no_cases' | 'disabled' | null, run_id: string | null }`;
    - add `EvalRunAllResult`: `{ outcomes: EvalRunAllOutcome[] }`.
  - Copy both files to the client byte for byte.
  - Add parse cases to `server/test/contracts.test.ts`:
    - `AgentPromoteInput` rejects an extra key, `from_version: 0` and a non-uuid run id, and accepts the boundary `from_version: 1`;
    - `AgentVersion` parses with and without `origin`.
- **Done when:** both copies are byte-identical, and the new contract tests pass. **Known red window:** `server` and `client` `typecheck` are red after this step, because `EvalAgentCard` producers and fixtures lack the two new fields. Step A1 (server) and step B1 (client) turn them green. Do not weaken the fields to `.optional()` to avoid it.
- **Verify:** `node scripts/verify.mjs server --file server/test/contracts.test.ts` · `node scripts/verify.mjs client --file client/src/test/eval-contract-sync.test.ts`

### A1. Workspace cards carry `enabled` + `running`. Runs list takes `since`
- **Files:** [`server/src/modules/evals/types.ts`](server/src/modules/evals/types.ts) (edit) · [`repository.ts`](server/src/modules/evals/repository.ts) (edit) · [`service.ts`](server/src/modules/evals/service.ts) (edit) · [`routes.ts`](server/src/modules/evals/routes.ts) (edit) · [`server/test/evals-service.test.ts`](server/test/evals-service.test.ts) (edit) · [`server/test/evals-create-case.test.ts`](server/test/evals-create-case.test.ts) (edit, fakes only) · [`server/test/evals-routes.test.ts`](server/test/evals-routes.test.ts) (edit)
- **Track:** A
- **Layer:** types/service ring 2 · repository ring 3 · routes edge
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices`
- **Do:**
  - `AgentWithCases` gains `enabled`, selected from `t.agents.enabled`.
  - `workspaceDashboard` fills each card's `enabled`, and fills `running` from a `running` **agent-owned** suite run of that agent (today's `SUITE` filter; the sibling's `AGENT_SUITE` once it lands). Use one grouped query or a per-agent `listRuns({ statuses: ['running'], limit: 1 })`, both after the existing sweep.
  - `listRuns` opts gain `since?: Date`, applied as `ran_at >= since`.
  - `RunsQuery` gains `since: z.string().datetime().optional()`, passed through as a `Date`. `limit` keeps its default of 20 and max of 100.
  - Update every `EvalsStore` fake in `server/test/` (Insight 3).
- **Done when:**
  - `evals-service.test.ts` asserts a disabled agent's card has `enabled: false` and an agent with a running run has `running: true`;
  - a `since` exactly equal to a run's `started_at` includes it (boundary), and one 1 ms later excludes it;
  - `evals-routes.test.ts` gains `list-runs: since is not a datetime` → 422;
  - `server` `typecheck` is green again.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-service.test.ts --file server/test/evals-routes.test.ts --file server/test/evals-create-case.test.ts` then `node scripts/verify.mjs server --checks`

### A2. `POST /eval/run-all` with a batch-wide limiter
- **Files:** [`server/src/modules/evals/constants.ts`](server/src/modules/evals/constants.ts) (edit) · [`helpers.ts`](server/src/modules/evals/helpers.ts) (edit) · [`service.ts`](server/src/modules/evals/service.ts) (edit) · [`routes.ts`](server/src/modules/evals/routes.ts) (edit) · [`server/test/evals-helpers.test.ts`](server/test/evals-helpers.test.ts) (edit) · [`server/test/evals-service.test.ts`](server/test/evals-service.test.ts) (edit) · [`server/test/evals-routes.test.ts`](server/test/evals-routes.test.ts) (edit)
- **Track:** A
- **Layer:** constants/helpers/service ring 2 · routes edge
- **Skills:** (already loaded)
- **Do:**
  - `constants.ts`: add `RUN_ALL_CONCURRENCY = 6`.
  - `helpers.ts`: add a small pure counting limiter (`createLimiter(n)` → `run<T>(fn)`), with no timers inside it.
  - `startRun(workspaceId, agentId, opts?: { limiter? })`: the limiter is threaded through `execute` → `runCase` (through `launch` as well, once the sibling has introduced it). A case acquires a batch slot **before** `reviewWithTimeout` is called, so the 120 s timer starts only once the call can actually start (Rec 3). The per-run width of 3 still applies.
  - `runAll(workspaceId)`:
    - while the in-process `runAllStarting` flag is set, throw `AppError('eval_run_all_in_progress', …, 409)`;
    - otherwise set the flag, create one limiter of 6, and iterate `agentsWithCases`;
    - a disabled agent becomes `skipped/disabled`;
    - for every other agent, call `startRun` with the limiter. A 409 `eval_run_in_progress` becomes `skipped/already_running`, and a 422 `eval_set_empty` becomes `skipped/no_cases`;
    - any other error propagates only after the flag is cleared (`finally`).
  - Log `eval run-all outcome` once per agent with `{ agentId, status, reason, runId }` (NFR-7).
  - Route: `app.post('/eval/run-all', { schema: { body: EmptyBody, response: { 200: EvalRunAllResult } } })`.
- **Done when:**
  - `evals-helpers.test.ts`: the limiter never exceeds n with 10 queued tasks (n = 6), and releases on rejection.
  - `evals-service.test.ts`, on a fake store and a deferred fake `review`:
    - (a) three eligible agents with 4 cases each never put more than 6 review calls in flight at once, and no single run puts more than 3 (NFR-2);
    - (b) a queued case is **not** recorded as a timeout while it waits for a slot;
    - (c) outcomes are `started` / `skipped:disabled` / `skipped:already_running`, and a skipped agent does not stop the next one (AC-8);
    - (d) every agent already running → every outcome is skipped and no run row is inserted (EC-9);
    - (e) a second `runAll` while the first is inside its start loop → 409 `eval_run_all_in_progress`;
    - (f) exactly one `review` call per case of each started agent (NFR-1).
  - `evals-routes.test.ts` gains `run-all: extra body key` → 422.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-helpers.test.ts --file server/test/evals-service.test.ts --file server/test/evals-routes.test.ts`

### A3. `agent_versions.origin` column (generated migration)
- **Files:** [`server/src/db/schema/agents.ts`](server/src/db/schema/agents.ts) (edit) · `server/src/db/migrations/<next>_<generated>.sql` (new, generated) · `server/src/db/migrations/meta/<next>_snapshot.json` (new, generated) · [`server/src/db/migrations/meta/_journal.json`](server/src/db/migrations/meta/_journal.json) (edit, generated). The latest applied migration is `0018`; `<next>` is `0019` only if the sibling case-authoring plan has not landed, otherwise `0020`.
- **Track:** A
- **Layer:** ring 3 (db schema)
- **Skills:** `postgresql-table-design` (plus the ones already loaded)
- **Do:** add `origin: jsonb('origin')` (nullable, no default) to `agentVersions`. Then run `cd server && pnpm db:generate`. It is additive only, so no interactive prompt fires ([server/INSIGHTS.md:336](server/INSIGHTS.md:336)). Do not edit the generated SQL.
- **Done when:** the new SQL is a single `ALTER TABLE "agent_versions" ADD COLUMN "origin" jsonb;`, `_journal.json` has the new entry, and no previously applied migration file changed (`git status` shows only additions plus the journal).
- **Verify:** `node scripts/verify.mjs server --checks`

### A4. `POST /agents/:id/promote`: transactional restore as a new version
- **Files:** [`server/src/modules/agents/repository.ts`](server/src/modules/agents/repository.ts) (edit) · [`helpers.ts`](server/src/modules/agents/helpers.ts) (edit) · [`service.ts`](server/src/modules/agents/service.ts) (edit) · [`routes.ts`](server/src/modules/agents/routes.ts) (edit) · [`constants.ts`](server/src/modules/agents/constants.ts) (edit) · `server/test/agents-promote.test.ts` (new, hermetic)
- **Track:** A
- **Layer:** helpers/service ring 2 · repository ring 3 · routes edge
- **Skills:** (already loaded)
- **Do:**
  - **helpers.ts:**
    - add a pure `planSkillLinks(runSkills, existingSkillIds, currentLinks)`. It returns the new ordered link list and `missing`:
      - the run's skills that still exist, enabled, in run order, at `order` 0…k-1;
      - every other currently linked skill kept but **disabled**, after them, in its prior relative order (Q1 default);
      - the run's skills that no longer exist, as `missing` `{ skill_id, name }` with the name taken from the run record;
    - `toAgentVersionDto` maps `origin` through `AgentVersionOrigin.safeParse`, giving `null` on a malformed value.
  - **repository.ts:** add `promote(workspaceId, agentId, input)` in **one** `db.transaction`:
    - (1) `select … for update` the agent (scoped by workspace); none → `not_found`;
    - (2) read the run header from `t.evalRuns`, scoped by `workspace_id`, `agent_id = agentId`, `kind = 'suite'` **and `owner_kind = 'agent'`**; none → `not_found`. The owner filter keeps a skill run hosted on this agent (its skill set is `[skill]`, not the agent's) from ever being promoted;
    - (3) if `run.agentVersion !== input.from_version` → `invalid('from_version')`;
    - (4) read `agent_versions(agentId, from_version)`; none → `not_found`. If `AgentVersionConfig.safeParse` fails → `unreadable`;
    - (5) if `agent.version !== input.expected_version` → `conflict` (nothing has been written yet);
    - (6) look up which run skill ids still exist in `t.skills` for this workspace, then apply `planSkillLinks` (delete + insert `agent_skills` for this agent);
    - (7) update the agent's provider, model, system_prompt, output_schema, strategy, ci_fail_on and repo_intel from the snapshot, with `version = current + 1`. Name, description and enabled are untouched (Q-1 default);
    - (8) **plain insert** `agent_versions` with `config_json` built from the updated row plus the new linked ids, and `origin = { kind: 'promotion', from_version, eval_run_id, missing_skills }`. A PK conflict throws and rolls back (Rec 4).
    - It never updates or deletes an existing `agent_versions` or `eval_runs` row (NFR-3). It returns a typed result union, not an HTTP error.
  - **service.ts:** `promote()` maps the union:
    - `not_found` → `NotFoundError`;
    - `invalid` → `AppError('promotion_invalid', …, 422, { field })`;
    - `unreadable` → `AppError('agent_version_unreadable', …, 422, { version })`;
    - `conflict` → `AppError('agent_version_conflict', …, 409, { current_version })`.
    - On success it logs `agent promoted` with `{ agentId, fromVersion, newVersion, evalRunId, missingSkills }` via `container.log` (NFR-7), and returns the `Agent` DTO.
  - **routes.ts:** `app.post('/agents/:id/promote', { schema: { params: IdParams, body: AgentPromoteInput } })`. Make no model call (NFR-1).
- **Done when:** `agents-promote.test.ts` covers the following.
  - `planSkillLinks` boundaries:
    - an empty run set (every current link becomes disabled);
    - a run set equal to the current set (order unchanged);
    - one deleted skill (in `missing`, absent from the links);
    - a currently linked skill not in the run (kept, disabled, after the run's skills);
    - the run order differs from the current order (the run order wins).
  - `toAgentVersionDto` with `origin` absent, valid and malformed (→ `null`).
  - The hermetic route table, using the `evals-routes.test.ts` pattern:
    - non-uuid `:id` → 422;
    - extra body key → 422;
    - `from_version: 0` → 422;
    - non-uuid `eval_run_id` → 422.
- **Verify:** `node scripts/verify.mjs server --file server/test/agents-promote.test.ts` then `node scripts/verify.mjs server --checks`

### A5. Integration tests for promotion and run-all (Postgres)
- **Files:** `server/test/agents-promote.it.test.ts` (new) · [`server/test/evals.it.test.ts`](server/test/evals.it.test.ts) (edit)
- **Track:** A
- **Layer:** tests (`*.it.test.ts`, Docker-gated like the existing ones)
- **Skills:** none (convention-only)
- **Do:** run `docker info` first ([server/INSIGHTS.md:143](server/INSIGHTS.md:143)). If Docker is down, report it; do not treat a skip as a pass. Build the app with a stubbed LLM, as the existing `evals.it.test.ts` does.
- **Done when:**
  - `agents-promote.it.test.ts`:
    - **AC-3:** after promoting v1 from a run, the agent's fields equal snapshot v1, the enabled links equal the run's skills in order, and `version` = previous + 1;
    - **AC-4 / NFR-3:** every pre-existing `agent_versions` row is byte-equal before and after. The new row's `origin` names `from_version` and `eval_run_id`. The `eval_runs` row is unchanged;
    - **EC-2:** delete one skill, then promote. The link is absent and `origin.missing_skills` names it;
    - **EC-4:** a stale `expected_version` → 409 `agent_version_conflict`, and the agent row, links and versions are unchanged;
    - **EC-6:** two concurrent identical promotes (`Promise.all`) → exactly one 200, one 409, and exactly one new version;
    - **EC-7:** start a run with a deferred LLM, promote, release. The run's `agent_version` is the pre-promotion version;
    - a run of another agent or another workspace → 404; a run whose `owner_kind` is not `agent` → 404 (insert the row directly, since no route creates one before the sibling lands). `from_version` ≠ the run's version → 422 `promotion_invalid`;
    - **NFR-1:** the stub LLM's call count is unchanged by a promotion.
  - `evals.it.test.ts`:
    - **AC-8:** run-all over one enabled agent, one disabled agent and one already-running agent → `started` / `skipped:disabled` / `skipped:already_running`;
    - **EC-9:** all running → no new `eval_runs` row;
    - `GET …/eval-runs?since=` filters on the boundary;
    - `GET /eval/dashboard` cards carry `enabled`/`running`.
- **Verify:** `node scripts/verify.mjs server --it --file server/test/agents-promote.it.test.ts --file server/test/evals.it.test.ts`

### B1. Hooks: run-all, promote, windowed runs. Fixtures for the new card fields
- **Files:** [`client/src/lib/hooks/evals.ts`](client/src/lib/hooks/evals.ts) (edit) · [`client/src/lib/hooks/agents.ts`](client/src/lib/hooks/agents.ts) (edit) · [`client/src/lib/hooks/evals.test.tsx`](client/src/lib/hooks/evals.test.tsx) (edit) · `client/src/lib/hooks/agents.test.tsx` (new) · [`client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx`](client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx) (edit, fixtures) · any other test whose `EvalAgentCard` fixture now fails typecheck
- **Track:** B
- **Layer:** `src/lib/hooks` over `src/lib/api.ts`
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **Do:**
  - `useAgentEvalRuns(agentId, { since? })`: the key includes `since`, and the URL is `/agents/${id}/eval-runs?since=<ISO>` when set.
  - `useRunAllAgents()`: posts `{}` to `/eval/run-all` and invalidates the evals queries on settle.
  - `useEvalDashboard`: the poll condition becomes "any card `running` or any recent run `running`" (AC-9).
  - `usePromoteAgent(agentId)`: posts `AgentPromoteInput` to `/agents/${id}/promote`. On success it invalidates `["agents"]`, the agent detail key, `["agent-version", agentId]`, `["agent-skills", agentId]` and all eval keys.
  - Add `enabled`/`running` to every `EvalAgentCard` fixture.
- **Done when:**
  - hook tests pin the run-all POST body `{}`, the `since` query string, the dashboard polling while a card is `running`, and the promote invalidations;
  - `client` `typecheck` is green again.
- **Verify:** `node scripts/verify.mjs client --file client/src/lib/hooks/evals.test.tsx --file client/src/lib/hooks/agents.test.tsx` then `node scripts/verify.mjs client --checks`

### B2. Promote `MetricTrendChart` to `components/eval-metrics`: all points, gaps, tooltip
- **Files:** `client/src/app/eval/[agentId]/_components/MetricTrendChart/**` (move →) `client/src/components/eval-metrics/MetricTrendChart/MetricTrendChart.tsx`, `…/MetricTrendChart.test.tsx`, `…/helpers.ts`, `…/helpers.test.ts`, `…/index.ts` (new at destination, old folder deleted) · `client/src/components/eval-metrics/MetricTrendChart/TrendTooltip.tsx` (new, a private sub-part of the chart, tested via `MetricTrendChart.test.tsx`) · [`client/src/components/eval-metrics/index.ts`](client/src/components/eval-metrics/index.ts) (edit) · [`AgentEvalView.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx) + [`AgentEvalView.test.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx) (edit: import path, and the `vi.mock("../MetricTrendChart")` target becomes the new module) · [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit)
- **Track:** B
- **Layer:** shared component (`src/components`), now with two feature consumers
- **Skills:** (already loaded)
- **Do:**
  - Remove `TREND_MAX_POINTS` and the slice. The caller decides the range (the window on the agent page, all runs on the Evals tab).
  - `TrendRow` also carries `ran_at`, `agent_version` and `cost_usd`.
  - Add a recharts `<Tooltip content={<TrendTooltip/>}>` that shows the date (`formatRunDate`), "v{version}" and the cost (`formatCost`, "—" when null).
  - Set `accessibilityLayer` on `LineChart`, so the points are keyboard-focusable and focus shows the same tooltip (AC-15, NFR-5).
  - Keep `connectNulls={false}` (EC-12).
- **Done when:**
  - `helpers.test.ts` covers:
    - 25 points in → 25 rows out (no cap; this is the boundary that was 20);
    - a `null` recall stays `null`, not 0;
    - each row carries the run's version and cost.
  - `MetricTrendChart.test.tsx` renders `TrendTooltip` directly with a payload and asserts the date, "v3" and "—" for a null cost.
  - Nothing under `src/app/eval/[agentId]/_components/MetricTrendChart` remains.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/eval-metrics/MetricTrendChart/helpers.test.ts --file client/src/components/eval-metrics/MetricTrendChart/MetricTrendChart.test.tsx` then `node scripts/verify.mjs client --checks` (a move ⇒ typecheck is the gate, [client/INSIGHTS.md:42](client/INSIGHTS.md:42))

### B3. Evals-tab trend (AC-14, AC-15, EC-12)
- **Files:** [`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx`](client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx) (edit) · [`EvalsTab.test.tsx`](client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx) (edit) · [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit)
- **Track:** B
- **Layer:** feature component
- **Skills:** (already loaded)
- **Do:** under the tiles, render a "Metric trend" section with `<MetricTrendChart trend={dashboard.trend} />`. That is every completed suite run (the server's `kind = 'suite'` filter excludes single-case runs), chronological. Reuse the `dashboard.metricTrend` key.
- **Done when:** with the chart module mocked, the test asserts the chart receives all N trend points of a fixture with N = 25 (no truncation), in `ran_at` order.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx"`

### B4. Agent page: window, switcher, Run eval, current version, URL state, EC-10/EC-11
- **Files:**
  - [`client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.tsx) (edit) · [`AgentEvalView.test.tsx`](client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx) (edit)
  - `client/src/app/eval/[agentId]/_components/AgentEvalView/helpers.ts` + `helpers.test.ts` (new)
  - `client/src/app/eval/[agentId]/_components/WindowSelect/WindowSelect.tsx` + `WindowSelect.test.tsx` + `index.ts` (new)
  - `client/src/app/eval/[agentId]/_components/AgentSwitcher/AgentSwitcher.tsx` + `AgentSwitcher.test.tsx` + `index.ts` (new)
  - [`EvalRunsTable.tsx`](client/src/app/eval/[agentId]/_components/EvalRunsTable/EvalRunsTable.tsx) + test (edit)
  - [`client/src/app/eval/page.tsx`](client/src/app/eval/page.tsx) (edit) · [`EvalDashboardView.tsx`](client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx) (edit: `notice` prop)
  - [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit)
- **Track:** B
- **Layer:** feature components under `app/eval/[agentId]`. The landing page (`page.tsx`, a server component) reads `searchParams` and passes the notice as a prop, so the client view needs no `useSearchParams` and no Suspense boundary.
- **Skills:** (already loaded)
- **Do:**
  - **helpers.ts:** `parseWindow(raw)` returns one of `'7d' | '30d' | '90d' | 'all'` and falls back to `'30d'` for anything else (R37). `sinceFor(window, now)` returns an ISO string, or `undefined` for `all`.
  - **Window (AC-10):**
    - `AgentEvalView` reads `?window=` with `useSearchParams` (the dynamic-route precedent is `client/src/app/agents/[id]/page.tsx:19-31`);
    - a change calls `router.replace` with the new `window` (precedent `agents/[id]/page.tsx:31`);
    - the runs table uses `useAgentEvalRuns(agentId, { since })`;
    - the trend is `dashboard.trend.filter(p => !since || p.ran_at >= since)` (Rec 1);
    - tiles and `RegressionBanner` keep reading the unfiltered `dashboard` (AC-11).
  - **Switcher (AC-12):**
    - a `SelectInput` from `@devdigest/ui` with an accessible label, listing `useEvalDashboard().agents` (agents with ≥ 1 case);
    - picking one calls `router.push(`/eval/${id}?window=${window}`)`. Using `push` makes Back return to the previous agent (AC-13);
    - `EvalRunsTable` gets `key={agentId}`, so its selection resets.
  - **Run eval (AC-6):** a header button using `useStartEvalRun(agentId)`, with the same disabled/loading/409 handling as `EvalsTab.tsx:153-158`.
  - **Current version (AC-5):** a header line "Current version v{version}" from `useAgent(agentId)`.
  - **EC-10:** when the windowed runs and the windowed trend are empty, show one empty state in place of the table and trend. It offers a "Show all runs" button that sets `window=all`, and the tiles still render.
  - **EC-11:** once the workspace dashboard has loaded, if `agentId` is not in `agents`, call `router.replace('/eval?notice=agent_not_found')`. The same applies to a non-uuid id (the agent dashboard's 422/404 is not shown as an error).
    - `client/src/app/eval/page.tsx` reads `searchParams.notice` (an async prop, Next 15) and passes `notice` to `EvalDashboardView`;
    - `EvalDashboardView` renders it with `role="status"`. Any value other than `agent_not_found` is ignored.
  - **Literal copy (add to `eval.json`):**
    - "Run eval";
    - window options "7 days", "30 days", "90 days", "All";
    - the window label "Time window";
    - the switcher label "Agent";
    - "Current version v{version}";
    - the EC-10 empty state "No runs in this time window." with the button "Show all runs";
    - the EC-11 notice "That agent was not found or has no eval cases.".
- **Done when:**
  - `helpers.test.ts`: `parseWindow` covers `'7d'`, `'all'`, `'30D'` (case variant → `'30d'` fallback), `'14d'` (near-miss → fallback), `''` and `null`. `sinceFor('7d', fixedNow)` is exactly 7×24 h earlier, and `sinceFor('all')` is `undefined`.
  - `AgentEvalView.test.tsx`, with the hooks and `next/navigation` mocked:
    - with no `window`, the runs hook is called with a 30-day `since`;
    - a trend point exactly at `since` is kept and one 1 ms earlier is dropped;
    - the tiles get the unfiltered dashboard;
    - an empty window shows "No runs in this time window." with tiles present, and "Show all runs" calls `router.replace` with `window=all`;
    - an unknown agent id calls `router.replace('/eval?notice=agent_not_found')`;
    - "Run eval" calls the start mutation;
    - "Current version v5" renders.
  - `AgentSwitcher.test.tsx`: it lists the cards' agents by name, picking one pushes `/eval/<id>?window=7d` when the window is `7d`, and it is reachable by keyboard with the accessible name "Agent".
  - `WindowSelect.test.tsx`: four options with the exact labels, and `onChange` receives the key.
  - `EvalDashboardView.test.tsx`: `notice="agent_not_found"` renders the notice text.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/eval/[agentId]/_components/AgentEvalView/helpers.test.ts" --file "client/src/app/eval/[agentId]/_components/AgentEvalView/AgentEvalView.test.tsx" --file "client/src/app/eval/[agentId]/_components/AgentSwitcher/AgentSwitcher.test.tsx" --file "client/src/app/eval/[agentId]/_components/WindowSelect/WindowSelect.test.tsx" --file client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx`

### B5. "Run all agents" on the landing page (AC-7, AC-8 display, AC-9, EC-8)
- **Files:** [`EvalDashboardView.tsx`](client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.tsx) + test (edit) · `client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/RunAllAgentsModal.tsx` + `RunAllAgentsModal.test.tsx` + `helpers.ts` + `index.ts` (new) · [`AgentEvalCard.tsx`](client/src/app/eval/_components/EvalDashboardView/_components/AgentEvalCard/AgentEvalCard.tsx) (edit) + `AgentEvalCard.test.tsx` (new) · [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit)
- **Track:** B
- **Layer:** feature components
- **Skills:** (already loaded)
- **Do:**
  - `helpers.ts`: `runAllSummary(cards)` returns:
    - `eligible` (`enabled && cases_total > 0`);
    - `calls` = the sum of `cases_total`;
    - `estimate` = the sum of each eligible card's known `latest?.cost_usd`, `null` when none is known;
    - `unknownCount` = eligible cards whose latest cost is null or that have no latest run (Q2 default).
  - **Button:** "Run all agents" opens `RunAllAgentsModal`, built on `Modal`. Its body wrapper has `padding: 24` ([client/INSIGHTS.md:48](client/INSIGHTS.md:48)).
  - **Confirmation view:** one row per eligible agent with "{n} cases" and that agent's latest cost ("—" when unknown), then the total line "{calls} paid review calls · estimated {cost}". When `unknownCount > 0` it adds "{n} agents have no cost estimate".
  - **Confirm:** confirming calls `useRunAllAgents()`. The modal then switches to an outcome list, one text line per agent: "{agent}: started" or "{agent}: skipped — {reason}". The reasons are "already running", "no cases" and "disabled", so the outcome is text, not colour (NFR-5). A 409 `eval_run_all_in_progress` shows "Another run of all agents is still starting.".
  - **EC-8:** with no eligible agent, the button is disabled and the helper text reads "No enabled agent has eval cases.".
  - **AC-9:** `AgentEvalCard` shows a "Running" badge, with text, while `card.running`.
- **Done when:**
  - `helpers.test.ts` covers mixed cards: disabled excluded, a zero-case card excluded, a null cost counted in `unknownCount` and not as 0, and all costs unknown → `estimate` null.
  - `RunAllAgentsModal.test.tsx` covers:
    - the confirmation lists each eligible agent with its case count and "—";
    - the total calls value;
    - confirm → the outcome lines render the three reasons as text;
    - Escape/Cancel closes without calling the mutation.
  - `EvalDashboardView.test.tsx`: EC-8 disabled with the reason text.
  - `AgentEvalCard.test.tsx`: `running: true` shows "Running".
- **Verify:** `node scripts/verify.mjs client --file client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/RunAllAgentsModal.test.tsx --file client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/helpers.test.ts --file client/src/app/eval/_components/EvalDashboardView/_components/AgentEvalCard/AgentEvalCard.test.tsx --file client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx`

### B6. "Promote vX" in Compare (AC-1, AC-2, AC-5, EC-1, EC-2/EC-3 display, EC-4 display, EC-5)
- **Files:** [`CompareRunsModal.tsx`](client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.tsx) + [`CompareRunsModal.test.tsx`](client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.test.tsx) (edit) · `client/src/app/eval/[agentId]/_components/CompareRunsModal/helpers.ts` + `helpers.test.ts` (new) · `client/src/app/eval/[agentId]/_components/CompareRunsModal/_components/PromoteConfirm/PromoteConfirm.tsx` + `PromoteConfirm.test.tsx` + `index.ts` (new) · [`client/messages/en/eval.json`](client/messages/en/eval.json), [`client/messages/en/agents.json`](client/messages/en/agents.json) (edit)
- **Track:** B
- **Layer:** feature components. The pure diff goes in the modal's `helpers.ts`.
- **Skills:** (already loaded)
- **Do:**
  - **`promotionDiff(snapshot, run, agent, links, skills)`** (pure) returns:
    - `fieldChanges`: each of provider, model, system_prompt (changed or not, no inline diff), output_schema, strategy, ci_fail_on and repo_intel where the snapshot ≠ the current agent;
    - `skillChanges`: added, removed or reordered relative to the current effective set (enabled links ∧ `skill.enabled`, by `order`, the same rule as [skills/repository.ts:220-227](server/src/modules/skills/repository.ts:220));
    - `missing`: run skills no longer in `useSkills()`;
    - `versionDrift`: a run skill whose current `version` ≠ the recorded `version`;
    - `same`: true when there are no field or skill changes.
  - **Footer:** one button per run, labelled "Promote v{version}":
    - disabled with "Current configuration" when `same` (EC-1);
    - disabled with "Version v{version} cannot be read" when `useAgentVersion` errors (EC-5). The metric table stays rendered.
  - **Confirmation:** activating a button opens `PromoteConfirm`, which lists the field changes (field names from `agents.json`), the skill changes, "Missing skills: {names} — they will not be restored" (EC-2), and for each drift "Only the link to {skill} is restored, not its text (v{then} → v{now})" (EC-3).
  - **Confirm:** confirming calls `usePromoteAgent` with `{ from_version: run.agent_version, eval_run_id: run.id, expected_version: agent.version }`. `agent.version` is captured when the modal opened; do not re-read it at confirm time. The confirm button is disabled while pending (EC-6, client half).
  - **Success (AC-5):** close Compare and show the toast "Promoted — now v{version}" via `useToast`. The page's version line (B4) updates through invalidation.
  - **409 (EC-4):** show the inline alert "This agent changed since you opened Compare. Reload to see its current version." Nothing else changes.
- **Done when:**
  - `helpers.test.ts` covers:
    - an identical config → `same: true`;
    - only the order of two skills differs → reorder, `same: false`;
    - a globally disabled skill in the current links is not counted as current;
    - a deleted skill → `missing`;
    - a version 3 → 4 skill → drift;
    - an `output_schema` deep-equal but a different object → no change.
  - `CompareRunsModal.test.tsx` covers:
    - two buttons "Promote v2"/"Promote v5";
    - EC-1 disabled with "Current configuration";
    - EC-5 disabled with its reason while the delta rows still render;
    - confirm → the mutation is called with the captured `expected_version`;
    - success → `onClose` called and the toast text contains "v6";
    - 409 → the reload message renders.
  - `PromoteConfirm.test.tsx`: it lists field and skill changes, the missing-skill line and the drift line, and is keyboard-operable (Tab to Confirm, Enter).
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/helpers.test.ts" --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/CompareRunsModal.test.tsx" --file "client/src/app/eval/[agentId]/_components/CompareRunsModal/_components/PromoteConfirm/PromoteConfirm.test.tsx"` then `node scripts/verify.mjs client --checks`

### I1. Eval seed + e2e flow for AC-13 / EC-11 (Integration)
- **Files:** `server/src/db/seed-eval.ts` (new) · [`server/src/db/seed.ts`](server/src/db/seed.ts) (edit: one call after `seedBrief`, `:336`) · `e2e/specs/17-eval-run-controls.flow.json` (new) · [`e2e/README.md`](e2e/README.md) (edit: flow table row)
- **Track:** shared
- **Layer:** ring 3 (`db/**`), following the `seed-brief.ts` precedent
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`
- **Do:**
  - **Seed:** for "General Reviewer" and "Security Reviewer":
    - ensure an `agent_versions` row exists for the agent's current version, built from the agent row (`onConflictDoNothing`, Rec 6);
    - insert two `source: 'manual'` eval cases (small frozen diff, `must_find` + `must_not_flag`);
    - insert four `completed` suite runs started 60, 20, 3 and 1 days before now, with fixed metrics, one `null` precision (EC-12 gap) and one `null` cost.
  - The seed is idempotent: skip an agent that already owns eval cases.
  - **Flow:** it never clicks Run, Run all, Promote or Compare. Steps:
    - open `/eval` → click the "General Reviewer" card → wait for the URL `/eval/`;
    - pick "7 days" → the URL contains `window=7d`;
    - `reload` → "7 days" is still selected and the table shows 2 runs;
    - switch the agent to "Security Reviewer" → the URL changes and keeps `window=7d`;
    - `back` → "General Reviewer" with `window=7d`;
    - open `/eval/00000000-0000-4000-8000-000000000000` → the URL becomes `/eval?notice=agent_not_found`, and the text "That agent was not found or has no eval cases." is visible.
- **Done when:** `pnpm db:seed` run twice leaves exactly 4 cases and 8 runs, and the flow passes in the hermetic runner.
- **Verify:** `node scripts/verify.mjs e2e --checks` (the flow itself runs in I2)

### I2. Docs + the one full run (Integration)
- **Files:**
  - [`server/src/modules/evals/README.md`](server/src/modules/evals/README.md) (edit):
    - the route table gains `POST /eval/run-all` and `?since=`;
    - the status table gains `409 eval_run_all_in_progress`;
    - "Time and width" names the 6-wide batch limiter and the timer-after-slot rule.
  - [`server/README.md`](server/README.md) (edit): the agents route list gains `POST /agents/:id/promote`, its error codes and `agent_versions.origin`.
  - [`client/README.md`](client/README.md) (edit): the Eval section covers the window, the switcher, Run all agents, Promote and the Evals-tab trend.
- **Track:** shared
- **Done when:** every check below is green, and the e2e run includes flow `17-eval-run-controls`.
- **Verify:** `node scripts/verify.mjs server client` · `node scripts/verify.mjs server --it` (after `docker info`) · `./scripts/e2e.sh`

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic: contracts (step 0), limiter + run-all + since + cards (A1–A2: AC-8, EC-9, NFR-1, NFR-2), `planSkillLinks` + promote validation (A4: R35, R36) |
| server | `node scripts/verify.mjs server --it` | `agents-promote.it.test.ts` (AC-3, AC-4, EC-2, EC-4, EC-6, EC-7, NFR-1, NFR-3, NFR-7 by log spy) · `evals.it.test.ts` (AC-8, EC-9, `since`, cards). Needs Docker; check `docker info` first |
| client | `node scripts/verify.mjs client` | lint · typecheck · hooks (B1) · trend/tooltip (B2: AC-15, EC-12) · Evals tab (B3: AC-14) · agent page (B4: AC-5, AC-6, AC-10, AC-11, AC-12, EC-10, EC-11, R37) · run-all (B5: AC-7, AC-9, EC-8, NFR-5) · promote (B6: AC-1, AC-2, AC-5, EC-1, EC-3, EC-4 display, EC-5) · contract sync (NFR-6) |
| e2e | `./scripts/e2e.sh` | flow 17: AC-13 reload + Back, EC-11 notice |
| static | the gate (`/pr-self-review`) | NFR-4 (no hardcoded strings), NFR-6 `shared-drift` |

## Risks & rollback
- **The step-0 contract makes both packages' typecheck red until A1/B1.** Each track's first step fixes its own package. A track that verifies `--checks` before that step will see a red it did not cause. · Rollback: revert step 0's `EvalAgentCard` edit in both copies.
- **Queued cases timing out.** If the limiter is acquired inside `reviewWithTimeout`, cases recorded as `errored: timeout` show up in batches larger than 6 cases. Test A2(b) pins this. · Rollback: drop the `limiter` option; `runAll` then degrades to per-run width 3 (violates NFR-2).
- **Promotion transaction locks the agent row** for the length of a few small queries. A concurrent `PUT /agents/:id` waits rather than interleaving. This is intended (EC-4). · Rollback: revert A4. The migration in A3 is additive and harmless on its own.
- **Moving `MetricTrendChart`.** Existing tests mock it by relative path (`AgentEvalView.test.tsx:10`). A stale mock path makes recharts render in jsdom and fail. B2 updates the mock. `--checks` is the gate after the move.
- **Two `--file` scoped tracks in one repo, but different packages.** Server and client typecheck are independent, so there is no cross-track red.
- **Trend reads at most 500 completed runs** ([evals/README.md, Known limits](server/src/modules/evals/README.md)). "All" on the Evals tab means "the last ≤ 500". This is unchanged and documented.
- **A skill that is globally disabled now but in the run's set** is restored as an enabled link that does not take effect, because `blocksForAgent` also requires `skills.enabled`. The confirmation does not call this out (the spec does not ask). See Open questions.

## Out of scope
- An agent version-history UI in `client/`. The origin is exposed through `GET /agents/:id/versions` only (Q4).
- Restoring skill text, spend caps, scheduling, thresholds on the trend, and the Stats/CI tabs (the spec's Non-goals).
- Server-side rejection of an identical promotion (Rec 8, not adopted).
- Paginating the runs table beyond the parent's 20 newest within the window (Q3).
- Any change to `client/src/vendor/ui/**`, `reviewer-core/**` or applied migrations.
- In multi-agent mode, no track edits a file owned by another track.
- Writing or amending the spec. Gaps go back to `spec-creator` or the user, as Open questions.
- Architectural review and security review. Separate agents own those.
- Opening or pushing a PR. `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking (Q1, AC-3):** Skills linked now but absent from the run's set: keep them linked but disabled, or unlink them? — the user · **default taken: keep them linked, disabled, after the run's skills** (non-destructive, reversible from the Skills tab).
- **Non-blocking (Q2, AC-7):** The estimated total when some eligible agents have no known cost: sum the known costs and state "{n} agents have no cost estimate", or show "—" for the whole total? — the user · **default taken: sum the known costs plus the count of unknowns; the total is "—" only when none is known.** Unknown is never 0 ([INSIGHTS.md:287](INSIGHTS.md:287)).
- **Non-blocking (Q3, AC-10):** Does the window filter on run start (`started_at`) or finish, and does the table keep the parent's 20-newest cap inside the window? — the user · **default taken: start time (indexed `ran_at`, so a running run shows in its window); 20-row cap kept (parent AC-12).**
- **Non-blocking (Q4, AC-4):** Where is the promotion's "history entry" shown? No agent version-history screen exists. — the user · **default taken: API only (`AgentVersion.origin`); a UI is a follow-up.**
- **Non-blocking (Q5, NFR-2):** Is "a second Run all agents while a batch is still starting" scoped to the start loop, or to the whole batch while any of its runs is still running? — the user · **default taken: the start loop only (in-process flag). Per-agent 409 isolation already covers the running phase.**
- **Non-blocking:** Should the Promote confirmation warn when a restored skill is now globally disabled (it would not take effect)? — the user · **default taken: no warning** (not in the spec); listed in Risks.
