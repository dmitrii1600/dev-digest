# Spec: Eval run controls and history views — Promote vN, Run all agents, time window, agent switcher, Evals-tab trend
Spec ID: SPEC-2026-10-05-eval-run-controls
Status: approved
Supersedes: none
Packages: server, client

## Problem and user
This spec is a sibling of `SPEC-2026-10-05-eval-pipeline` (the parent). The parent defines eval cases, suite runs, matching, metrics, the Eval Dashboard and the Compare modal, and this spec builds on those definitions without restating them. With only the parent built, an agent author who sees in Compare that an older version scored better must re-type that version's prompt and settings by hand to get it back. Measuring every agent after a shared change (a model swap, a skill edit) means opening each agent in turn. The per-agent dashboard page lists every run since the beginning, with no way to narrow it to recent history or to jump to another agent. The Evals tab also shows only the latest numbers, so the author cannot watch how the agent moves over time ("CI-as-trend") without leaving the editor. The user pulled these design extras into this lesson (parent Q-4, resolved 2026-10-05). A course stretch task added the Evals-tab trend.
**Request vs tree:** These points differ from what the request assumes:
- Agents have no restore action (`server/src/modules/agents/routes.ts:31-40`). Skills do: `POST /skills/:id/restore` appends version max+1 from a past one (`server/src/modules/skills/routes.ts:26`, `:145`). That is the precedent for "restore = new version".
- An `agent_versions` snapshot cannot by itself restore the skill set:
  - Its `skills` field is the list of linked skill ids, disabled ones included, with no enabled flag (`server/src/modules/agents/repository.ts:149-168`, `:203-206`; `AgentVersionConfig` in `server/src/vendor/shared/contracts/knowledge.ts:476-485`).
  - It is not refreshed when links change (`server/src/modules/agents/repository.ts:251`).
  - The skill set recorded on the eval run (parent AC-9) is the faithful source.
- A version row has no field recording where it came from (`server/src/db/schema/agents.ts:52-63`).
- The vendored `LineChart` takes `data: number[]` per series (`client/src/vendor/ui/charts/LineChart.tsx:12-15`). It cannot express a missing point, and `src/vendor/ui` is do-not-touch apart from `nav.ts` (`client/AGENTS.md`, Do not touch).

## Goals / Non-goals
**Goals**
- From Compare, restore an agent to the configuration that produced a run, as a new version, never rewriting history.
- Start a suite run for every enabled agent in one action, after seeing how many paid review calls it will make.
- Narrow the per-agent dashboard to a time window and switch between agents without going back to the landing page.
- Show the metric trend across all suite runs on the AgentEditor Evals tab as well as on the dashboard.
**Non-goals**
- Restoring a skill's own text. Skill bodies are versioned by the skills module and restored there (`server/src/modules/skills/routes.ts:26`).
- A spend cap or budget enforcement for Run all agents (Q-4).
- Scheduling eval runs.
- Metric thresholds or pass/fail gates on the trend (course stretch task: dynamics first, thresholds later).
- The AgentEditor Stats and CI tabs (parent Non-goals).

## User stories
- **US-1** As an agent author, I want to promote the version behind a better-scoring run, so that I can roll back a regression in one step.
- **US-2** As an agent author, I want to run every agent's eval set at once and see the cost first, so that I can measure a shared change across agents.
- **US-3** As an agent author, I want to limit the runs table and trend to a recent time window, so that old runs do not hide the current trend.
- **US-4** As an agent author, I want to switch agents on the dashboard page, so that I can compare agents without navigating back.
- **US-5** As an agent author, I want the metric trend on the agent's Evals tab, so that I can see how the agent develops while I edit it.

## Acceptance criteria (EARS)
- **AC-1** WHILE the Compare modal shows two runs, it shall offer "Promote vX" for each run whose recorded configuration differs from the agent's current configuration. The configuration is the agent-version fields plus the enabled skill set. · traces: US-1, DR-1 · verify: component
- **AC-2** WHEN the user activates "Promote vX", the system shall ask for confirmation. The confirmation lists each configuration field and each skill-set change that the promotion would apply. · traces: US-1 · verify: component
- **AC-3** WHEN the user confirms a promotion, the system shall set the agent's prompt, provider, model, strategy, output schema, CI policy and repo-intel flag to the values in snapshot vX. It shall set the agent's linked enabled skills and their order to the set recorded on the promoted run, and record the result as a new version (current + 1). · traces: US-1, DR-1, DR-2 · verify: integration
- **AC-4** WHEN a promotion is recorded, the existing versions 1 … current shall stay unchanged. The new version's history entry shall state that it was promoted from vX and from which eval run. · traces: US-1, DR-3 · verify: integration
- **AC-5** WHEN a promotion completes, the modal shall close and a confirmation shall name the new version number. The page shall show that version as the agent's current version. · traces: US-1 · verify: component
- **AC-6** WHEN the user activates "Run eval" on an agent's dashboard page, the system shall start a suite run exactly as the parent's "Run all evals" does (parent AC-6). · traces: US-2 · verify: component
- **AC-7** WHEN the user activates "Run all agents" on the dashboard landing, the system shall show a confirmation that lists each eligible agent (enabled, at least one case) with its case count. It shall show the total number of paid review calls, and an estimated cost summed from each agent's latest suite-run cost, with "—" for agents never run. · traces: US-2, DR-4 · verify: component
- **AC-8** WHEN the user confirms "Run all agents", the system shall try to start one suite run per eligible agent. It shall report one outcome per agent: started, or skipped with a reason (already running, no cases, disabled). A skipped agent shall not stop the others from starting. · traces: US-2, DR-4, DR-8 · verify: integration
- **AC-9** WHILE a suite run started by "Run all agents" is running, the landing page shall show that agent's card as running until the run completes. · traces: US-2 · verify: component
- **AC-10** The agent's dashboard page shall offer a time window of 7 days, 30 days, 90 days or all, defaulting to 30 days. It shall limit the runs table and the trend chart to suite runs completed inside the window. · traces: US-3 · verify: component
- **AC-11** The metric tiles and the regression banner shall always reflect the agent's latest two suite runs, whatever the selected window. · traces: US-3 · verify: component
- **AC-12** The agent's dashboard page shall offer an agent switcher that lists every agent with at least one case. WHEN the user picks an agent, the page shall show that agent's dashboard, clear the run selection and keep the selected window. · traces: US-4 · verify: component
- **AC-13** WHEN the user reloads the page or navigates Back, the agent's dashboard page shall restore the selected agent and window from the URL. · traces: US-3, US-4 · verify: e2e
- **AC-14** The AgentEditor Evals tab shall plot recall, precision and citation accuracy across all of the agent's suite runs, one point per run in chronological order. Single-case runs shall be excluded. · traces: US-5, DR-12 · verify: component
- **AC-15** WHEN the user hovers over or focuses a point on the Evals-tab trend, the chart shall show that run's date, agent version and cost, with "—" for an unknown cost. · traces: US-5 · verify: component

## Edge cases
- **EC-1** IF a compared run's recorded configuration equals the agent's current configuration, THEN its Promote action shall be disabled and labelled as the current configuration. · traces: DR-5 · verify: component
- **EC-2** IF a skill in the promoted run's set has since been deleted, THEN the confirmation shall name the missing skills. Confirming shall promote without them, and the new version's history entry shall list them as missing. · traces: DR-6 · verify: integration
- **EC-3** IF a skill in the promoted run's set has a different skill version now than when the run was recorded, THEN the confirmation shall warn that only the link is restored, not the skill text, and name the skill with both versions. · traces: DR-11 · verify: component
- **EC-4** IF the agent's current version changed after the Compare modal was opened, THEN the promotion shall be rejected with 409. Nothing shall change, and the modal shall ask the user to reload. · traces: DR-7 · verify: integration
- **EC-5** IF snapshot vX cannot be read, THEN "Promote vX" shall be disabled with a reason, and the metric deltas shall stay visible. · traces: DR-5 · verify: component
- **EC-6** IF the user confirms the same promotion twice (double submit), THEN the system shall record exactly one new version. · traces: DR-7 · verify: integration
- **EC-7** IF a suite run of the agent is running when a promotion is recorded, THEN that run shall stay recorded against the version it started with. · traces: DR-7 · verify: integration
- **EC-8** IF no agent is eligible, THEN "Run all agents" shall be disabled and say why. · traces: DR-8 · verify: component
- **EC-9** IF every eligible agent already has a running suite run, THEN "Run all agents" shall start no run and report every agent as skipped. · traces: DR-8 · verify: integration
- **EC-10** IF no suite run falls inside the selected window, THEN the runs table and trend shall show an empty state that offers a wider window. The tiles shall keep showing the latest runs. · traces: DR-9 · verify: component
- **EC-11** IF the URL names an agent that does not exist in the workspace or has no case, THEN the page shall show the dashboard landing with a notice. · traces: DR-10 · verify: component
- **EC-12** IF a run's metric is not available ("—", parent EC-8), THEN every trend chart shall leave a gap in that metric's line at that run, never plot it as 0. · traces: DR-12 · verify: component

## Design review
**Source:** specs/designs/eval-pipeline/02-eval-dashboard-all-agents.png, 03-eval-dashboard-agent-runs.webp, 04-compare-runs-modal.webp, compared against the tree.
### Gaps
- **DR-1** Restoring an agent version: there is no agent restore route (`server/src/modules/agents/routes.ts:31-40`).
- **DR-2** The snapshot's `skills` holds linked ids without enabled flags, and it does not move on link changes (`server/src/modules/agents/repository.ts:149-168`, `:251`). The promotion takes the skill set from the eval run instead.
- **DR-3** No origin field on a version (`server/src/db/schema/agents.ts:52-63`).
- **DR-4** Nothing starts eval runs for several agents in one request. The parent defines only `POST /agents/:id/eval-runs`.
### Uncovered cases
- **DR-5** Design 04 always offers "Promote v7"; promoting the current configuration, or a version whose snapshot is unreadable, is not shown → EC-1, EC-5.
- **DR-6** A skill deleted since the run → EC-2.
- **DR-7** A concurrent agent edit, a double submit, or a run in flight during promotion → EC-4, EC-6, EC-7.
- **DR-8** Design 02 shows no confirmation, no per-agent outcome, and no "already running" case for Run all agents → AC-8, EC-8, EC-9.
- **DR-9** The "30 days" control has no empty-window state → EC-10.
- **DR-10** A stale or foreign agent id in the URL → EC-11.
- **DR-11** A skill's text changed since the run, so a promotion cannot restore it → EC-3.
- **DR-12** A trend with a missing metric: the vendored chart takes only numbers (`client/src/vendor/ui/charts/LineChart.tsx:15`), and the designs show no gap → EC-12, AC-14.
### Module interactions
| From | To | Through | Contract |
|---|---|---|---|
| `client` Compare modal | `server` `modules/agents` | `POST /agents/:id/promote` (from version, from eval run, expected current version) | `AgentPromoteInput` / `Agent` in server/src/vendor/shared/contracts/knowledge.ts · new / existing |
| `client` Compare modal | `server` `modules/agents` | `GET /agents/:id/versions` · `GET /agents/:id/versions/:version` | `AgentVersion` · existing, extended with origin |
| `server` `modules/agents` | `server` `modules/evals` | in-process read of the promoted run's recorded skill set | `EvalSuiteRun` (parent) · new |
| `client` Eval Dashboard landing | `server` `modules/evals` | `POST /eval/run-all` | `EvalRunAllResult` (per-agent outcome) in server/src/vendor/shared/contracts/eval-ci.ts · new |
| `client` agent dashboard page, Evals tab trend | `server` `modules/evals` | `GET /agents/:id/eval-runs?since=…` | `EvalSuiteRun` (parent) · new |
### UX improvements
- **DR-13** *proposed* The window offers 7 / 90 days / all in addition to the design's single "30 days" control → AC-10, Q-3.

## Non-functional requirements
- **NFR-1** Cost: "Run all agents" makes exactly one review call per case of each started agent and no other model call. Promotion makes no model call. · verify: integration
- **NFR-2** Concurrency: across all suite runs started by one "Run all agents", at most 6 review calls are in flight at once. A second "Run all agents" while a batch is still starting is rejected with 409. · verify: integration
- **NFR-3** History immutability: no action in this spec updates or deletes an existing `agent_versions` entry or an eval run. · verify: integration
- **NFR-4** i18n: every new string is read from `messages/en/eval.json` (or `agents.json` for agent-version text), with no literals in components. · verify: static
- **NFR-5** Accessibility: the confirmations, the window selector and the agent switcher are operable by keyboard, with accessible names. Each per-agent outcome is stated in text, not colour alone. · verify: component
- **NFR-6** Contract parity: every contract added or changed here is mirrored in the client copy of `@devdigest/shared` in the same change. · verify: static
- **NFR-7** Observability: each promotion logs the agent, the from-version, the new version and the source eval run. Each "Run all agents" logs each agent's outcome. · verify: integration

## Traceability
| Requirement | Traces to | Verify how |
|---|---|---|
| AC-1 | US-1, DR-1 | component |
| AC-2 | US-1 | component |
| AC-3 | US-1, DR-1, DR-2 | integration |
| AC-4 | US-1, DR-3 | integration |
| AC-5 | US-1 | component |
| AC-6 | US-2 | component |
| AC-7 | US-2, DR-4 | component |
| AC-8 | US-2, DR-4, DR-8 | integration |
| AC-9 | US-2 | component |
| AC-10 | US-3, DR-13 | component |
| AC-11 | US-3 | component |
| AC-12 | US-4 | component |
| AC-13 | US-3, US-4 | e2e |
| AC-14 | US-5, DR-12 | component |
| AC-15 | US-5 | component |
| EC-1 | DR-5 | component |
| EC-2 | DR-6 | integration |
| EC-3 | DR-11 | component |
| EC-4 | DR-7 | integration |
| EC-5 | DR-5 | component |
| EC-6 | DR-7 | integration |
| EC-7 | DR-7 | integration |
| EC-8 | DR-8 | component |
| EC-9 | DR-8 | integration |
| EC-10 | DR-9 | component |
| EC-11 | DR-10 | component |
| EC-12 | DR-12 | component |
| NFR-1 | US-2 | integration |
| NFR-2 | US-2 | integration |
| NFR-3 | US-1 | integration |
| NFR-4 | US-1, US-2 | static |
| NFR-5 | US-3, US-4 | component |
| NFR-6 | US-1, US-2 | static |
| NFR-7 | US-1, US-2 | integration |

## Inputs and provenance
| Source | Path or URL | What it settled |
|---|---|---|
| request | Course brief L06 "Eval Pipeline for DevDigest", via the parent spec | Comparability of runs; the "old prompt vs new" comparison |
| answers | user via coordinator, 2026-10-05: "pull ALL deferred design extras into this lesson's scope" | Promote vN restores a snapshot as a new version, never rewriting history. Run all agents gets per-agent 409 isolation and a cost-exposure confirmation. A time-window filter and an agent switcher are added. |
| request | course stretch task "metric trend chart" (L06), relayed by the coordinator 2026-10-05 | Evals-tab trend across suite runs; one point = one run; the tooltip shows prompt version and cost; single-case runs excluded; "—" is a gap; thresholds out of scope |
| design | specs/designs/eval-pipeline/04-compare-runs-modal.webp | "Promote v7" in the Compare footer |
| design | specs/designs/eval-pipeline/02-eval-dashboard-all-agents.png | "Run all agents" on the landing page |
| design | specs/designs/eval-pipeline/03-eval-dashboard-agent-runs.webp | Agent switcher, "30 days", "Run eval" |
| repo | server/src/modules/agents/routes.ts:31-40; repository.ts:110-168, :203-206, :251 | No restore route; snapshot and skill-link behaviour |
| repo | server/src/modules/skills/routes.ts:26, :145 | Precedent for restore = new version |
| repo | server/src/vendor/shared/contracts/knowledge.ts:476-485; server/src/db/schema/agents.ts:52-63 | Snapshot fields; no origin column |
| insights | INSIGHTS.md:286-291 | Mirror contract changes into both shared copies → NFR-6 |
| insights | server/INSIGHTS.md:52-62 | A table with a companion history must write its history on every path → AC-4, NFR-3 |
| insights | server/INSIGHTS.md:393-396 | Transport retries multiply calls → NFR-1 |

## Untrusted inputs
| Input | Source | Validation | On invalid |
|---|---|---|---|
| `:id` agent, from-version, eval-run id, expected current version | Promote request | Shape: uuid and positive integers in a strict body. Identity: the run belongs to this agent and workspace, and its version exists | 422 naming the field; 404 for an unknown or foreign id; 409 on a version mismatch (EC-4) |
| Run-all request | HTTP body | Shape: strict object with no fields | 422 |
| `since` / window and agent id | URL query | Window is one of `7d`, `30d`, `90d`, `all`; the agent id is a uuid in this workspace | Fall back to `30d`; landing with a notice (EC-11) |

## Open questions
- **Q-1 (non-blocking):** Which fields does Promote restore? Default: every agent-version field (prompt, provider, model, strategy, output schema, CI policy, repo intel) plus the run's enabled skill set and order. Name, description and the enabled toggle stay as they are. — the user decides
- **Q-2 (non-blocking):** Promoting when a skill of the run's set was deleted: proceed without it after a warning (default, EC-2), or block? — the user decides
- **Q-3 (non-blocking):** Window options: 7 / 30 / 90 days / all with 30 as the default (DR-13), or only the design's 30 days? — the user decides
- **Q-4 (non-blocking):** Should "Run all agents" have a spend cap beyond the confirmation? Default: no cap; the confirmation shows the call count and the estimated cost. — the user decides
