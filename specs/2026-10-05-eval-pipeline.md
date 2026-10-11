# Spec: Eval Pipeline — product-level regression harness for reviewer agents
Spec ID: SPEC-2026-10-05-eval-pipeline
Status: approved
Supersedes: none
Packages: server, client

## Problem and user
A person who tunes a reviewer agent changes its system prompt, its model or its linked skills, and cannot tell whether the agent got better or worse. Today the only signal is re-running reviews on live PRs and reading the findings by eye. Those PRs change, so no two runs are comparable. The accept/dismiss decisions already recorded on findings are a labelled dataset that nothing reads back. This feature turns a decided finding into a frozen eval case in one click. It runs an agent over its whole case set, scores the result in code (recall, precision, citation accuracy) and shows the runs over time. Two runs can be compared side by side, so "old prompt vs new prompt" becomes a pair of numbers.
**Request vs tree:** The request mostly matches the tree. These points differ:
- Tables exist but do not fit a suite run. `eval_cases` and `eval_runs` exist (`server/src/db/schema/eval.ts:7-35`). An `eval_runs` row is one case execution (`case_id` only, `:22-35`). It has no run-of-the-set grouping, no agent version, no skill set and no status. `eval_cases.owner_id` has no foreign key (`:13`), and there is no link back to the source finding and no expectation type.
- Contracts exist and must be extended, not duplicated: `EvalCase`/`EvalRun` (`server/src/vendor/shared/contracts/knowledge.ts:157-183`) and `EvalCaseInput`/`EvalRunRecord`/`EvalDashboard` (`server/src/vendor/shared/contracts/eval-ci.ts:20-89`). The metrics in `EvalRun` and in `EvalDashboard.current` are non-null numbers, so they cannot express "undefined". The client copy of `eval-ci.ts` has already drifted: it has no `AgentManifest`, and `ConformanceInput.provider` lacks `openrouter`.
- Agent versioning exists. A config change bumps `agents.version` and writes an `agent_versions` snapshot that includes `system_prompt` (`server/src/modules/agents/repository.ts:110-168`). Changes to skill links do **not** bump the version (`server/src/modules/agents/repository.ts:251`, `:209`). "Change a linked skill → see it in numbers" therefore needs the run to record its own skill set.
- Dispositions are exclusive timestamps (`server/src/modules/reviews/repository/review.repo.ts:126`, `:139`). A finding is accepted, dismissed, or neither.
- No eval module, route or UI exists (`server/src/modules/`). The FindingCard offers only Accept and Dismiss (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:91-110`). The AgentEditor has Config, Skills and Context tabs (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:12-14`). The sidebar has no Eval Dashboard (`client/src/vendor/ui/nav.ts:21-38`). `client/messages/en/eval.json` already holds unused strings.
- `pnpm verify:l06` does not exist. There is no root `package.json`; the house verify is `node scripts/verify.mjs <pkg>` (Q-5).

## Goals / Non-goals
**Goals**
- An eval case is made from an accepted finding (`must_find`) or a dismissed finding (`must_not_flag`) in one click, with the diff frozen at that moment.
- One action runs an agent over every case in its set. The numbers come out per run, and runs of different agent versions are comparable.
- Scoring is deterministic code with zero model calls.
- An Evals tab in the AgentEditor and an Eval Dashboard page show cases, runs, trends, and a two-run comparison with metric deltas and a system-prompt diff.
- Demo deliverable: a set of at least 8 cases of both types, where two runs with different prompts visibly move recall or precision (screenshot and screencast are produced by the user, outside this spec).
- In this lesson, but specified in two sibling specs to stay within the size budget (Q-4, resolved):
  - `SPEC-2026-10-05-eval-run-controls`: Promote vN, Run all agents, the time-window filter, the agent switcher, and the metric trend on the Evals tab (course stretch task).
  - `SPEC-2026-10-05-eval-case-authoring`: manual case creation and the case editor (course stretch task), per-case runs, and skill-level evals.
  Both build on the definitions in this spec: case, suite run, matching and metrics.
**Non-goals**
- Exporting an agent ("+ Export власного агента" in the course title). Out of scope for now (Q-6, resolved).
- The AgentEditor Stats and CI tabs (design 05). They are not part of the eval feature:
  - Stats reports live review runs: accept rate, cost and source local/CI (`specs/designs/eval-pipeline/source/screen_agents.jsx:83`, `client/messages/en/agentPerformance.json`).
  - CI deploys the agent to a repo's pipeline (`screen_agents.jsx:121`, `client/messages/en/ci.json`, `CiExport` in `server/src/vendor/shared/contracts/eval-ci.ts:198`). That is the agent-export feature of Q-6.
  - Neither one reads or writes eval cases or eval runs.
- Any change to `reviewer-core/src/grounding.ts` or to `INJECTION_GUARD`. They are used as they are.
- Model-judged scoring of any kind.

## User stories
- **US-1** As an agent author, I want to turn a finding I accepted or dismissed into an eval case in one click, so that my review decisions become a regression set without retyping anything.
- **US-2** As an agent author, I want to see all cases in an agent's set with their last result, so that I know what the set covers and what fails.
- **US-3** As an agent author, I want to run the agent on all of its cases at once, so that one action measures the current prompt, model and skills.
- **US-4** As an agent author, I want recall, precision and citation accuracy per run, computed without a model, so that the numbers are cheap, repeatable and trustworthy.
- **US-5** As an agent author, I want a run history per agent and an overview across agents, so that I can see the trend and spot regressions.
- **US-6** As an agent author, I want to compare two runs side by side, with metric deltas and the system-prompt diff, so that I can attribute a change in numbers to a change in the prompt.

## Acceptance criteria (EARS)
- **AC-1** WHILE a finding is accepted or dismissed and its review was produced by an agent, the FindingCard shall show a "Turn into eval case" action next to Accept and Dismiss. · traces: US-1, DR-5 · verify: component
- **AC-2** WHEN the user activates "Turn into eval case" on an accepted finding, the system shall, in that single action and without opening a form, store a `must_find` case in the producing agent's set. The case holds the finding's file, line range, title, severity and category, the frozen diff of that file, the PR title and body, and a link to the source finding. The card shall confirm the case was created. · traces: US-1, DR-2 · verify: integration
- **AC-3** WHEN the user activates "Turn into eval case" on a dismissed finding, the system shall store a `must_not_flag` case with the same frozen inputs and target location. · traces: US-1, DR-2 · verify: integration
- **AC-4** The AgentEditor Evals tab shall list every case in the agent's set. Each row shows its name, expectation type, target `file:line`, and its result in the latest completed run (passed, failed, errored or never run), under a "N / M passing" count. · traces: US-2, DR-6 · verify: component
- **AC-5** WHEN the user confirms deletion of a case in the Evals tab, the system shall remove the case from the set. Past runs shall keep their recorded per-case results. · traces: US-2 · verify: integration
- **AC-6** WHEN the user activates "Run all evals", the system shall start one eval run of the agent over every case in its set, against the agent's current version. It shall respond before any case finishes, and the tab shall show the run as running until it completes. · traces: US-3, DR-1, DR-3 · verify: integration
- **AC-7** WHILE an eval run executes a case, the system shall review only the case's frozen diff and PR title and body, with the agent's current system prompt, model, strategy and enabled skills. No repo map, callers digest, project documents or intent derivation shall be used. · traces: US-3, US-4 · verify: integration
- **AC-8** WHEN a case finishes, the system shall score it in code. A produced finding *matches* the target when its file equals the target file and its line range overlaps the target range. A `must_find` case passes when at least one finding that survived grounding matches. A `must_not_flag` case passes when no surviving finding matches. · traces: US-4 · verify: unit
- **AC-9** WHEN an eval run completes, the system shall record with it the agent id, the agent version, the enabled skills with their skill versions, the case ids included with a fingerprint of each case's content (frozen inputs plus expectation), the per-case results, the pass count, duration, cost, and three metrics. Recall = matched `must_find` cases / scored `must_find` cases. Precision = 1 − (surviving findings that match a `must_not_flag` target / all surviving findings). Citation accuracy = findings kept by the grounding gate / all findings produced. · traces: US-4, DR-1, DR-4 · verify: unit
- **AC-10** The Evals tab shall show the latest completed run's recall, precision, citation accuracy and pass count, each with its signed change against the previous completed run. · traces: US-4, US-5 · verify: component
- **AC-11** The sidebar shall show an "Eval Dashboard" entry under Skills Lab. Its landing page shall list one card per agent that has cases, showing model, latest run version and date, pass x/y and the three metrics, followed by a table of recent eval runs across all agents. · traces: US-5, DR-7 · verify: component
- **AC-12** WHEN the user opens an agent from the Eval Dashboard, the page shall show three metric tiles with deltas, a trend chart of the three metrics over its runs, and a runs table. The table lists the 20 newest runs first, with date, agent version, recall, precision, citation accuracy, pass x/y and cost. · traces: US-5 · verify: component
- **AC-13** WHILE exactly two runs are selected in the runs table, the Compare action shall be enabled. WHEN it is activated, a modal shall show recall, precision, citation accuracy and cost as older → newer values, each with a signed delta. · traces: US-6 · verify: component
- **AC-14** The Compare modal shall show a line diff of the two runs' system prompts, taken from their agent-version snapshots. It shall state a model change or a skill-set change when one occurred between the two runs. · traces: US-6, DR-4 · verify: component
- **AC-15** WHEN the latest completed run of an agent has a metric lower than the previous completed run, the agent's dashboard page shall show a banner naming each dropped metric and its drop in points. · traces: US-5, DR-20 · verify: component
- **AC-16** WHEN the user runs the set (≥ 8 cases, both types) once, edits the system prompt, runs again, then breaks the prompt deliberately and runs a third time, the Compare modal shall show non-zero deltas between the runs. The deliberately broken prompt shall show lower precision. · traces: US-6 · verify: manual — 1. create ≥ 8 cases from findings, both types; 2. Run all evals; 3. edit the prompt; 4. run; 5. replace the prompt with one that flags every changed line; 6. run; 7. compare 2↔4 and 4↔6.

## Edge cases
- **EC-1** IF a finding is neither accepted nor dismissed, THEN the "Turn into eval case" action shall be disabled and say that the finding must be accepted or dismissed first. · traces: DR-10 · verify: component
- **EC-2** IF a case already exists for the same source finding, THEN activating the action again shall create no second case. It shall report the existing one. · traces: DR-15 · verify: integration
- **EC-3** IF the finding's review has no producing agent, or that agent no longer exists in the workspace, THEN the system shall not offer the action and shall answer a direct request with 404. · traces: DR-2 · verify: integration
- **EC-4** IF the source finding's disposition changes, or its review or PR is deleted, after the case was created, THEN the case shall keep its expectation type and frozen inputs unchanged. · traces: DR-2 · verify: integration
- **EC-5** IF an agent has zero cases, THEN "Run all evals" shall be disabled, and a direct run request shall be rejected with 422 naming the empty set. · traces: DR-12 · verify: integration
- **EC-6** IF a run is requested while another eval run of the same agent is still running, THEN the system shall reject the request with 409 and the tab shall keep showing the running run. · traces: DR-11 · verify: integration
- **EC-7** IF a case's review call fails (missing API key, timeout, invalid model output), THEN that case shall be recorded as errored with its reason and left out of every metric denominator. The run shall be marked partial. IF every case errors, or the run is interrupted by an API restart, THEN the run shall be marked failed with a reason. · traces: DR-11 · verify: integration
- **EC-8** IF a metric has an empty denominator (no scored `must_find` case for recall; no produced finding for precision or citation accuracy), THEN the system shall record it as not available and display "—", never 0 % or 100 %. · traces: DR-9, DR-13 · verify: unit
- **EC-9** IF the two runs being compared did not include the same case ids with the same content fingerprints, THEN the Compare modal shall warn that the case sets differ and state each run's case count and the number of edited cases. · traces: DR-14 · verify: component
- **EC-10** IF no agent has a case, THEN the Eval Dashboard shall show an empty state that explains that cases are made from accepted or dismissed findings. · traces: DR-12 · verify: component
- **EC-11** IF a run's agent-version snapshot cannot be read, THEN the Compare modal shall still show the metric deltas and shall state that the prompt diff is unavailable. · traces: DR-4 · verify: component
- **EC-12** IF the finding's file diff exceeds 64 KB, THEN the case shall freeze only the hunks that overlap the finding's line range. IF those still exceed 64 KB, THEN creation shall be rejected with 422 and the card shall say the diff is too large. · traces: DR-2 · verify: integration

## Design review
**Source:** specs/designs/eval-pipeline/01–06 and `source/*.jsx` (prototype, mock data), compared against the tree.
### Gaps
- **DR-1** A suite run that groups per-case results with agent version, skill set, status and aggregate metrics. Nothing provides it: an `eval_runs` row is one case (`server/src/db/schema/eval.ts:22-35`).
- **DR-2** A case's expectation type, target location, source-finding link and frozen PR meta. `expected_output` is untyped jsonb (`server/src/db/schema/eval.ts:19`) and `EvalCaseInput.expected_output` is `unknown` (`server/src/vendor/shared/contracts/eval-ci.ts:27`).
- **DR-3** No eval routes and no eval module (`server/src/modules/` listing). The brief names `POST /agents/:id/eval-runs`.
- **DR-4** The agent version does not move on skill-link changes (`server/src/modules/agents/repository.ts:251`). The run must record its own skill set. Prompt text per version exists in `agent_versions.config_json.system_prompt` (`:149-168`).
- **DR-5** The FindingCard has no eval action (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:91-110`). Learn and Reply to author in design 01 belong to other lessons.
- **DR-6** No Evals tab: `VALID_TABS` is `config, skills, context` (`client/src/app/agents/[id]/page.tsx:15`).
- **DR-7** No Eval Dashboard nav entry (`client/src/vendor/ui/nav.ts:30-37`). `nav.ts` is app-owned per `client/AGENTS.md` (Do not touch → exception).
- **DR-8** Shared-contract drift: the client copy of `eval-ci.ts` already differs from the server's (see Request vs tree). Any eval contract change must land in both.
- **DR-9** `EvalRun` metrics are `z.number().min(0).max(1)` (`server/src/vendor/shared/contracts/knowledge.ts:158-160`), and `EvalDashboard.current` is non-null (`server/src/vendor/shared/contracts/eval-ci.ts:72-79`). Neither can express an undefined metric.
### Uncovered cases
- **DR-10** Design 01 shows the action regardless of disposition. The prototype seeds `must_find` for an *open* finding (`specs/designs/eval-pipeline/source/findings.jsx:29-44`) → EC-1, Q-2.
- **DR-11** Designs 03/05 show no running, partial or failed run state → EC-6, EC-7.
- **DR-12** No empty states for zero cases or zero runs → EC-5, EC-10.
- **DR-13** No display rule for a metric with an empty denominator → EC-8.
- **DR-14** Design 04 assumes both runs share "the 20-trace gold set". Cases added, removed or edited (the case editor in SPEC-2026-10-05-eval-case-authoring) between runs are not shown → EC-9.
- **DR-15** Double activation of "Turn into eval case" → EC-2.
### Module interactions
| From | To | Through | Contract |
|---|---|---|---|
| `client` FindingCard | `server` `modules/evals` (new) | `POST /findings/:id/eval-case` | `EvalCase` in server/src/vendor/shared/contracts/knowledge.ts · existing, extended with expectation, target, source finding |
| `client` Evals tab | `server` `modules/evals` | `GET /agents/:id/eval-cases` · `DELETE /eval-cases/:id` | `EvalCase` · existing, extended |
| `client` Evals tab, dashboard | `server` `modules/evals` | `POST /agents/:id/eval-runs` · `GET /agents/:id/eval-runs` · `GET /eval-runs/:id` | `EvalSuiteRun` (run + per-case results) in server/src/vendor/shared/contracts/eval-ci.ts · new |
| `client` Eval Dashboard | `server` `modules/evals` | `GET /eval/dashboard` · `GET /agents/:id/eval-dashboard` | `EvalDashboard` in server/src/vendor/shared/contracts/eval-ci.ts · existing, nullable metrics |
| `client` Compare modal | `server` `modules/agents` | `GET /agents/:id/versions/:version` | `AgentVersion` · existing |
| `server` `modules/evals` | `server` `modules/reviews`, `modules/agents` | in-process service calls (finding + disposition + PR diff; agent config + enabled skills) | existing internal |
| `server` `modules/evals` | `reviewer-core` | `reviewPullRequest`, `groundFindings` (reviewer-core/src/review/run.ts:130, reviewer-core/src/grounding.ts:52) | `Review`, `Finding` · existing, unchanged |
### UX improvements
- **DR-16** *adopted (Q-4)* "Promote vN" (design 04) restores an agent to a stored version as a new version. No agent restore action exists today (`server/src/modules/agents/routes.ts:31-40`); the skills module has the pattern (`server/src/modules/skills/routes.ts:26`). Specified in SPEC-2026-10-05-eval-run-controls.
- **DR-17** *adopted (Q-4)* "Run all agents" (design 02), the time-window filter and the agent switcher (design 03) are specified in SPEC-2026-10-05-eval-run-controls. The per-case run (design 05) is specified in SPEC-2026-10-05-eval-case-authoring. The Stats/CI tabs (design 05) stay out: they are not eval features (Non-goals).
- **DR-18** *adopted (Q-4)* The eval case editor (design 06) and skill-level evals (prototype `specs/designs/eval-pipeline/source/screen_skills.jsx:126`) are specified in SPEC-2026-10-05-eval-case-authoring. Cases from findings stay the primary one-click path (AC-2, AC-3).
- **DR-19** *proposed* The case row shows the expectation as a readable assertion ("must find … at file:line" / "must not flag … at file:line"), as in the prototype tooltip (`specs/designs/eval-pipeline/source/findings.jsx:25`) → Q-7.
- **DR-20** *adopted (Q-4)* The regression banner (design 03) is computed in code from the last two suite runs. `EvalDashboard.alert` already exists (`server/src/vendor/shared/contracts/eval-ci.ts:87`) → AC-15.

## Non-functional requirements
- **NFR-1** Cost: scoring and metric computation make zero model calls. An eval run makes exactly one review call per case and no intent, brief or other model call. · verify: integration
- **NFR-2** Determinism: the same cases and the same produced findings always yield identical per-case results and metrics. · verify: unit
- **NFR-3** Comparability: a case's frozen diff, PR meta and target do not change after creation when the source PR is resynced, re-reviewed or deleted. · verify: integration
- **NFR-4** Isolation: an eval run creates no review or finding on any PR, does not change a PR's reviewed state, and does not appear in a PR's run history. · verify: integration
- **NFR-5** Size and rate: at most 200 cases per agent; at most 3 case review calls in flight per run; a per-case call that has not returned in 120 s is recorded as errored (EC-7). · verify: integration
- **NFR-6** Data retention: deleting an agent removes its cases and eval runs; deleting a finding, review or PR removes no case. · verify: integration
- **NFR-7** i18n: every new user-facing string is read from `messages/en/eval.json` (or the namespace of the screen it lives on), with no literals in components. · verify: static
- **NFR-8** Accessibility: case results and metric deltas carry a text or sign (pass/fail, ▲/▼ with value), not colour alone. Run selection and Compare are operable by keyboard, and every action has an accessible name. · verify: component
- **NFR-9** Contract parity: every eval contract changed in the server's `@devdigest/shared` is mirrored in the client copy in the same change, and both packages typecheck. · verify: static
- **NFR-10** Observability: each eval run logs start, end, status, and each case's outcome or error reason. The per-case error reason is readable from the run's API record. · verify: integration
- **NFR-11** Verify gate: `node scripts/verify.mjs server --it` and `node scripts/verify.mjs client` are green on the finished tree (stand-in for the course's L06 verify script, Q-5). · verify: static
- **NFR-12** Comparability: suite metrics, the Evals-tab metric strip, run history, trend, Compare, the dashboard and the regression banner consider only suite runs over the whole set. Single-case runs (SPEC-2026-10-05-eval-case-authoring) never appear in or change them. · verify: integration

## Traceability
| Requirement | Traces to | Verify how |
|---|---|---|
| AC-1 | US-1, DR-5 | component |
| AC-2 | US-1, DR-2 | integration |
| AC-3 | US-1, DR-2 | integration |
| AC-4 | US-2, DR-6 | component |
| AC-5 | US-2 | integration |
| AC-6 | US-3, DR-1, DR-3 | integration |
| AC-7 | US-3, US-4 | integration |
| AC-8 | US-4 | unit |
| AC-9 | US-4, DR-1, DR-4 | unit |
| AC-10 | US-4, US-5 | component |
| AC-11 | US-5, DR-7 | component |
| AC-12 | US-5 | component |
| AC-13 | US-6 | component |
| AC-14 | US-6, DR-4 | component |
| AC-15 | US-5, DR-20 | component |
| AC-16 | US-6 | manual |
| EC-1 | DR-10 | component |
| EC-2 | DR-15 | integration |
| EC-3 | DR-2 | integration |
| EC-4 | DR-2 | integration |
| EC-5 | DR-12 | integration |
| EC-6 | DR-11 | integration |
| EC-7 | DR-11 | integration |
| EC-8 | DR-9, DR-13 | unit |
| EC-9 | DR-14 | component |
| EC-10 | DR-12 | component |
| EC-11 | DR-4 | component |
| EC-12 | DR-2 | integration |
| NFR-1 | US-4 | integration |
| NFR-2 | US-4 | unit |
| NFR-3 | US-3 | integration |
| NFR-4 | US-3 | integration |
| NFR-5 | US-3 | integration |
| NFR-6 | US-2 | integration |
| NFR-7 | US-2, US-5 | static |
| NFR-8 | US-5, US-6 | component |
| NFR-9 | DR-8 | static |
| NFR-10 | US-3 | integration |
| NFR-11 | US-4 | static |
| NFR-12 | US-5, US-6 | integration |

DR-16, DR-17 and DR-18 are traced by the requirement rows of the sibling specs SPEC-2026-10-05-eval-run-controls and SPEC-2026-10-05-eval-case-authoring. DR-19 is owned by Q-7.

## Inputs and provenance
| Source | Path or URL | What it settled |
|---|---|---|
| request | Course brief L06 "Eval Pipeline for DevDigest" (course file name `specs/eval-pipeline.md`; house name used instead), relayed by the caller 2026-10-05 | Stories, the scoring definitions, the route name, ≥ 8 cases, zero model calls in scoring, the experiment, `pnpm verify:l06` |
| answers | user via coordinator, 2026-10-05: "pull ALL deferred design extras into this lesson's scope" | Q-4 resolved; DR-16–DR-18 adopted; split into two sibling specs; Stats/CI tabs judged out of the eval feature |
| request | course stretch tasks "Case Editor: manual case creation" and "metric trend chart" (L06), relayed by the coordinator 2026-10-05 | Specified in the siblings: SPEC-2026-10-05-eval-case-authoring and SPEC-2026-10-05-eval-run-controls |
| answers | user via coordinator, 2026-10-05: agent export "out of scope for now, revisit after the user checks the lesson materials" | Q-6 resolved |
| request | caller instructions, same message | Agent export is out of scope unless the design makes it part; the no-disposition case is to be decided or flagged; extras are to be scoped as MVP or deferred |
| design | specs/designs/eval-pipeline/01-finding-card-turn-into-eval-case.webp | Action placement in the FindingCard action row |
| design | specs/designs/eval-pipeline/02-eval-dashboard-all-agents.png | Landing: agent cards, recent runs across agents, "Run all agents" |
| design | specs/designs/eval-pipeline/03-eval-dashboard-agent-runs.webp | Per-agent tiles, trend, runs table with version and cost, regression banner |
| design | specs/designs/eval-pipeline/04-compare-runs-modal.webp | Metric + cost deltas, system-prompt diff, "Promote v7" |
| design | specs/designs/eval-pipeline/05-agent-editor-evals-tab.webp | Evals tab: metric strip, case list with pass/fail/never-run |
| design | specs/designs/eval-pipeline/06-eval-case-editor-modal.webp | Case editor (deferred); expected output shown as a findings list |
| design | specs/designs/eval-pipeline/source/findings.jsx:19-45 | Prototype seeds an open finding as "must find" (DR-10) |
| repo | server/src/db/schema/eval.ts:7-35 | Existing case/run tables; run is per case |
| repo | server/src/vendor/shared/contracts/eval-ci.ts:20-89, knowledge.ts:148-183 | Existing eval contracts and their non-null metrics |
| repo | server/src/modules/agents/repository.ts:110-168, :209-266 | Version bump + snapshot on config change; skill links do not version |
| repo | server/src/modules/reviews/repository/review.repo.ts:119-142; findings.ts:11-34 | Accept/dismiss are mutually exclusive timestamps |
| repo | server/src/modules/reviews/run-executor.ts:134, :211-235, :292 | Live review adds intent, callers, repo map, project docs and marks the PR reviewed, which AC-7 and NFR-4 exclude |
| repo | reviewer-core/src/grounding.ts:52-84 | Kept/dropped split that citation accuracy counts (read only) |
| repo | client/src/vendor/ui/nav.ts:21-38; client/AGENTS.md (Do not touch) | Sidebar registry is app-owned |
| repo | client/messages/en/eval.json | Existing `dashboard`, `caseEditor`, `evalsTab` strings |
| insights | INSIGHTS.md:286-291 | Shared contracts are two copies; mirror in the same change → NFR-9 |
| insights | server/INSIGHTS.md:75-81 | Review runs call intent and can make paid calls in tests → AC-7, NFR-1 |
| insights | server/INSIGHTS.md:393-396 | Transport retries hide "exactly one call"; a single-shot client exists → NFR-1, NFR-5 |

## Untrusted inputs
| Input | Source | Validation | On invalid |
|---|---|---|---|
| `:id` of finding, agent, case, run | URL path params | Shape: uuid. Identity: resolves within the caller's workspace | 422 naming the param; 404 when not found or in another workspace |
| Request bodies (create case, start run) | HTTP body | Shape: strict object, no extra keys; a run start carries no body fields | 422 naming the field |
| Compare selection (two run ids) | Client selection / query | Shape: exactly two uuids. Identity: both runs belong to the same agent | Compare stays disabled; API answers 422 |
| Frozen diff of the case | GitHub PR diff via the source PR | Size ≤ 64 KB (EC-12). Text that reaches a prompt: wrapped as untrusted under `INJECTION_GUARD`, like a live review | Trim to overlapping hunks, else 422; an instruction inside it is data, never followed |
| Frozen PR title and body | GitHub PR, author-written | Title ≤ 300 chars, body ≤ 16 KB; reaches the prompt as untrusted text; rendered as plain text | Truncate to the cap |
| Finding title, file, rationale copied into the case | LLM output of an earlier review | Rendered as plain text; case name ≤ 120 chars | Truncate the name; never render raw HTML |
| Model output during an eval run | LLM | Parsed with the existing `Review` schema, then grounded | Case recorded as errored (EC-7) |

## Open questions
- **Q-1 (non-blocking):** Precision denominator. Should a surviving finding that matches neither a `must_find` nor a `must_not_flag` target count as noise? Default in this draft: no. Precision = 1 − (findings matching a `must_not_flag` target / all surviving findings), as in the brief's "share of produced findings that are not noise". The stricter alternative counts unlabelled findings as noise, which makes precision drop for any extra finding. — the user decides
- **Q-2 (non-blocking):** A finding with no disposition. Default: the action is disabled until the finding is accepted or dismissed (EC-1), so the dataset is only decisions. The prototype instead treats an open finding as `must_find`. — the user decides
- **Q-3 (non-blocking):** Frozen input. Default: the case freezes the finding file's diff plus the PR title and body. Repo map, callers, project documents and intent are excluded (AC-7), so the numbers move only with prompt, model and skills. The alternative also freezes the project documents attached to the agent. — the user decides
- Q-4, resolved: (2026-10-05, decided by the user via the coordinator) the user pulled every deferred design extra into this lesson. Promote vN, Run all agents, the time-window filter and the agent switcher go to SPEC-2026-10-05-eval-run-controls. The case editor, per-case runs and skill-level evals go to SPEC-2026-10-05-eval-case-authoring. The split keeps each spec within the size budget. The Stats and CI tabs stay out because they are not eval features (Non-goals). As a consequence, AC-9 and EC-9 now record and compare case content fingerprints, and NFR-12 was added. (DR-16, DR-17, DR-18, DR-20, AC-9, EC-9, NFR-12)
- **Q-5 (non-blocking):** `pnpm verify:l06` does not exist, and adding it means a new root script outside the spec folders. Default: NFR-11's `scripts/verify.mjs` commands stand in for it, and the screencast shows them. Should an alias be added? — the user / course
- Q-6, resolved: (2026-10-05, decided by the user via the coordinator) agent export is out of scope for now, to be revisited after the user checks the lesson materials. `AgentManifest` (`server/src/vendor/shared/contracts/eval-ci.ts:152`) and `PluginEvalCase` (`server/src/vendor/shared/contracts/productionize.ts:47`) stay unused by this feature. (Non-goals)
- **Q-7 (non-blocking):** Show each case row's expectation as a readable assertion (DR-19)? Default: no. The row shows the expectation type and `file:line` (AC-4). — the user decides
