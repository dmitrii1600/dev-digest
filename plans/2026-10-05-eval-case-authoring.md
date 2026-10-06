# Implementation Plan: Eval case authoring: manual cases and the case editor, per-case runs, skill-level evals

**Plan ID:** 2026-10-05-eval-case-authoring  ·  **Spec:** [specs/2026-10-05-eval-case-authoring.md](specs/2026-10-05-eval-case-authoring.md)  ·
**Execution mode:** multi-agent (step 0 → tracks A ∥ B → Integration)  ·  **Packages:** server, client  ·
**Assumptions:** the spec's Q-1 … Q-5 are taken at their defaults: Files tab read-only, host picked from linked agents, "Run on save" off, skill runs not on the Eval Dashboard, JSON editable and in sync. The planner's own non-blocking questions are listed under *Open questions*, and each default is applied in the steps. Units follow the parent plan: "64 KB" means 65 536 UTF-8 bytes, "16 KB" means 16 384 UTF-8 bytes and "8 KB" means 8 192 UTF-8 bytes. "120 characters" means 120 code points. A *changed line* is the new-side line number of an added (`+`) line (planner Q1).

## Summary
This builds on the eval pipeline already in the tree (commit `b6c1529`). The `evals` module gains six things: manual case create and edit for agent-owned and skill-owned cases, single-case runs (`kind = 'single'`), skill suite runs on a host agent with only the skill under test enabled, a skill dashboard, and a per-case "latest run" read. The existing executor is generalised once (`launch`), so suite, single and skill runs share the one-call, 120 s, ≤ 3-in-flight path.

The tree also needs fixing in three places. Agent run queries do not filter by owner, so a skill run on a host agent would leak into that agent's history and dashboard. The one-running-suite index is keyed by `agent_id`. The stale-run sweep ignores single runs.

On the client, the case editor and the case list are promoted to `src/components/eval-cases/`, because the agent Evals tab and a new skill Evals tab both use them. Server and client are disjoint packages joined only by the contracts, so they build in parallel after a contract-first step 0.

## Requirements review

**What I understood:** Let an author write and edit eval cases by hand from a pasted diff. Let them run one case cheaply without touching suite numbers. Let them evaluate a skill on a chosen host agent. All of it rides on the parent's case, run, matching and metric definitions.
**Inputs read:** specs/2026-10-05-eval-case-authoring.md (approved, no blocking Q) · parent specs/2026-10-05-eval-pipeline.md · sibling specs/2026-10-05-eval-run-controls.md (file overlap only) · plans/2026-10-05-eval-pipeline.md · request text · AGENTS.md · INSIGHTS.md, server/INSIGHTS.md, client/INSIGHTS.md · server/src/modules/evals/README.md · `spec-writing` skill.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status | Covered by |
|---|---|---|---|---|
| AC-1 | "the editor shall open with: name, a Diff input, a PR meta input (title and body), a Files view, an expectation type …, a file, a line range, and an expected-output JSON panel" | spec §AC-1 | clear | steps 8, 9 |
| AC-2 | "show it as a per-file preview in the same form as the PR Files-changed view" | spec §AC-2 | clear (`DiffViewer` takes `PrFile[]`, `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:14-20`; `PrFile.patch` is hunks only) | steps 7, 8 |
| AC-3 | "The file field shall offer only files present in the pasted diff. The Files view shall list those files with their changed line ranges, read only" | spec §AC-3 | ambiguous: "changed line" is undefined (added lines vs hunk range); see Q1 | steps 2, 7, 8 |
| AC-4 | "WHILE the expected-output JSON is valid … keep it and the type, file and line-range fields in sync in both directions, and mark it "valid JSON"" | spec §AC-4 | ambiguous: the JSON shape is not fixed; the plan fixes `{"type","file","start_line","end_line"}` (Assumption) | steps 7, 8 |
| AC-5 | ""Finding skeleton" … the selected type, the first file in the diff and that file's first changed line range" | spec §AC-5 | clear (with Q1's definition) | steps 7, 8 |
| AC-6 | "store it in the agent's set as a manual case … same expectation types, … frozen-input rules and … 64 KB diff cap … run by the same suite route" | spec §AC-6 | clear | steps 0, 2, 4, 5 |
| AC-7 | "label each case by origin: from finding, or manual" | spec §AC-7 | clear (`eval_cases.source`, `server/src/db/schema/eval.ts:37-39`) | step 9 |
| AC-8 | "Saving shall update the case in place and give it a new content fingerprint" | spec §AC-8 | ambiguous: the fingerprint covers content only (`server/src/modules/evals/helpers.ts:105-127`), so a rename alone does not change it. The fingerprint is recomputed on every save (Assumption) | steps 4, 5 |
| AC-9 | ""Run case" in the editor, or the run action on a case row … single-case run of the saved case … agent's current configuration" | spec §AC-9 | ambiguous for skill-owned cases, which have no agent; see Q2 | steps 4, 5, 8, 9, 10 |
| AC-10 | "a distinct run kind … agent version, the enabled skills with their versions, and the case fingerprint … never appears in suite metrics, run history, trend, Compare, the dashboard or the regression banner" | spec §AC-10 | clear (`kind` exists; every suite query filters `kind='suite'`, `server/src/modules/evals/repository.ts:105`) | steps 1, 3, 4, 5 |
| AC-11 | "WHERE "Run on save" is switched on, … start a single-case run right after a successful save" | spec §AC-11 | clear (default off, Q-3) | step 8 |
| AC-12 | "latest run of either kind: its kind, agent version, pass/fail/errored, expected vs got, duration and cost" | spec §AC-12 | clear | steps 0, 3, 4, 8 |
| AC-13 | "latest single-case run is newer than its latest suite run … a secondary, labelled marker. The suite result shall stay as the row's main result" | spec §AC-13 | clear | steps 0, 4, 9 |
| AC-14 | "The skill editor shall have an Evals tab … same row content … same editor" | spec §AC-14 | clear (`client/src/app/skills/[id]/_components/SkillEditor/constants.ts:4` has no `evals`) | step 10 |
| AC-15 | ""Run all evals" on a skill's Evals tab … ask for a host agent … host's prompt, model and strategy, with only the skill under test enabled, at the skill's current version" | spec §AC-15 | contradicts tree: `eval_runs_one_running_suite_uq` is keyed on `agent_id` (`server/src/db/schema/eval.ts:105-107`), so a skill suite on host H and H's own suite would 409 each other | steps 1, 3, 4, 5, 10 (Rec. 1) |
| AC-16 | "record the host agent and its version and the skill version … three metrics with deltas against the previous suite run on the same host" | spec §AC-16 | clear: `agent_id`, `agent_version` and `skills[]` already exist on `EvalSuiteRun` (`server/src/vendor/shared/contracts/eval-ci.ts:81-103`) | steps 4, 5, 10 (Rec. 4) |
| EC-1 | "does not parse as a unified diff with at least one file and one hunk … preview shall say so, Save disabled, API 422" | spec §EC-1 | contradicts tree: `parseUnifiedDiff` merges a header-less multi-file diff into one file. A second `+++ ` line renames the current file (`server/src/adapters/git/diff-parser.ts:39-45`) | steps 2, 7, 8 (Rec. 6) |
| EC-2 | "exceeds 64 KB … Save disabled with the size stated … API 422" | spec §EC-2 | clear | steps 0, 7, 8 |
| EC-3 | "target file is not in the diff, or the line range does not overlap a changed line …, or the start line is after the end line … Save blocked with a message naming the problem" | spec §EC-3 | ambiguous (Q1) | steps 0, 2, 4, 7, 8 |
| EC-4 | "expected-output JSON is invalid or does not fit … marked invalid with the reason. The form fields shall keep their last valid values, Save disabled" | spec §EC-4 | clear | steps 7, 8 |
| EC-5 | "name is empty, longer than 120 characters, or already used in the same set … 422 naming the field" | spec §EC-5 | ambiguous: case sensitivity, and finding-made cases may already share names (`service.ts:147` copies the finding title); see Q3 | steps 0, 2, 3, 4, 8 |
| EC-6 | "closes the editor with unsaved changes … ask before discarding" | spec §EC-6 | clear (`Modal` backdrop click calls `onClose`, `client/src/vendor/ui/kit/Modal.tsx:20-23`) | step 8 |
| EC-7 | "unsaved changes … "Run case" disabled and say the case must be saved first" | spec §EC-7 | clear | step 8 |
| EC-8 | "a single-case run of the same case is still running … 409 … allowed while a suite run … is running" | spec §EC-8 | contradicts tree: no per-case column backs a race-safe index, and `failStaleRunning` sweeps `kind='suite'` only (`repository.ts:332`), so an orphaned single run would block its case forever | steps 1, 3, 4 (Rec. 2) |
| EC-9 | "single-case run's review call fails … errored … editor shall show the reason" | spec §EC-9 | clear | steps 4, 8 |
| EC-10 | "skill is linked to no agent … "Run all evals" disabled and say a host agent is needed" | spec §EC-10 | clear | step 10 |
| EC-11 | "host agent was deleted or unlinked … 404 or 422, and no review call" | spec §EC-11 | clear | steps 4, 5 |
| EC-12 | "changes the expectation type or target of a case made from a finding … warn … source-finding link kept" | spec §EC-12 | clear | steps 3, 8 |
| NFR-1 | "manual case's diff, PR meta and expectation are stored as entered … Only an explicit edit … changes them" | spec §NFR-1 | clear | steps 3, 5 |
| NFR-2 | "saving, validation, the preview and "Finding skeleton" make no model call. A single-case run makes exactly one review call" | spec §NFR-2 | clear: single-shot provider already wired (`server/src/modules/evals/routes.ts:62`) | steps 4, 5 |
| NFR-3 | "name ≤ 120 characters, diff ≤ 64 KB, PR title ≤ 300, PR body ≤ 16 KB, expected-output JSON ≤ 8 KB" | spec §NFR-3 | ambiguous: the API carries `expectation` and `target` as fields, not the JSON text, so the 8 KB cap is enforced in the editor only (Assumption) | steps 0, 7 |
| NFR-4 | "every new string is read from `messages/en/eval.json` (or `skills.json` for the skill tab)" | spec §NFR-4 | clear | steps 6, 8–10 |
| NFR-5 | "tabs, fields and toggle are keyboard operable with accessible names … not colour alone" | spec §NFR-5 | clear (`Toggle` has no label prop, `client/src/vendor/ui/primitives/Toggle.tsx:3-11`, so it is wrapped in a `<label>`) | step 8 |
| NFR-6 | "every contract added or changed here is mirrored in the client copy … in the same change" | spec §NFR-6 | clear (`client/src/test/eval-contract-sync.test.ts` enforces byte equality) | step 0 |
| NFR-7 | "each single-case run and each skill suite run logs its case or skill, the host or agent version, the outcome and any error reason" | spec §NFR-7 | clear | step 4 |
| UI-1 | Pasted diff: "unified diff with ≥ 1 file and ≥ 1 hunk, ≤ 64 KB … plain text … under `INJECTION_GUARD`" | spec §Untrusted inputs | clear | steps 0, 2, 8 |
| UI-2 | PR title and body: "Title ≤ 300 characters, body ≤ 16 KB; plain text; … untrusted" | spec §Untrusted inputs | clear | steps 0, 8 |
| UI-3 | Expected-output JSON: "type enum, file in the diff, integer lines ≥ 1 with start ≤ end, ≤ 8 KB" | spec §Untrusted inputs | ambiguous: as NFR-3 | steps 0, 7 |
| UI-4 | Case name: "1–120 characters, unique in the set, plain text" | spec §Untrusted inputs | ambiguous (Q3) | steps 0, 2, 4 |
| UI-5 | ids: "uuid; resolves in the caller's workspace; the host is linked to the skill … 422 for shape; 404 for unknown or foreign ids" | spec §Untrusted inputs | clear | steps 0, 4, 5 |
| NG-2 | "Skill eval runs on the Eval Dashboard; it stays agent-only" | spec §Non-goals, Q-4 | contradicts tree: `SUITE` has no `owner_kind` (`repository.ts:105`). `listRuns` filters by `agent_id` only (`:346`) and `recentRuns` by workspace only (`:412-419`). A skill run on host H would show in H's history, tiles, trend, Compare, banner and on `/eval` | step 3 (Rec. 1) |

The spec's *Request vs tree* cites `server/src/db/schema/eval.ts:7-21` and `eval-ci.ts:20-29`. Those were the pre-`b6c1529` lines; the same content is now at `eval.ts:21-61` and `eval-ci.ts:27-38`. The content claims still hold: no route creates or updates a case, and `EvalCaseInput` is unused (`rg EvalCaseInput` hits only the two contract copies).

### Gaps and questions (non-blocking; defaults taken)
1. **Q1:** What is a "changed line"? Two options: the new-side numbers of `+` lines (default), or a hunk's whole new-side range, which is what grounding accepts (`diff-parser.ts:63-74` counts context lines) and what the parent's `freezeDiff` calls "in the diff". This changes the Files view, the skeleton, EC-3 and the server check. The default matches design 06's skeleton (`start_line: 12` on the one added line, `specs/designs/eval-pipeline/source/screen_cizruns.jsx:58-59`).
2. **Q2:** Can a skill-owned case be run on its own? Default: yes, on a host picked in the same host picker as "Run all evals". `POST /eval-cases/:id/runs` takes `host_agent_id`, which is required for a skill case and refused for an agent case. The alternative disables "Run case" on skill cases.
3. **Q3:** How is name uniqueness checked? Default: the name is trimmed and compared case-insensitively against the other cases of the same owner, on every manual create and every edit. Existing duplicates made from findings stay as they are. A finding-made case whose name already collides must be renamed before an edit can be saved.
4. **Q4:** A pasted multi-file diff without `diff --git` lines is mis-parsed by the shared parser (EC-1 row). Default: reject it with 422 `diff_needs_git_headers` and say so in the preview. The alternative fixes `server/src/adapters/git/diff-parser.ts`, which the live review also uses, so it is out of this plan's scope (Follow-up).
5. **Q5:** The spec's Q-1 … Q-5 are all taken at their defaults (Assumptions line).

### Recommendations
1. **Scope agent run reads to agent-owned runs, and key the one-running-suite index on `owner_id`.** Why: NG-2 and AC-15 rows. Plan change: step 1 recreates the index on `owner_id`; for agent runs `owner_id = agent_id`, so the parent's EC-6 still holds. Step 3 adds `owner_kind = 'agent'` to every agent-facing run query. **Adopted.**
2. **Add `eval_runs.single_case_id`** (FK to `eval_cases`, set null) with a partial unique index `WHERE status='running' AND kind='single'`, and sweep stale `running` rows of every kind. Why: the EC-8 row, and the parent's race-safe 409 precedent (`schema/eval.ts:104-107`). Plan change: steps 1, 3, 4. **Adopted.**
3. **Reuse `EvalSuiteRun` / `EvalSuiteRunDetail` for single runs instead of a new `EvalSingleRun`.** The kind enum already has `single` (`eval-ci.ts:48`). Only two shapes are new: `EvalCaseRunState` (the editor's latest-run read) and `EvalCaseListItem.latest_single` (the row marker). Plan change: step 0 adds less, and the client reuses `useEvalRun` polling. **Adopted.**
4. **Serve the skill tab's tiles from `GET /skills/:id/eval-dashboard` → the existing `EvalDashboard`** (it already allows `owner_kind: 'skill'`, `eval-ci.ts:214-235`). It sits next to the spec's `GET /skills/:id/eval-runs`. Why: `MetricTiles` takes an `EvalDashboard` (`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:67`), and the deltas stay in the server's `metricDelta`/`passDelta` instead of being re-implemented in the browser. Plan change: steps 4, 5, 10. **Adopted.**
5. **Delete a skill's eval cases and eval runs when the skill is deleted,** in the same transaction (the agent precedent at `server/src/modules/agents/repository.ts:79-95`). Why: `server/INSIGHTS.md:315-323`. `owner_id` has no FK, and a skill-owned run's only FK is to its host agent, so both would orphan. Plan change: step 3 edits `skills/repository.ts`. **Adopted.**
6. **Reject header-less multi-file diffs; do not touch the shared parser** (Q4). Why: the EC-1 row. Plan change: steps 2 and 7 implement the same rule on both sides, pinned by the same fixtures. **Adopted.**
7. **The editor validates shape with the same `EvalCaseInput` contract the route uses** (`EvalCaseInput.safeParse`; `zod` is a client dependency, `client/package.json:24`). Why: client and server rules drift (`INSIGHTS.md:357-362`). Plan change: step 8. **Adopted.**
8. **Update the empty-state copy that says cases come only from findings** (`client/messages/en/eval.json`, `evalsTab.emptyCases`, `evalsTab.runAllEmpty`, `dashboard.emptyBody`). **Not adopted.** No AC fixes that copy, and the strings are still true for the one-click path. It is a Follow-up.

### Execution mode
Stated by caller: "choose as you judge best". **Multi-agent.** Every server file and every client file is disjoint, and the only shared surface is the `eval-ci.ts` contract pair, which step 0 settles first. Each track is about five steps, so running them in parallel halves the wall time without any shared file.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | conventions: contract once + mirror, `*.it.test.ts`, `.js` imports, `messages/en`, verify.mjs flags, do-not-touch list |
| [server/src/modules/evals/README.md](server/src/modules/evals/README.md) | routes, error codes (`eval_case_rejected` + `details.reason`), executor (single-shot, 120 s / 125 s, 3 in flight), sweep, the `SUITE` filter, the "skill-owned cleanup" known limit |
| [server/src/db/schema/eval.ts:21-141](server/src/db/schema/eval.ts:21) | `source`, `owner_kind`, `kind` columns already exist; suite index on `agent_id`; no per-case run column |
| [server/src/modules/evals/service.ts:98-261](server/src/modules/evals/service.ts:98) | `createFromFinding` checks, `startRun` order, `execute`/`runCase`/`singleCall`, `sweep` |
| [server/src/modules/evals/repository.ts:105-429](server/src/modules/evals/repository.ts:105) | `SUITE` = workspace + kind only; `ownedBy` hard-codes `owner_kind='agent'`; `insertRunningRun` hard-codes `kind:'suite'`, `ownerKind:'agent'` |
| [server/src/modules/evals/types.ts:119-148](server/src/modules/evals/types.ts:119) | the `EvalsStore` port that the fakes in `server/test/evals-*.test.ts` implement |
| [server/src/modules/evals/helpers.ts:24-127](server/src/modules/evals/helpers.ts:24) | `extractFileDiff`, `freezeDiff` (hunk-range notion), `truncateChars`, `caseFingerprint` |
| [server/src/adapters/git/diff-parser.ts:14-79](server/src/adapters/git/diff-parser.ts:14) | `newLineNumbers` mixes context and added lines; header-less multi-file mis-parse; `/dev/null` files dropped |
| [server/src/vendor/shared/contracts/eval-ci.ts:27-150](server/src/vendor/shared/contracts/eval-ci.ts:27) · [knowledge.ts:170-221](server/src/vendor/shared/contracts/knowledge.ts:170) | `EvalCaseInput` (unused, loose), `EvalCase`, `EvalTarget`, `EvalCaseListItem`, `EvalSuiteRun(Detail)`, `EvalDashboard` |
| [server/src/modules/skills/repository.ts:71-77,186-229](server/src/modules/skills/repository.ts:71) | `deleteById` has no eval cleanup; `agentsUsing` (any binding) and `blocksForAgent` (enabled only) |
| [server/src/modules/skills/routes.ts:160-165](server/src/modules/skills/routes.ts:160) | `GET /skills/:id/agents` exists |
| [server/src/modules/agents/repository.ts:74-95](server/src/modules/agents/repository.ts:74) | agent delete removes its eval cases by hand, in one transaction |
| [server/src/app.ts:49,116-127](server/src/app.ts:116) | body limit 1 MiB (above every cap here); a zod validation failure is 422 with `details` carrying the field path |
| [server/eslint.config.mjs:115-133](server/eslint.config.mjs:115) | ring-2 zone is by file name/path; a new non-`service/helpers/constants` file would need an entry |
| `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/*` | current tab, row content, `helpers.ts` label maps |
| `client/src/app/skills/[id]/_components/SkillEditor/{SkillEditor.tsx,constants.ts}` · `client/src/app/skills/[id]/page.tsx:28` | tab shell; `VALID_TABS` drives `?tab=` |
| [client/src/lib/hooks/evals.ts](client/src/lib/hooks/evals.ts) · `client/src/lib/hooks/skills.ts:111-126` · `client/src/lib/hooks/agents.ts:8` | existing hooks, key builders, `invalidateEvals`; `useSkillAgents`; `useAgents` |
| [client/src/components/diff-viewer/](client/src/components/diff-viewer/index.ts) · [client/src/components/eval-metrics/](client/src/components/eval-metrics/index.ts) | `DiffViewer` + `PrFile` input; `MetricTiles`, formatters |
| [client/messages/en/eval.json](client/messages/en/eval.json) · `client/messages/en/skills.json:119-127` | existing `caseEditor`/`evalsTab` keys; skill tab labels |
| `specs/designs/eval-pipeline/source/screen_cizruns.jsx:55-100` · `screen_skills.jsx:126-137` | editor layout, skeleton line, skill tab buttons |
| [plans/2026-10-05-eval-pipeline.md](plans/2026-10-05-eval-pipeline.md) | track layout, the "room left for siblings" list, test files |

## Insights that bind this work
1. **Polymorphic `owner_id` needs by-hand cleanup** ([server/INSIGHTS.md:315-323](server/INSIGHTS.md:315)). Skill-owned cases ship here, so step 3 adds the cleanup to `SkillsRepository.deleteById`, in one transaction, mirroring the agent. It also removes skill-owned runs, which have no owner FK.
2. **"Exactly one call" needs the single-shot transport** ([server/INSIGHTS.md:409-412](server/INSIGHTS.md:409)). Single and skill runs go through the same `launch` → `execute` → `singleCall` path, with the same `container.llm(..., { singleShot })` port (`routes.ts:62`). They never get a second provider. A test counts exactly one provider call for a single run (NFR-2).
3. **`@devdigest/shared` is two copies** ([INSIGHTS.md:294-299](INSIGHTS.md:294)). Step 0 edits both `eval-ci.ts` copies byte-identically, and `client/src/test/eval-contract-sync.test.ts` proves it. No other contract file changes.

Also binding:
- **`server/INSIGHTS.md:139-142`:** `pnpm typecheck` never sees `server/test/**`. Widening `EvalsStore` will not turn the fakes in `evals-service.test.ts` / `evals-create-case.test.ts` red, so step 3 updates them by hand and runs them with `--file`.
- **`server/INSIGHTS.md:143-146`:** a green `--it` lane proves nothing without Docker; run `docker info` first.
- **`server/INSIGHTS.md:336-342`:** `drizzle-kit generate` prompts and hangs when a table both gains and loses a column. Step 1 only *adds* a column and swaps indexes. It is never hand-written.
- **`INSIGHTS.md:357-362`:** client/server rule drift, which is why Rec. 6 and 7 use shared fixtures and the shared contract.
- **`server/INSIGHTS.md:328-333`:** no new ring-2 file outside the zone globs. New logic goes into the existing `evals/helpers.ts` and `evals/service.ts`, so `eslint.config.mjs` is untouched.

No step repeats a "What Doesn't Work" entry. The one nearby is the parent's two-migration split, and step 1 needs no drop of a column.

## Constraints
- **Onion rings (server).** `evals/helpers.ts` and `evals/service.ts` are ring 2: no `drizzle-orm`, `fastify`, `zod` or adapter imports. They reach other modules only through the structural ports in `EvalsDeps`. `evals/repository.ts` and `skills/repository.ts` are ring 3. `evals/routes.ts` is ring 4 and the only place that touches `container.*`. The service never imports `modules/skills` or `modules/agents`.
- **Contract once + mirror.** Only `server/src/vendor/shared/contracts/eval-ci.ts` changes, mirrored into `client/src/vendor/shared/contracts/eval-ci.ts` byte for byte. `knowledge.ts` is untouched.
- **Declarative validation.** Every new route declares zod `params`/`querystring`/`body`/`response`, and every POST/PUT body is `.strict()`. A run start sends `{}` or `{ host_agent_id }`. No `.parse()` in a handler.
- **`.js` relative imports** in every server file.
- **`*.it.test.ts`** for any test that touches Postgres. The new integration file is `server/test/evals-authoring.it.test.ts`.
- **Do not touch:** `reviewer-core/**` (including `grounding.ts`, `INJECTION_GUARD`); `server/src/adapters/git/diff-parser.ts` (shared with live reviews, Q4); applied migrations `0000`–`0018`; lock-files; `client/src/vendor/ui/**` (wrap a kit component, never edit it).
- **Migration** via `cd server && pnpm db:generate` only. Check the generated SQL for the two `WHERE` clauses.
- **Client placement.** Shared eval-case pieces live in `client/src/components/eval-cases/` and may import `@/lib/hooks/*` and `@/components/*`, never `@/app/**`. Route-local pieces stay under `_components/<Name>/<Name>.tsx` + `<Name>.test.tsx`. No `fetch` in a component. All user-facing text comes from `messages/en/eval.json` (shared components, agent tab) or `messages/en/skills.json` (skill tab).
- **Untrusted text** (diff, PR title/body, case name) is rendered as plain text only (the diff through `DiffViewer`, the rest as React text). It is never `dangerouslySetInnerHTML` and never markdown.
- **Sibling sequencing.** `plans/2026-10-05-eval-run-controls.md` (unbuilt) touches the same server files (`evals/{constants,helpers,types,repository,service,routes}.ts`, `eval-ci.ts`, `evals-service/routes/create-case.test.ts`, `evals.it.test.ts`), the same client files (`hooks/evals.ts`, `eval.json`, the agent `EvalsTab`) and also generates a migration. Build this plan first, then that one on top; never both at once. The migration number is **the next free one**: `0019` when this plan builds first, `0020` otherwise — never the same number as the sibling. After this plan lands, the sibling's `startRun(…, { limiter })` becomes an option of `launch`, its `SUITE` reads become `AGENT_SUITE`, and its promote route must read only `owner_kind = 'agent'` runs (a skill run hosted on agent H has `agent_id = H` but records `[skill]` as its skill set).

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `server/test/contracts.test.ts` (step 0) | `zod` | wire contracts, `.strict()`, refinements, nullable vs optional |
| `server/src/db/schema/eval.ts`, generated migration (step 1) | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design` | ring 3 schema, FK set null, partial unique indexes |
| `server/src/modules/evals/{helpers,constants,service,types}.ts` (steps 2, 4) | `onion-architecture` | ring 2 rules; ports, not module imports |
| `server/src/modules/evals/repository.ts`, `server/src/modules/skills/repository.ts` (step 3) | `onion-architecture`, `drizzle-orm-patterns` | ring 3 queries, transactions, `23505` → typed result |
| `server/src/modules/evals/routes.ts` (step 5) | `onion-architecture`, `fastify-best-practices` | ring 4, response schemas, 201/202/409/422 |
| `client/src/lib/hooks/evals.ts`, `client/src/components/eval-cases/**` (steps 6–9) | `frontend-ui-architecture`, `react-best-practices` | shared-vs-local placement, hook and state rules (form ↔ JSON sync without effects) |
| `client/src/app/**/_components/**` (steps 9, 10) | `frontend-ui-architecture`, `react-best-practices` | placement and component rules |
| `client/**/*.test.ts(x)` (steps 6–10) | `react-testing-library` | `fireEvent` (no `user-event`, `client/INSIGHTS.md:235`), mocked hooks |

Derived from the write-time row of `.claude/skills/pr-self-review/routing.md`. `security` and `typescript-expert` are review-time (the gate). Each skill is loaded once per implementer run, at the first step that needs it.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `server/test/contracts.test.ts` | 0 | `--file client/src/test/eval-contract-sync.test.ts` · `--file server/test/contracts.test.ts` (typecheck is red until steps 4 and 9, see step 0) | — |
| A — server | `server/src/db/schema/eval.ts`, `server/src/db/migrations/<next>_*.sql` + `meta/<next>_snapshot.json` + `meta/_journal.json` (generated; `0019` when this plan builds before the sibling), `server/src/modules/evals/{constants,helpers,types,repository,service,routes}.ts`, `server/src/modules/skills/repository.ts`, `server/test/evals-authoring-helpers.test.ts` (new), `server/test/evals-authoring-service.test.ts` (new), `server/test/evals-authoring.it.test.ts` (new), `server/test/evals-service.test.ts`, `server/test/evals-create-case.test.ts`, `server/test/evals-routes.test.ts`, `server/test/evals.it.test.ts` | 1–5 | `node scripts/verify.mjs server --checks` · `--file server/test/<file>` | step 0 |
| B — client | `client/messages/en/{eval,skills}.json`, `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/evals.test.tsx`, `client/src/components/eval-cases/**` (new), `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**`, `client/src/app/skills/[id]/_components/SkillEditor/{SkillEditor.tsx,SkillEditor.test.tsx,constants.ts}`, `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/**` (new) | 6–10 | `node scripts/verify.mjs client --checks` · `--file <test>` | step 0 |
| shared — integration | no new files; only fixes the full run exposes, inside the owning track's files | 11 | `docker info`, then `node scripts/verify.mjs server client --it` (the one full run) | A, B |

No path appears in two rows. Each track is one `implementer` invocation. If a track finds a contract defect, it stops and reports it. Step 0 is re-opened, and neither track edits `vendor/shared`.

## Steps

### 0. Contracts: case input, run requests, case run state, row marker (mirrored)
- **Files:** [`server/src/vendor/shared/contracts/eval-ci.ts`](server/src/vendor/shared/contracts/eval-ci.ts) (edit) · [`client/src/vendor/shared/contracts/eval-ci.ts`](client/src/vendor/shared/contracts/eval-ci.ts) (edit, byte-identical copy) · [`server/test/contracts.test.ts`](server/test/contracts.test.ts) (edit)
- **Track:** shared
- **Layer:** `@devdigest/shared` contracts
- **Skills:** `zod`
- **Do:**
  - Replace the unused, loose `EvalCaseInput` (`eval-ci.ts:27-38`) with the strict create/update body below. `owner_kind`/`owner_id` come from the URL, never the body.
    ```ts
    EvalCaseInput = z.object({
      name,              // trimmed; 1..120 code points (refine on Array.from(s).length)
      input_diff,        // string, 1..65_536 UTF-8 bytes (refine via new TextEncoder().encode(s).length)
      input_meta: z.object({ pr_title /* ≤300 code points */, pr_body /* ≤16_384 UTF-8 bytes */ }).strict(),
      expectation: EvalExpectation,
      target: EvalTarget,   // refined: start_line <= end_line (issue path ['target','start_line'])
    }).strict()
    ```
    `TextEncoder` exists in Node 22 and in browsers, so the same contract runs on both sides (Rec. 7). Export the numeric caps as one `EVAL_CASE_LIMITS` const (`nameChars: 120, diffBytes: 65_536, prTitleChars: 300, prBodyBytes: 16_384, expectedJsonBytes: 8_192`) so the editor reads the same numbers.
  - Add `EvalCaseRunRequest = z.object({ host_agent_id: z.string().uuid().optional() }).strict()` and `EvalSkillRunRequest = z.object({ host_agent_id: z.string().uuid() }).strict()`.
  - Extend `EvalCaseListItem` with `latest_single: z.object({ run_id: z.string(), status: EvalCaseResultStatus, started_at: z.string() }).nullable()`. It is non-null only when that single run is newer than the latest completed suite run of the owner (AC-13).
  - Add `EvalCaseRunState = z.object({ latest: z.object({ run: EvalSuiteRun, result: EvalCaseResult }).nullable(), running: EvalSuiteRun.nullable() })`. `latest` is the newest finished result row of this case, from a run of either kind. `running` is a `running` single run of this case.
  - Fix the stale comment on `EvalRunKind` (`eval-ci.ts:47`): `single` belongs to the case-authoring sibling, not run-controls.
  - Copy the server file over the client file unchanged.
  - In `server/test/contracts.test.ts`, add `EvalCaseInput` boundary cases:
    - name `"  "` rejected; 120 code points (including one astral emoji) accepted; 121 rejected;
    - `input_diff` of exactly 65 536 bytes accepted; 65 537 rejected; 65 535 ASCII + one 2-byte `é` (65 537 bytes) rejected;
    - `pr_title` 300/301; `pr_body` 16 384/16 385 bytes;
    - `start_line` 0 rejected; `start_line` 5 `end_line` 4 rejected; 4/4 accepted;
    - an extra key `owner_id` rejected;
    - `EvalSkillRunRequest` `{}` rejected; `EvalCaseRunRequest` `{}` accepted.
- **Done when:** both copies are byte-identical and the boundary cases pass. **Known red window:** `server` and `client` `typecheck` are red after this step, because `latest_single` is a required field and the producer (`service.ts:166` `listCases` returns `EvalCaseList`) and the client fixtures (`EvalsTab.test.tsx:32` builds an `EvalCaseListItem`) do not set it yet. Step 4 (server) and step 9 (client) turn them green. Do not weaken it to `.optional()` to avoid the window. The other additions (`EvalCaseInput` replacement, `EvalCaseRunRequest`, `EvalSkillRunRequest`, `EvalCaseRunState`) are unused today and cause no red.
- **Verify:** `node scripts/verify.mjs client --file client/src/test/eval-contract-sync.test.ts` · `node scripts/verify.mjs server --file server/test/contracts.test.ts`

### 1. Schema: per-case running key, owner-keyed suite index (one generated migration)
- **Files:** [`server/src/db/schema/eval.ts`](server/src/db/schema/eval.ts) (edit) · `server/src/db/migrations/<next>_<generated>.sql` + `meta/<next>_snapshot.json` + `meta/_journal.json` (new / generated; the latest applied migration is `0018`, so `<next>` is `0019` unless the sibling plan landed first)
- **Track:** A
- **Layer:** ring 3 (schema)
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`
- **Do:**
  - Add `singleCaseId: uuid('single_case_id').references(() => evalCases.id, { onDelete: 'set null' })` (nullable) to `evalRuns`.
  - Change `oneRunningSuiteUq` to `.on(t.ownerId)`, keeping the same `WHERE status='running' AND kind='suite'`. For agent-owned runs `owner_id = agent_id`, so the parent's EC-6 holds unchanged (Rec. 1).
  - Add `oneRunningSingleUq: uniqueIndex('eval_runs_one_running_single_uq').on(t.singleCaseId).where(sql\`status='running' and kind='single'\`)` and `singleCaseIdx: index('eval_runs_single_case_idx').on(t.singleCaseId)` (set-null target).
  - Run `cd server && pnpm db:generate`. If it prompts, stop: generate the index drop alone first, then the add. Never hand-write SQL.
- **Done when:** the generated `<next>_*.sql` contains `ADD COLUMN "single_case_id"`, the FK `ON DELETE set null`, a `DROP INDEX` / `CREATE UNIQUE INDEX "eval_runs_one_running_suite_uq" … ("owner_id") WHERE …`, and `CREATE UNIQUE INDEX "eval_runs_one_running_single_uq" … WHERE …`. `cd server && pnpm db:migrate` applies cleanly on the dev DB.
- **Verify:** inspect the generated SQL for the two `WHERE` clauses, then `cd server && pnpm db:migrate`. (`--checks` is not meaningful yet: typecheck is red from step 0 until step 4.)

### 2. Pure logic: manual-case diff rules, name key
- **Files:** [`server/src/modules/evals/helpers.ts`](server/src/modules/evals/helpers.ts) (edit) · [`server/src/modules/evals/constants.ts`](server/src/modules/evals/constants.ts) (edit) · `server/test/evals-authoring-helpers.test.ts` (new)
- **Track:** A
- **Layer:** ring 2 (pure)
- **Skills:** `onion-architecture`
- **Do:**
  - `pastedDiffFiles(raw: string)` returns either `{ ok: true; files: { path: string; ranges: [number, number][] }[] }` or `{ ok: false; reason: 'diff_unparseable' | 'diff_needs_git_headers' }`. It follows `parseUnifiedDiff`'s file rules exactly:
    - a file starts at `diff --git` or, without one, at the first `+++ `;
    - the `b/` prefix is stripped and the path trimmed (so CRLF is tolerated);
    - `+++ /dev/null` files are dropped.
    `ranges` are maximal runs of consecutive new-side numbers of `+` lines (Q1).
    - `diff_needs_git_headers`: the text has no `diff --git` line and more than one `+++ ` header line that directly follows a `--- ` line (Q4).
    - `diff_unparseable`: no file with a path, or no `@@` hunk at all.
  - `checkManualTarget(files, target)` returns `null`, or `{ reason: 'target_file_not_in_diff', field: 'target.file' }`, or `{ reason: 'target_outside_changes', field: 'target' }`. The path must be equal, case-sensitive, like `findingMatches` (`helpers.ts:140`). Overlap is inclusive.
  - `caseNameKey(name)` returns `name.trim().toLowerCase()` (Q3).
  - Reuse `caseFingerprint` unchanged for manual cases and edits.
  - `constants.ts`: `MAX_CASES_PER_AGENT` stays and applies per owner; add a `MAX_CASES_PER_OWNER` alias only if the name reads wrong at the call site. `MAX_FROZEN_DIFF_BYTES`, `MAX_PR_TITLE_CHARS`, `MAX_PR_BODY_BYTES` and `MAX_CASE_NAME_CHARS` become re-exports of step 0's `EVAL_CASE_LIMITS` (`diffBytes`, `prTitleChars`, `prBodyBytes`, `nameChars`) with unchanged values, so the caps have one source of truth and the client cannot drift from the server (`INSIGHTS.md:357-362`). The contract is the innermost ring, so ring 2 may import it.
- **Done when:** `evals-authoring-helpers.test.ts` pins these cases (the same fixture strings appear in step 7's client test):
  - (a) a `diff --git` 2-file diff gives 2 files;
  - (b) a bare single-file `---/+++` diff (the editor placeholder from `eval.json` `caseEditor.diffPlaceholder`) gives 1 file `src/config.ts` with range `[10,10]`: the hunk is `@@ -10,6 +10,7 @@` and its first body line is the added one;
  - (c) a bare 2-file diff gives `diff_needs_git_headers`;
  - (d) a hunk without file headers gives `diff_unparseable`;
  - (e) a file header without a hunk gives `diff_unparseable`;
  - (f) a `+++ /dev/null` deletion as the only file gives `diff_unparseable`;
  - (g) the root-level path `README.md` is kept as `README.md`;
  - (h) CRLF line endings parse the same as LF;
  - (i) target `src/a.tsx` against a diff of `src/a.ts` gives `target_file_not_in_diff`, and `src/A.ts` likewise (case variant);
  - (j) a range ending exactly on the first added line passes, and one ending one line before it gives `target_outside_changes`;
  - (k) a deletion-only hunk has no ranges;
  - (l) `caseNameKey(" Stripe-Key ") === caseNameKey("stripe-key")`.
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-authoring-helpers.test.ts`

### 3. Ports and persistence: owner-generic cases, kind-aware runs, skill cleanup
- **Files:** [`server/src/modules/evals/types.ts`](server/src/modules/evals/types.ts) (edit) · [`server/src/modules/evals/repository.ts`](server/src/modules/evals/repository.ts) (edit) · [`server/src/modules/skills/repository.ts`](server/src/modules/skills/repository.ts) (edit) · [`server/test/evals-service.test.ts`](server/test/evals-service.test.ts) (edit, fake only) · [`server/test/evals-create-case.test.ts`](server/test/evals-create-case.test.ts) (edit, fake only)
- **Track:** A
- **Layer:** ring 2 port (`types.ts`), ring 3 repositories
- **Skills:** `drizzle-orm-patterns` (`onion-architecture` already loaded)
- **Do:**
  - `types.ts`:
    - add `EvalOwner = { kind: 'agent' | 'skill'; id: string }`;
    - add `EvalSkill = { id; name; source; body; version }`;
    - `NewCase` gains `ownerKind`, `source`, and `sourceFindingId: string | null`;
    - new `CasePatch` (name, inputDiff, inputMeta, expectation, target, fingerprint);
    - `NewRun` gains `kind`, `ownerKind`, `ownerId`, `singleCaseId: string | null`;
    - `InsertRunResult`'s failure carries `kind`.
    Widen `EvalsStore` with the methods below.
  - `repository.ts`:
    - `ownedBy(ws, owner)` takes an `EvalOwner`.
    - `countCases`/`listCases` take an `EvalOwner`.
    - `insertCaseIfAbsent` stays for findings.
    - New `insertCase(row)` for manual cases (`source: 'manual'`, `sourceFindingId: null`).
    - New `updateCase(ws, id, patch)`, workspace-scoped, returning the DTO or `undefined`. It never changes `source`, `source_finding_id`, `owner_*` or `expected_output` (EC-12).
    - New `caseNames(ws, owner, excludeId?)`.
    - Replace `SUITE(ws)` by `AGENT_SUITE(ws)` = workspace + `kind='suite'` + `owner_kind='agent'`. Use it in `listRuns`, `getRun` (Compare), `latestCompletedRuns`, `recentRuns` and the conflict lookup (Rec. 1).
    - Add a `SKILL_SUITE(ws, skillId)` path for skill reads (`listRuns` with an owner arg).
    - `insertRunningRun(row)` writes `row.kind`/`ownerKind`/`ownerId`/`singleCaseId`. On `23505` it looks up the running row by `owner_id` (suite) or `single_case_id` (single).
    - `failStaleRunning(ws, activeIds, reason)` drops the `kind` filter and the agent filter: it sweeps every `running` row of the workspace not in `activeIds` (Rec. 2).
    - `getRunWithResults(ws, id)` answers any kind, so a single run can be polled through `GET /eval-runs/:id`.
    - New `latestSingleByCase(ws, caseIds)` returns a map from case id to `{ runId, status, startedAt }`, from `eval_run_cases ⋈ eval_runs` where `kind='single'`, newest per case.
    - New `latestCaseResult(ws, caseId)` returns `{ run, result }` for the newest result row of either kind, or `undefined`.
    - New `runningSingle(ws, caseId)`.
  - `skills/repository.ts` `deleteById`: wrap it in `db.transaction`. First delete `eval_runs` where `owner_kind='skill' AND owner_id=id` (`eval_run_cases` cascade), then `eval_cases` where `owner_kind='skill' AND owner_id=id`, then the skill. Update its doc comment (Rec. 5; precedent `agents/repository.ts:74-95`).
  - Update the `FakeStore` classes in the two existing test files to the widened port. Typecheck does not see `server/test/**` (`server/INSIGHTS.md:139-142`), so grep `test/` for `implements EvalsStore` and fix each fake.
- **Done when:** the existing hermetic eval tests still pass on the updated fakes. Their behaviour is unchanged: a suite run is still `kind:'suite'`, `owner_kind:'agent'`. (`typecheck` stays red until step 4 sets `latest_single`; lint and arch are checked here.)
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-service.test.ts --file server/test/evals-create-case.test.ts`

### 4. Service: manual create/edit, single-case runs, skill runs, skill reads
- **Files:** [`server/src/modules/evals/service.ts`](server/src/modules/evals/service.ts) (edit) · `server/test/evals-authoring-service.test.ts` (new)
- **Track:** A
- **Layer:** ring 2
- **Skills:** (loaded)
- **Do:**
  - `EvalsDeps.skills` gains `getById(ws, id): Promise<EvalSkill | undefined>` and `linkedAgentIds(skillId): Promise<string[]>`. These are structural ports, wired in step 5.
  - `createManualCase(ws, owner, input)`. The order is fixed:
    1. resolve the owner (agent via `agents.getById`, skill via `skills.getById`) → 404;
    2. `case_limit` (200 per owner) → 422 `eval_case_rejected` `{reason:'case_limit'}`;
    3. `pastedDiffFiles(input.input_diff)` → 422 `{reason, field:'input_diff'}`;
    4. `checkManualTarget` → 422 `{reason, field}`;
    5. name clash via `caseNameKey` → 422 `{reason:'name_taken', field:'name'}`;
    6. insert with `caseFingerprint`.
    It makes no model call (NFR-2). The diff, title and body are stored exactly as received (NFR-1).
  - `updateCase(ws, id, input)`: same checks against the case's own owner, excluding itself from the name check. The fingerprint is recomputed every save (AC-8), so a rename alone keeps it and a target change changes it.
  - Refactor `startRun` into a private `launch({ kind, owner, agent, skills: EvalSkill[] | blocks, cases, singleCaseId })` that does: active-set registration → insert → fire-and-forget `execute` → crash handling. `startRun(ws, agentId)` becomes a thin wrapper with identical behaviour.
  - `startCaseRun(ws, caseId, hostAgentId?)`, in this order:
    1. case → 404;
    2. agent-owned: `hostAgentId` present → 422 `eval_host_invalid` `{reason:'host_not_allowed'}`; the agent → 404; skills = `blocksForAgent(agent.id)`;
    3. skill-owned: `hostAgentId` absent → 422 `eval_host_invalid` `{reason:'host_required'}`; the host → 404; host ∉ `linkedAgentIds(skill.id)` → 422 `eval_host_invalid` `{reason:'host_not_linked', host_agent_id}`; skills = `[skill]` (current body and version, regardless of the `enabled` flags);
    4. `launch({ kind:'single', singleCaseId: caseId, cases:[case] })`. A conflict → 409 `eval_case_run_in_progress` `{run_id}` (EC-8).
    A running suite of the same owner does not block it.
  - `startSkillRun(ws, skillId, hostAgentId)`: skill → 404; host → 404; not linked → 422 `eval_host_invalid`; no cases → 422 `eval_set_empty`; then `launch({ kind:'suite', owner:{kind:'skill',id}, agent: host, skills:[skill] })`. A conflict → 409 `eval_run_in_progress`. The 404/422 paths must return before `deps.llm` or `deps.review` is touched (EC-11).
  - `listCases(ws, owner)`:
    - `last_result` comes from the owner's latest completed suite run (skill: any host);
    - `latest_single` comes from `latestSingleByCase`, kept only when its `startedAt` is later than that suite run's `started_at`, or when there is no completed suite run (AC-13).
    `listCases` for agents keeps its signature through a wrapper.
  - `caseRunState(ws, caseId)` → `EvalCaseRunState`.
  - `listSkillRuns(ws, skillId, limit)`.
  - `skillDashboard(ws, skillId)` → `EvalDashboard` with `owner_kind:'skill'` and `owner_name` = skill name:
    - `current` = latest completed skill suite run;
    - `delta` = `metricDelta`/`passDelta` against the newest earlier completed run with the **same `agent_id`** (AC-16), all `null` if there is none;
    - `trend` = completed skill runs; `recent_runs` = 20 newest; `running`;
    - `regressions: []`, `alert: null`, `agents: []`.
  - `sweep` becomes workspace-wide (no kind or agent filter).
  - Logs (NFR-7): `eval run started` and `eval run finished` gain `kind`, `ownerKind`, `ownerId`, `caseId` (single), `agentVersion` and `skills` (id + version). `eval run finished` carries `error` when failed. `eval case finished` is unchanged.
- **Done when:** `evals-authoring-service.test.ts` (fake store + `MockLLMProvider` + real engine) proves each of these:
  - **AC-6:** a manual create stores `source:'manual'`, `source_finding_id:null` and the fingerprint, with 0 provider calls; the case limit at 200 is rejected and 199 accepted.
  - **AC-8, EC-12:** edit keeps `source`/`source_finding_id`; a rename-only edit keeps the fingerprint; a target change changes it.
  - **EC-5 / Q3:** `"stripe-key"` vs existing `"Stripe-Key "` → `name_taken`; editing a case to its own name is allowed.
  - **AC-9, AC-10, NFR-2:** an agent-case single run makes exactly 1 `completeStructured` call with `maxRetries: 0` and the adapter `timeoutMs`, and records `kind:'single'`, `agent_version`, `skills`, `single_case_id` and the case fingerprint in `cases`.
  - **EC-8:** a second single start of the same case while the first runs → 409; a single start while a suite of that agent runs → 202.
  - **EC-9:** a throwing provider → result `errored` with the reason; run `failed`.
  - **AC-15:** a skill run's review input has exactly one skill block, the skill's body (wrapped when the source is not `manual`/`extracted`), and the host's prompt, model and strategy; `skills` records the skill version.
  - **EC-11:** an unlinked or deleted host → 422 or 404 with 0 provider calls.
  - **AC-16:** with runs [H1 run a, H2 run b, H1 run c], the skill dashboard deltas compare c with a, not b.
  - **AC-13:** a single newer than the latest suite sets `latest_single`; one older than it leaves `latest_single` null.
  - **NFR-7:** the `eval run finished` log entry carries kind, owner, version, status and error.
  - `server` `typecheck` is green again (the step-0 red window closes here).
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-authoring-service.test.ts --file server/test/evals-service.test.ts` then `node scripts/verify.mjs server --checks`

### 5. Routes, wiring and integration test
- **Files:** [`server/src/modules/evals/routes.ts`](server/src/modules/evals/routes.ts) (edit) · [`server/test/evals-routes.test.ts`](server/test/evals-routes.test.ts) (edit) · `server/test/evals-authoring.it.test.ts` (new) · [`server/test/evals.it.test.ts`](server/test/evals.it.test.ts) (edit only if an existing assertion depended on the old sweep or index)
- **Track:** A
- **Layer:** ring 4
- **Skills:** `fastify-best-practices` (`onion-architecture` loaded)
- **Do:**
  - Wire `skills: { blocksForAgent, getById: (ws,id) => container.skillsRepo.getById(ws,id) mapped to EvalSkill, linkedAgentIds: (id) => container.skillsRepo.agentsUsing(id).then(rs => rs.map(r => r.agentId)) }`. The ports stay lazy, as now.
  - New routes. Each one has `params: IdParams`, and every body is strict. Update the header comment block.

    | Route | Body | Response |
    |---|---|---|
    | `POST /agents/:id/eval-cases` | `EvalCaseInput` | `201: EvalCase` |
    | `POST /skills/:id/eval-cases` | `EvalCaseInput` | `201: EvalCase` |
    | `GET /skills/:id/eval-cases` | | `200: EvalCaseList` |
    | `PUT /eval-cases/:id` | `EvalCaseInput` | `200: EvalCase` |
    | `POST /eval-cases/:id/runs` | `EvalCaseRunRequest` | `202: EvalSuiteRun` |
    | `GET /eval-cases/:id/runs/latest` | | `200: EvalCaseRunState` |
    | `POST /skills/:id/eval-runs` | `EvalSkillRunRequest` | `202: EvalSuiteRun` |
    | `GET /skills/:id/eval-runs?limit=` | | `200: EvalSuiteRun[]` (`RunsQuery`) |
    | `GET /skills/:id/eval-dashboard` | | `200: EvalDashboard` |
  - `evals-routes.test.ts`: add hermetic 422 rows for every new route: non-uuid `:id`, extra body key, name `""`, a 65 537-byte diff, `start_line: 0`, start > end, `host_agent_id: "nope"`, and a skill run with `{}`.
  - `evals-authoring.it.test.ts` (Postgres, `startPg`, `MockLLMProvider`, one `buildApp` at a time):
    - **AC-6:** manual create, then `POST /agents/:id/eval-runs` includes it.
    - **EC-2:** 65 536 bytes → 201, 65 537 → 422 with `details[0].path` containing `input_diff`.
    - **EC-1:** bare 2-file → 422 `diff_needs_git_headers`.
    - **EC-5:** duplicate (case variant) → 422 `name_taken`.
    - **AC-8:** PUT changes the fingerprint and keeps the id.
    - **AC-9/AC-10:** single run → 202, then poll `GET /eval-runs/:id` until done. `GET /agents/:id/eval-runs`, `/agents/:id/eval-dashboard` (tiles, trend, `running`, regressions), `/eval/dashboard` and compare must **not** include it.
    - **EC-8:** two immediate single starts → one 409; both rows can never be `running` (DB index).
    - **AC-15/16, NG-2:** a skill suite on host H while H's own suite runs → both 202. The skill run appears only under `/skills/:id/eval-runs` and `/skills/:id/eval-dashboard`, never under H's agent routes or `/eval/dashboard`.
    - **EC-11:** unlinked host → 422, deleted host → 404, and the mock provider has 0 calls.
    - **AC-12:** `GET /eval-cases/:id/runs/latest` returns the newest result of either kind.
    - **Rec. 5:** deleting the skill removes its cases and runs.
    - **Restart:** a stale `running` single row is swept to `failed`, after which a new single start → 202.
- **Done when:** the hermetic route test is green, and the `.it` file is green with Docker actually running (check that the vitest output shows the tests executed, not skipped).
- **Verify:** `node scripts/verify.mjs server --file server/test/evals-routes.test.ts` · `docker info && node scripts/verify.mjs server --it --file server/test/evals-authoring.it.test.ts --file server/test/evals.it.test.ts`

### 6. Client data layer and strings
- **Files:** [`client/src/lib/hooks/evals.ts`](client/src/lib/hooks/evals.ts) (edit) · [`client/src/lib/hooks/evals.test.tsx`](client/src/lib/hooks/evals.test.tsx) (edit) · [`client/messages/en/eval.json`](client/messages/en/eval.json) (edit) · [`client/messages/en/skills.json`](client/messages/en/skills.json) (edit)
- **Track:** B
- **Layer:** `src/lib/hooks` over `src/lib/api.ts`
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- **Do:**
  - New exported key builders: `skillEvalCasesKey(skillId) = ["eval-cases","skill",skillId]`, `evalCaseRunStateKey(caseId) = ["eval-case-runs",caseId]`, `skillEvalDashboardKey(skillId) = ["skill-eval-dashboard",skillId]`. `invalidateEvals` also invalidates `["eval-case-runs"]` and `["skill-eval-dashboard"]`.
  - New hooks:
    - `useSkillEvalCases(skillId)`;
    - `useCreateEvalCase(owner: {kind:"agent"|"skill"; id})`, which POSTs `/agents|skills/${id}/eval-cases`;
    - `useUpdateEvalCase()`, which PUTs `/eval-cases/${id}`;
    - `useStartCaseRun()`, with variables `{caseId, hostAgentId?}`, POSTing `{}` or `{host_agent_id}`;
    - `useEvalCaseRunState(caseId)`, which polls every `POLL_MS` while `running` is non-null;
    - `useSkillEvalDashboard(skillId)`, which polls while `running`;
    - `useStartSkillEvalRun(skillId)`, POSTing `{host_agent_id}`; a 409 invalidates, as `useStartEvalRun` does.
    Every mutation invalidates through `invalidateEvals`.
  - `useDeleteEvalCase` also invalidates `["eval-cases"]` (prefix), so the skill list refreshes.
  - Strings, verbatim, under `eval.json` → `caseEditor`. Existing keys are kept. New:
    - `"tabs.files": "Files"`
    - `"filesHint": "Files and changed lines in the pasted diff. Read only: nothing here is sent to the model."`
    - `"filesEmpty": "Paste a diff to see its files."`
    - `"changedLines": "changed lines {ranges}"`
    - `"expectationLabel": "Expectation"`
    - `"fileLabel": "File"`
    - `"filePlaceholder": "Pick a file from the diff"`
    - `"startLineLabel": "Start line"`
    - `"endLineLabel": "End line"`
    - `"findingSkeleton": "Finding skeleton"`
    - `"runOnSave": "Run on save"`
    - `"cancel": "Cancel"`
    - `"diffInvalid": "This is not a unified diff with at least one file and one hunk."`
    - `"diffNeedsGitHeaders": "A diff with more than one file needs a diff --git line before each file."`
    - `"diffTooLarge": "The diff is {bytes, number} bytes; the limit is 65,536 bytes (64 KB)."`
    - `"targetFileMissing": "The file {file} is not in the diff."`
    - `"targetNoOverlap": "Lines {start}–{end} do not overlap a changed line of {file}."`
    - `"targetStartAfterEnd": "The start line is after the end line."`
    - `"targetLinesInvalid": "Line numbers must be whole numbers of 1 or more."`
    - `"nameRequired": "Enter a name."`
    - `"nameTooLong": "The name is longer than 120 characters."`
    - `"nameTaken": "Another case in this set already uses this name."`
    - `"titleTooLong": "The PR title is longer than 300 characters."`
    - `"bodyTooLarge": "The PR body is larger than 16 KB."`
    - `"jsonParseError": "This is not valid JSON."`
    - `"jsonShapeError": "The JSON must be one object with exactly the keys type, file, start_line and end_line. type is must_find or must_not_flag; lines are whole numbers of 1 or more."`
    - `"jsonTooLarge": "The expected output is larger than 8 KB."`
    - `"runNeedsSave": "Save the case before running it."`
    - `"runConflict": "This case is already running."`
    - `"discardTitle": "Discard unsaved changes?"`
    - `"discardBody": "Your edits to this case will be lost."`
    - `"discardConfirm": "Discard"`
    - `"keepEditing": "Keep editing"`
    - `"originWarning": "This case was made from a finding. Changing its expectation or target means it no longer mirrors that review decision. The link to the finding is kept."`
    - `"lastRun": { "title": "Last run", "none": "This case has not run yet.", "running": "Running this case…", "kindSuite": "Suite run", "kindSingle": "Single-case run", "agentVersion": "agent v{version}", "passed": "Passed", "failed": "Failed", "errored": "Errored", "expectedMustFind": "Expected: a finding at {target}", "expectedMustNotFlag": "Expected: no finding at {target}", "got": "Got: {count, plural, =0 {no findings} one {# finding} other {# findings}}, {matched} on the target", "duration": "{seconds} s", "cost": "cost {cost}", "error": "Reason: {reason}" }`
  - `eval.json` → `evalsTab`, new:
    - `"originFinding": "from finding"`
    - `"originManual": "manual"`
    - `"singleMarker": "single run: {result}"`
    - `"runAria": "Run eval case {name}"`
    - `"editAria": "Edit eval case {name}"`
  - `skills.json`:
    - `editor.tabs.evals: "Evals"`;
    - a new `evals` object:
      - `"title": "Eval cases"`
      - `"subtitle": "Recall / Precision / Citation for this skill. Deltas compare with the previous run on the same host agent."`
      - `"runAll": "Run all evals"`
      - `"running": "Running…"`
      - `"newCase": "New eval case"`
      - `"passingCount": "{passing} / {total} passing"`
      - `"noHost": "Link this skill to an agent first: running its evals needs a host agent."`
      - `"emptyCases": "No eval cases yet. Add one with “New eval case”."`
      - `"loadError": "Could not load this skill’s eval cases."`
      - `"latestRun": "Latest run on {agent} v{agentVersion} · skill v{skillVersion}"`
      - `"unknownAgent": "an agent no longer linked"`
      - `"runConflict": "This skill’s evals are already running."`
      - `"hostPicker": { "title": "Run on which agent?", "body": "The skill runs with the host agent’s prompt, model and strategy, and with only this skill enabled.", "label": "Host agent", "confirm": "Run", "cancel": "Cancel" }`
- **Done when:** `evals.test.tsx` asserts each new hook's URL and body: `{}` for an agent case run, `{host_agent_id}` for a skill case run and a skill suite run. It also asserts the polling stop condition and the invalidation of `["eval-cases"]`, `["eval-case-runs"]` and `["skill-eval-dashboard"]`.
- **Verify:** `node scripts/verify.mjs client --file client/src/lib/hooks/evals.test.tsx`

### 7. Shared pure helpers: pasted diff → files, expectation JSON
- **Files:** `client/src/components/eval-cases/case-diff.ts` + `case-diff.test.ts` (new) · `client/src/components/eval-cases/expectation-json.ts` + `expectation-json.test.ts` (new) · `client/src/components/eval-cases/helpers.ts` (new; receives `targetLabel`, `EXPECTATION_KEY`, `RESULT_KEY`, `RESULT_COLOR` moved from `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts`, plus `ORIGIN_KEY: Record<EvalCaseSource,string>`) · `client/src/components/eval-cases/index.ts` (new barrel, named exports only)
- **Track:** B
- **Layer:** `src/components/eval-cases` (shared by two features)
- **Skills:** (loaded)
- **Do:**
  - `parsePastedDiff(raw)` returns `{ ok: true; files: (PrFile & { ranges: [number,number][] })[] }` or `{ ok: false; reason: "empty" | "unparseable" | "needs_git_headers" }`. It applies the same rules as step 2's `pastedDiffFiles` (`b/` strip, trim, `/dev/null` dropped, `+` runs, header-less multi-file rejection). `patch` is the hunk text only, from the first `@@`, so `DiffViewer` renders it as it renders a PR file. `additions`/`deletions` are counted.
  - `utf8Bytes(s)` via `TextEncoder`; `formatRanges(ranges)` gives `"12, 20–24"`; `overlapsChanged(file, start, end)`.
  - `formatExpectationJson({type,file,start_line,end_line})` gives two-space JSON with keys in that order. `parseExpectationJson(text)` returns `{ok:true,value}` or `{ok:false, reason:"too_large"|"parse"|"shape"}`:
    - over 8 192 bytes → `too_large`;
    - `type` not in the enum, missing/extra keys, or non-integer lines or lines < 1 → `shape`;
    - start > end is **not** a shape error: it flows to the form and EC-3 names it.
- **Done when:**
  - `case-diff.test.ts` runs the same fixture strings (a)–(h), (k) as `server/test/evals-authoring-helpers.test.ts` and expects the same files and ranges, plus the near-miss `src/a.ts`/`src/a.tsx` as two distinct files and `utf8Bytes` of 65 536 / 65 537;
  - `expectation-json.test.ts` pins a round-trip, `{"type":"must_find"}` (missing keys) → `shape`, an extra key → `shape`, `start_line: 1.5` → `shape`, a trailing comma → `parse`, and 8 192 / 8 193 bytes.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/eval-cases/case-diff.test.ts --file client/src/components/eval-cases/expectation-json.test.ts`

### 8. EvalCaseEditor (shared modal)
- **Files:** `client/src/components/eval-cases/EvalCaseEditor/{EvalCaseEditor.tsx,EvalCaseEditor.test.tsx,helpers.ts,styles.ts,index.ts}` (new) · `client/src/components/eval-cases/index.ts` (edit)
- **Track:** B
- **Layer:** shared component; data through `@/lib/hooks/evals`
- **Skills:** (loaded)
- **Do:**
  - Props: `{ owner: {kind,id}; initial?: EvalCase; takenNames: string[]; onClose(): void; onRun(caseId: string): void; runBlockedReason?: string | null }`. The tab owns how a run starts: agent → `useStartCaseRun`, skill → host picker. That keeps hosts out of the editor.
  - Layout follows design 06 (`Modal` width 920):
    - title `caseEditor.newCase` or `caseEditor.caseTitle`;
    - left column: name `TextInput`, then `Tabs` "Diff" / "Files" / "PR meta":
      - Diff: a `Textarea` plus, below it, `DiffViewer` over `parsePastedDiff(...).files`, or the `diffInvalid`/`diffNeedsGitHeaders`/`diffTooLarge` line;
      - Files: a read-only list of `path` + `changedLines`, or `filesEmpty`, plus `filesHint`;
      - PR meta: title and body inputs;
    - right column: expectation select (`must_find`/`must_not_flag`, labels from `evalsTab.mustFind`/`mustNotFlag`), file select whose options are **only** the parsed paths, start/end number inputs, a "Finding skeleton" button, the JSON `Textarea` with a text badge "valid JSON"/"invalid JSON" plus the reason line, the EC-12 `originWarning`, and the last-run panel.
  - **Sync (AC-4, EC-4):**
    - the form fields are the source of truth;
    - the JSON text is derived from them while the user is not editing the JSON;
    - a JSON edit that parses and fits the shape writes the fields;
    - a JSON edit that does not leaves the fields at their last valid values, marks the badge "invalid JSON" with `jsonParseError`/`jsonShapeError`/`jsonTooLarge`, and disables Save.
    Use event handlers, not `useEffect` (react-best-practices; `set-state-in-effect` is a lint warning, `client/INSIGHTS.md:238`).
  - **Skeleton (AC-5):** sets type = the current select, file = the first parsed file, lines = that file's first range. It is disabled while the diff is invalid.
  - **Validation for Save:** `helpers.ts` `draftErrors(draft, parsed, takenNames, selfName?)`:
    - shape via `EvalCaseInput.safeParse`: name, sizes, start ≤ end;
    - the EC-3 target messages;
    - `nameTaken` through the same trim + lowercase key as the server.
    Each error renders its message next to its field. Save is disabled while any exists or nothing changed.
  - **Save:** `useCreateEvalCase(owner)` or `useUpdateEvalCase()`. On success the editor switches to the saved case (a new case gets its id) and clears dirty. If the "Run on save" toggle is on, it then calls `onRun(id)` (AC-11). The toggle starts **off** (Q-3).
  - A server 422 shows `error.message` in an `role="alert"` line.
  - **Run case:**
    - disabled with the visible `runNeedsSave` text when the case is new or dirty (EC-7);
    - disabled with `runBlockedReason` when the tab gives one (EC-10);
    - otherwise `onRun(id)`.
  - **Last run (AC-12, EC-9):** `useEvalCaseRunState(caseId)`. Show:
    - `running` → `lastRun.running`;
    - `latest` → kind (`kindSuite`/`kindSingle`), `agentVersion`, the status as text, expected (`expectedMustFind`/`expectedMustNotFlag` with `targetLabel`), `got` (count of result findings and `matched`), duration (seconds, one decimal), `cost` via `formatCost` ("—" when null), and `lastRun.error` with the reason when errored;
    - neither → `lastRun.none`.
  - **Close (EC-6):** the X, the backdrop, Cancel and Escape all route through one `requestClose`. When dirty it opens `ConfirmModal` (`discardTitle`/`discardBody`/`discardConfirm`/`keepEditing`); otherwise it calls `onClose`.
  - **Accessibility (NFR-5):**
    - every field has an accessible name: wrap kit inputs that take no `aria-label` in a `<label>` holding the visible label text;
    - the toggle is `<label>{t("caseEditor.runOnSave")}<Toggle …/></label>`, so `getByRole("switch", { name: "Run on save" })` resolves;
    - tabs are buttons;
    - validity and results are text, never colour alone.
- **Done when:** `EvalCaseEditor.test.tsx` (hooks mocked, `fireEvent`) covers:
  - **AC-1:** every field and tab by role/name.
  - **AC-2:** pasting fixture (a) renders two file cards by path.
  - **AC-3:** the file select has exactly the diff's paths (not `src/a.tsx` when only `src/a.ts` is present); the Files tab shows `changed lines 10` for the placeholder diff.
  - **AC-4:** editing start line updates the JSON, and editing the JSON updates the select.
  - **AC-5:** the skeleton fills from the first file's first range.
  - **AC-11:** on → save → `onRun` called once with the new id; off → not called.
  - **AC-12, EC-9:** the panel shows kind, version, "Errored" and the reason.
  - **EC-1:** a bare hunk shows `diffInvalid` and Save is disabled.
  - **EC-2:** 65 537 bytes shows the size and Save is disabled; 65 536 bytes is allowed.
  - **EC-3:** the file-missing, no-overlap and start-after-end messages.
  - **EC-4:** invalid JSON keeps the previous select value, shows "invalid JSON" and disables Save.
  - **EC-5:** an empty name, 121 characters, and `" Taken "` against `takenNames: ["taken"]`.
  - **EC-6:** dirty close asks, and "Discard" calls `onClose`.
  - **EC-7:** dirty → Run case disabled with "Save the case before running it."
  - **EC-12:** changing the target of a `source:"finding"` case shows `originWarning`.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/eval-cases/EvalCaseEditor/EvalCaseEditor.test.tsx`

### 9. EvalCaseList (shared rows) and the agent Evals tab
- **Files:** `client/src/components/eval-cases/EvalCaseList/{EvalCaseList.tsx,EvalCaseList.test.tsx,styles.ts,index.ts}` (new) · `client/src/components/eval-cases/index.ts` (edit) · `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (edit) · `.../EvalsTab/EvalsTab.test.tsx` (edit) · `.../EvalsTab/helpers.ts` (delete; moved in step 7) · `.../EvalsTab/styles.ts` (edit)
- **Track:** B
- **Layer:** shared component + route-local tab
- **Skills:** (loaded)
- **Do:**
  - `EvalCaseList` props: `{ cases: EvalCaseListItem[]; onEdit(c); onRun(c); onDelete(c); runBlockedReason?: string | null; runningCaseId?: string | null }`. Each row shows:
    - the name;
    - an origin badge with the text `from finding` / `manual` (AC-7);
    - `expectation · targetLabel`;
    - the main suite result badge (existing `RESULT_KEY`);
    - when `latest_single` is set, a secondary muted marker with the text `single run: passed|failed|errored` (AC-13), so the main badge is unchanged;
    - `IconBtn`s Run (`Play`, `evalsTab.runAria`, disabled with `title` = `runBlockedReason` when given), Edit (`Pencil`, `evalsTab.editAria`) and Delete (existing).
  - Agent `EvalsTab`:
    - adds a "New eval case" button (`t("caseEditor.newCase")`) next to "Run all evals";
    - renders `EvalCaseList`;
    - mounts `EvalCaseEditor` for new and edit, with `takenNames` = the other cases' names;
    - `onRun` = `useStartCaseRun().mutate({ caseId })`; a 409 shows `caseEditor.runConflict` in the existing alert style;
    - keeps tiles, Run all and the delete confirm unchanged.
- **Done when:**
  - `EvalCaseList.test.tsx` covers: **AC-7**, both origin texts; **AC-13**, the marker text present only with `latest_single`, and the main badge still showing the suite result; **AC-9**, Run/Edit/Delete callbacks with the row's case; `runBlockedReason` disables Run;
  - `EvalsTab.test.tsx` covers: "New eval case" opens the editor; Edit opens it with the case name; a row Run calls the mutation with `{caseId}`; a 409 shows "This case is already running."; the existing tests are updated for the new `latest_single` field (every `EvalCaseListItem` fixture in `client/` sets it — grep `EvalCaseListItem` under `client/src`);
  - `client` `typecheck` is green again (the step-0 red window closes here).
- **Verify:** `node scripts/verify.mjs client --file client/src/components/eval-cases/EvalCaseList/EvalCaseList.test.tsx --file "client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx"` then `node scripts/verify.mjs client --checks`

### 10. Skill Evals tab with host picker
- **Files:** `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/{EvalsTab.tsx,EvalsTab.test.tsx,styles.ts,index.ts}` (new) · `.../SkillEditor/_components/EvalsTab/_components/HostPickerModal/{HostPickerModal.tsx,HostPickerModal.test.tsx,index.ts}` (new) · `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx` (edit) · `.../SkillEditor/constants.ts` (edit) · `.../SkillEditor/SkillEditor.test.tsx` (edit only if it enumerates tabs)
- **Track:** B
- **Layer:** route-local feature
- **Skills:** (loaded)
- **Do:**
  - `constants.ts`: `VALID_TABS` gains `"evals"`; `TABS` gains `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }`. `SkillEditor.tsx` renders `{tab === "evals" && <EvalsTab skillId={skill.id} />}` and updates its header comment.
  - `EvalsTab` (`useTranslations("skills")` for its own text):
    - data: `useSkillEvalCases`, `useSkillEvalDashboard`, `useSkillAgents` (linked hosts), `useAgents` (names for past hosts);
    - header `evals.title` + `evals.subtitle`, and `MetricTiles dashboard={…}` (AC-16);
    - a `latestRun` line from `recent_runs[0]` (agent name, `agent_version`, the skill's version from `skills[]`), falling back to `unknownAgent`;
    - "Run all evals" → `HostPickerModal` → `useStartSkillEvalRun.mutate(hostId)` (AC-15);
    - "New eval case" → the shared editor with `owner={kind:"skill", id}`;
    - `EvalCaseList` whose row Run, and the editor's `onRun`, open the same picker and then `useStartCaseRun.mutate({caseId, hostAgentId})` (Q2);
    - with no linked agent, Run all and every Run are disabled and the visible `evals.noHost` line is shown (EC-10);
    - a 409 shows `evals.runConflict` (skill run) or `caseEditor.runConflict` (case run).
  - `HostPickerModal`: `Modal` with `hostPicker.title`/`body`, a labelled select of the linked agents, defaulting to the host of the latest skill run when it is still linked and otherwise the first linked agent, plus Confirm/Cancel.
- **Done when:**
  - `EvalsTab.test.tsx` covers: **AC-14**, the list renders the same row content (origin, expectation · target, result, marker) and New/Edit open the shared editor; **AC-15**, Run all → picker → mutate with the chosen host id; **EC-10**, an empty `useSkillAgents` → Run all disabled and the text "Link this skill to an agent first: running its evals needs a host agent."; **AC-16**, the tiles render from the dashboard's `current`/`delta`;
  - `HostPickerModal.test.tsx` covers the default selection rule and Cancel making no call;
  - `?tab=evals` resolves (the `VALID_TABS` membership is asserted in the existing or new test).
- **Verify:** `node scripts/verify.mjs client --checks` · `node scripts/verify.mjs client --file "client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/EvalsTab.test.tsx" --file "client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/_components/HostPickerModal/HostPickerModal.test.tsx"`

### 11. Integration: full verify and smoke
- **Files:** none new; only fixes the full run exposes, inside the owning track's files.
- **Track:** shared
- **Do:**
  1. Run `docker info`. If Docker is down, report the `--it` lane as **unexecuted**, not green.
  2. Run `cd server && pnpm db:migrate`, then `./scripts/dev.sh`.
  3. Smoke on the agent Evals tab:
     - "New eval case" → paste the placeholder diff → Finding skeleton → Save with "Run on save" on → the last-run panel goes from running to a result;
     - the row shows the `manual` badge and the `single run: …` marker;
     - `/eval` and `/eval/{agent}` show no new run.
  4. Smoke on a skill linked to an agent:
     - the Evals tab → New eval case → Run all evals → pick the host → the tiles appear;
     - the agent's own Evals tab and `/eval` do not show that run.
  5. Real runs cost money. Use one cheap model and at most a handful of cases.
- **Done when:** both packages are green with the `--it` lane executed, and both smoke paths behave as described.
- **Verify:** `node scripts/verify.mjs server client --it` (the one full run)

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server --file server/test/contracts.test.ts` | NFR-3, UI-1/2/4/5 shape boundaries (120/121 code points, 65 536/65 537 bytes, 300/301, 16 384/16 385, line 0, start > end, strict extra key) |
| server | `node scripts/verify.mjs server --file server/test/evals-authoring-helpers.test.ts` | AC-3/5 ranges, EC-1 (bare multi-file, hunk-less, `/dev/null`), EC-3 (`.tsx` near-miss, case variant, edge overlap ±1), root-level path, CRLF, Q3 name key |
| server | `node scripts/verify.mjs server --file server/test/evals-authoring-service.test.ts` | AC-6, AC-8 fingerprint, AC-9/10, AC-13, AC-15, AC-16 same-host delta, EC-5, EC-8, EC-9, EC-11 zero calls, NFR-2 one call, NFR-7 logs, case limit 199/200 |
| server | `node scripts/verify.mjs server --file server/test/evals-service.test.ts --file server/test/evals-create-case.test.ts --file server/test/evals-routes.test.ts` | parent behaviour unchanged on the widened port; new routes' 422s |
| server | `node scripts/verify.mjs server --it --file server/test/evals-authoring.it.test.ts --file server/test/evals.it.test.ts` (Docker) | AC-6, AC-8, AC-9/10 and NG-2 exclusion from every suite view, AC-12, AC-15/16, EC-1, EC-2, EC-5, EC-8 DB race, EC-11, NFR-1, Rec. 5 skill delete, the restart sweep |
| client | `node scripts/verify.mjs client --file client/src/test/eval-contract-sync.test.ts` | NFR-6 |
| client | `node scripts/verify.mjs client --file client/src/lib/hooks/evals.test.tsx` | hook URLs, bodies, polling, invalidation |
| client | `node scripts/verify.mjs client --file client/src/components/eval-cases/case-diff.test.ts --file client/src/components/eval-cases/expectation-json.test.ts` | client/server parity fixtures, 8 192/8 193 JSON bytes, EC-4 reasons |
| client | component tests of steps 8–10 | AC-1–5, AC-7, AC-11–15, EC-1–7, EC-10, EC-12, NFR-4, NFR-5 |
| server + client | `node scripts/verify.mjs server client --it` | the one full run |

## Risks & rollback
- **The step-0 contract makes both packages' typecheck red until steps 4 and 9.** A track that runs `--checks` before its closing step sees a red it did not cause; each track's steps are ordered so the red closes inside the track. · Rollback: revert the `latest_single` edit in both copies.
- **The index swap prompts or misgenerates in drizzle-kit** (step 1). If the `WHERE` is missing, EC-8 and the parent's EC-6 race. Check the SQL; if it is wrong, split into two generated migrations (drop, then create). Never hand-edit. Rollback: revert the schema edit and delete the unapplied migration files plus their journal entry, before anyone migrates.
- **The owner filter misses a query,** and a skill run leaks into an agent view. The it-test asserts absence on every agent route and on `/eval/dashboard` (step 5). Rollback: revert step 3's repository edits; skill runs then must stay disabled.
- **The workspace-wide sweep** marks another process's run as failed when two API processes share a DB (the same per-process `active` limit the parent documents). Tests run one `buildApp` at a time.
- **Client/server diff rules drift.** Guarded by the shared fixture strings in steps 2 and 7. Any rule change edits both tests.
- **A `+++ `-prefixed added line** (content starting with `++ `) inside a hunk still confuses the shared parser. This is pre-existing, not introduced here. Noted as a Follow-up with Q4.
- **Deleting a host agent** cascades its hosted skill runs (`eval_runs.agent_id` FK), so a skill's history shrinks. This is accepted: the run's host no longer exists (EC-11's spirit).
- **The sibling run-controls build** edits the same server module files, hooks, strings and the agent `EvalsTab`, and generates its own migration. Sequence the two builds (this one first) and give the second its own migration number — see *Constraints → Sibling sequencing*.
- **Real model cost** in the smoke step only. Every automated test uses `MockLLMProvider`.

## Out of scope
- Whole-file context inputs (spec Q-1 / Non-goal), and any `reviewer-core` edit.
- Skill runs on the Eval Dashboard (Q-4 default). Multi-expectation or "empty" cases.
- Fixing `server/src/adapters/git/diff-parser.ts` for header-less multi-file diffs (Follow-up, Q4).
- Rewording the "cases come from findings" empty states (Rec. 8, Follow-up).
- `server/src/modules/evals/README.md` (routes, codes, the "Known limits" skill-cleanup line that this plan resolves), `server/README.md` and `client/README.md` Eval sections. These go to `doc-writer` (`/run-plan --docs`).
- In multi-agent mode, no track edits a file owned by another track; `vendor/shared` is step 0 only.
- Writing or amending the spec. A gap goes back to `spec-creator` or the person who owns the decision.
- Architectural review and security review, which separate agents own.
- Opening or pushing a PR, which `/pr-self-review` and the gate own.

## Open questions
- **Non-blocking:** Q1, what counts as a "changed line". Default taken: `+` lines only, in runs. The user decides.
- **Non-blocking:** Q2, per-case runs of skill-owned cases. Default taken: allowed through the host picker; `host_agent_id` is required for skill cases and refused for agent cases. The user decides.
- **Non-blocking:** Q3, name uniqueness. Default taken: trimmed and case-insensitive within the owner's set, enforced on manual create and every edit. Existing duplicate names from findings are left alone. The user decides.
- **Non-blocking:** Q4, header-less multi-file diffs. Default taken: reject them with `diff_needs_git_headers`, and leave the shared parser alone. The user decides.
- **Non-blocking:** Q5, the spec's Q-1 … Q-5. Default taken: all at the spec defaults. The user decides.
- **Non-blocking:** the AC-8 fingerprint. Default taken: recomputed on every save, over content only, so a rename alone keeps it. The user decides.
- **Non-blocking:** the expected-output JSON shape. Default taken: `{"type","file","start_line","end_line"}`, enforced client-side, including the 8 KB cap. The API takes `expectation` + `target` fields. The user decides.
