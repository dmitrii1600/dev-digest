# Spec: Eval case authoring — manual cases and the case editor, per-case runs, skill-level evals
Spec ID: SPEC-2026-10-05-eval-case-authoring
Status: approved
Supersedes: none
Packages: server, client

## Problem and user
This spec is a sibling of `SPEC-2026-10-05-eval-pipeline` (the parent). It builds on the parent's definitions: case, expectation types `must_find` / `must_not_flag`, frozen inputs, suite run, matching and metrics.
- **Manual cases.** The parent's one-click action only turns what an agent already found into a case. A bug the agent has never seen cannot become a case at all, for example one from someone else's incident or an edge case from a colleague's review. The set should grow from two sources: decision history and predicted future failures.
- **Per-case runs.** While writing a case, an author wants to try that one case without paying for the whole set. Doing so must not distort suite numbers.
- **Skill evals.** A skill author has no way to measure a skill on its own; skills reach a review only through an agent.
The user pulled these design extras into this lesson (parent Q-4, resolved 2026-10-05). The course stretch task "Case Editor: manual case creation" fixes the minimum shape of the editor.
**Request vs tree:** These points differ from what the request assumes:
- `eval_cases` already has columns for diff, files, meta, expected output and notes (`server/src/db/schema/eval.ts:7-21`). `EvalCaseInput` exists with `expected_output: unknown` (`server/src/vendor/shared/contracts/eval-ci.ts:20-29`). No route creates or updates a case.
- A diff viewer exists, shared by the PR Files-changed view (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:14`). It renders a list of files, each with a unified-diff `patch` (`:20`; `PrFile` in `server/src/vendor/shared/contracts/platform.ts:189-194`). A pasted diff has to be shown in that same per-file form.
- The review engine has no prompt slot for whole-file contents. Its parts are system prompt, skills, memory, specs, callers, repo map, PR description, intent and task (`reviewer-core/src/review/run.ts:137-147`). A "Files" input cannot reach the model without an engine change, which the parent's frozen-input rule (parent AC-7) excludes anyway.
- The `caseEditor` strings exist for the Diff and PR meta tabs only, with no Files key (`client/messages/en/eval.json`).
- The skill editor has Config, Preview, Versions, Stats and Context tabs, but no Evals tab (`client/src/app/skills/[id]/_components/SkillEditor/constants.ts:4`). Skills are versioned, and the agents linked to a skill are listed by `GET /skills/:id/agents` (`server/src/modules/skills/routes.ts:24-27`).

## Goals / Non-goals
**Goals**
- Create and edit a case by hand: paste a diff, preview it, then set the expectation type, the file and the line range. A manual case lives in the same set and runs through the same route as a case made from a finding.
- Run a single case from the editor or the case list, without touching suite metrics, history or Compare.
- Eval cases and suite runs for a skill, executed on a host agent with only that skill enabled.
**Non-goals**
- Whole-file context inputs reaching the model (Q-1).
- Skill eval runs on the Eval Dashboard; it stays agent-only (Q-4).
- Cases with more than one expectation, and a "no findings anywhere" case (design 05's `empty []`). A case has exactly one target, as in the parent.
- Harness evals under `evals/`, the PreToolUse test-gate hook and mutation testing. They are handled separately.

## User stories
- **US-1** As an agent author, I want to write a case from a pasted diff fragment, so that the set covers failures the agent has not produced yet.
- **US-2** As an agent author, I want to edit an existing case, so that I can fix a wrong target or a name.
- **US-3** As an agent author, I want to run one case on demand, so that I can check a case cheaply without changing suite numbers.
- **US-4** As a skill author, I want eval cases and runs for a skill, so that I can see whether a skill edit made reviews better or worse.

## Acceptance criteria (EARS)
- **AC-1** WHEN the user activates "New eval case" on the AgentEditor Evals tab, the editor shall open with: name, a Diff input, a PR meta input (title and body), a Files view, an expectation type (`must_find` / `must_not_flag`), a file, a line range, and an expected-output JSON panel. · traces: US-1, DR-1 · verify: component
- **AC-2** WHEN the user pastes or edits the diff, the editor shall show it as a per-file preview in the same form as the PR Files-changed view. · traces: US-1, DR-2 · verify: component
- **AC-3** The file field shall offer only files present in the pasted diff. The Files view shall list those files with their changed line ranges, read only. · traces: US-1, DR-3 · verify: component
- **AC-4** WHILE the expected-output JSON is valid, the editor shall keep it and the type, file and line-range fields in sync in both directions, and mark it "valid JSON". · traces: US-1 · verify: component
- **AC-5** WHEN the user activates "Finding skeleton", the editor shall fill the expectation with the selected type, the first file in the diff and that file's first changed line range. · traces: US-1 · verify: component
- **AC-6** WHEN the user saves a new case, the system shall store it in the agent's set as a manual case. It uses the same expectation types, the same frozen-input rules and the same 64 KB diff cap as a case from a finding (parent AC-2, EC-12). It is run by the same suite route. · traces: US-1, DR-1 · verify: integration
- **AC-7** The Evals tab shall label each case by origin: from finding, or manual. · traces: US-1 · verify: component
- **AC-8** WHEN the user activates Edit on a case, the editor shall open with the case's stored content. Saving shall update the case in place and give it a new content fingerprint (parent AC-9, EC-9). · traces: US-2 · verify: integration
- **AC-9** WHEN the user activates "Run case" in the editor, or the run action on a case row, the system shall start a single-case run of the saved case. It uses the agent's current configuration and the parent's scoring rules. · traces: US-3, DR-4 · verify: integration
- **AC-10** The system shall record a single-case run as a distinct run kind. It carries the agent version, the enabled skills with their versions, and the case fingerprint, and it never appears in suite metrics, run history, trend, Compare, the dashboard or the regression banner (parent NFR-12). · traces: US-3, DR-4 · verify: integration
- **AC-11** WHERE "Run on save" is switched on, the editor shall start a single-case run right after a successful save. · traces: US-3 · verify: component
- **AC-12** The editor shall show the case's latest run of either kind: its kind, agent version, pass/fail/errored, expected vs got, duration and cost. · traces: US-3 · verify: component
- **AC-13** WHEN a case's latest single-case run is newer than its latest suite run, the Evals-tab row shall show that single-case result as a secondary, labelled marker. The suite result shall stay as the row's main result. · traces: US-3 · verify: component
- **AC-14** The skill editor shall have an Evals tab that lists the skill's cases with the same row content, and creates and edits them with the same editor. · traces: US-4, DR-5 · verify: component
- **AC-15** WHEN the user activates "Run all evals" on a skill's Evals tab, the system shall ask for a host agent, chosen from the agents linked to the skill, and run the skill's set on that host. The run uses the host's prompt, model and strategy, with only the skill under test enabled, at the skill's current version. · traces: US-4, DR-6 · verify: integration
- **AC-16** WHEN a skill suite run completes, the system shall record the host agent and its version and the skill version. The skill's Evals tab shall show the three metrics with deltas against the previous suite run on the same host. · traces: US-4, DR-6 · verify: integration

## Edge cases
- **EC-1** IF the pasted diff does not parse as a unified diff with at least one file and one hunk, THEN the preview shall say so, Save shall be disabled, and the API shall reject the case with 422. · traces: DR-7 · verify: component
- **EC-2** IF the pasted diff exceeds 64 KB, THEN Save shall be disabled with the size stated, and the API shall reject it with 422. · traces: DR-7 · verify: integration
- **EC-3** IF the target file is not in the diff, or the line range does not overlap a changed line of that file, or the start line is after the end line, THEN Save shall be blocked with a message naming the problem. · traces: DR-8 · verify: component
- **EC-4** IF the expected-output JSON is invalid or does not fit the expectation shape, THEN the panel shall be marked invalid with the reason. The form fields shall keep their last valid values, and Save shall be disabled. · traces: DR-8 · verify: component
- **EC-5** IF the name is empty, longer than 120 characters, or already used in the same set, THEN Save shall be blocked and the API shall reject it with 422 naming the field. · traces: DR-8 · verify: integration
- **EC-6** IF the user closes the editor with unsaved changes, THEN the editor shall ask before discarding them. · traces: DR-9 · verify: component
- **EC-7** IF the editor has unsaved changes, THEN "Run case" shall be disabled and say the case must be saved first. · traces: DR-9 · verify: component
- **EC-8** IF a single-case run of the same case is still running, THEN a new single-case run of it shall be rejected with 409. A single-case run shall still be allowed while a suite run of the agent is running. · traces: DR-11 · verify: integration
- **EC-9** IF a single-case run's review call fails, THEN the result shall be recorded as errored, and the editor shall show the reason. · traces: DR-11 · verify: integration
- **EC-10** IF the skill is linked to no agent, THEN "Run all evals" on the skill's Evals tab shall be disabled and say a host agent is needed. · traces: DR-10 · verify: component
- **EC-11** IF the chosen host agent was deleted or unlinked from the skill before the run starts, THEN the run shall be rejected with 404 or 422, and no review call shall be made. · traces: DR-10 · verify: integration
- **EC-12** IF the user changes the expectation type or target of a case made from a finding, THEN the editor shall warn that the case will no longer mirror the original decision. The source-finding link shall be kept. · traces: DR-12 · verify: component

## Design review
**Source:** specs/designs/eval-pipeline/05-agent-editor-evals-tab.webp, 06-eval-case-editor-modal.webp, `source/screen_cizruns.jsx:64-100`, `source/screen_skills.jsx:126-137`; compared against the tree.
### Gaps
- **DR-1** No route creates or updates a case. The table and `EvalCaseInput` exist (`server/src/db/schema/eval.ts:7-21`, `server/src/vendor/shared/contracts/eval-ci.ts:20-29`).
- **DR-2** The diff viewer takes per-file patches (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:20`), and nothing turns pasted text into that shape today.
- **DR-3** There is no engine slot for whole-file inputs (`reviewer-core/src/review/run.ts:137-147`), so design 06's Files tab is a read-only view here.
- **DR-4** There is no run kind for a single case. The parent's suite run covers the whole set.
- **DR-5** The skill editor has no Evals tab (`client/src/app/skills/[id]/_components/SkillEditor/constants.ts:4`).
- **DR-6** Nothing executes a skill on its own. Skills reach a review only as an agent's enabled skills (`server/src/modules/agents/repository.ts:193-206`).
### Uncovered cases
- **DR-7** Design 06 shows no invalid or oversized diff → EC-1, EC-2.
- **DR-8** Only the "valid JSON" badge is shown, with no invalid target or name → EC-3, EC-4, EC-5.
- **DR-9** Unsaved changes on close or on Run case → EC-6, EC-7.
- **DR-10** A skill with no linked agent, or a host that disappears → EC-10, EC-11.
- **DR-11** Overlapping or failed single-case runs → EC-8, EC-9.
- **DR-12** Editing a case made from a finding → EC-12.
### Module interactions
| From | To | Through | Contract |
|---|---|---|---|
| `client` case editor | `server` `modules/evals` | `POST /agents/:id/eval-cases` · `POST /skills/:id/eval-cases` · `PUT /eval-cases/:id` | `EvalCaseInput` in server/src/vendor/shared/contracts/eval-ci.ts · existing, extended (expectation, target, origin) |
| `client` case editor, case row | `server` `modules/evals` | `POST /eval-cases/:id/runs` | `EvalSingleRun` · new |
| `client` skill Evals tab | `server` `modules/evals` | `POST /skills/:id/eval-runs` (host agent id) · `GET /skills/:id/eval-runs` | `EvalSuiteRun` (parent), with host fields · new |
| `client` skill Evals tab | `server` `modules/skills` | `GET /skills/:id/agents` | existing |
| `server` `modules/evals` | `reviewer-core` | `reviewPullRequest`, `groundFindings` | existing, unchanged |
### UX improvements
- **DR-13** *proposed* "Run on save" starts switched off; design 06 shows it on. Each run is a paid call → AC-11, Q-3.
- **DR-14** *proposed* The expected-output JSON stays editable and in sync with the form, rather than becoming a read-only view → AC-4, Q-5.

## Non-functional requirements
- **NFR-1** Frozen inputs: a manual case's diff, PR meta and expectation are stored as entered and never re-fetched or re-derived. Only an explicit edit (AC-8) changes them. · verify: integration
- **NFR-2** Cost: saving, validation, the preview and "Finding skeleton" make no model call. A single-case run makes exactly one review call. · verify: integration
- **NFR-3** Size: name ≤ 120 characters, diff ≤ 64 KB, PR title ≤ 300 characters, PR body ≤ 16 KB, expected-output JSON ≤ 8 KB. · verify: integration
- **NFR-4** i18n: every new string is read from `messages/en/eval.json` (or `skills.json` for the skill tab), with no literals in components. · verify: static
- **NFR-5** Accessibility: the editor's tabs, fields and toggle are keyboard operable with accessible names. Validity and run results are stated in text, not colour alone. · verify: component
- **NFR-6** Contract parity: every contract added or changed here is mirrored in the client copy of `@devdigest/shared` in the same change. · verify: static
- **NFR-7** Observability: each single-case run and each skill suite run logs its case or skill, the host or agent version, the outcome and any error reason. · verify: integration

## Traceability
| Requirement | Traces to | Verify how |
|---|---|---|
| AC-1 | US-1, DR-1 | component |
| AC-2 | US-1, DR-2 | component |
| AC-3 | US-1, DR-3 | component |
| AC-4 | US-1, DR-14 | component |
| AC-5 | US-1 | component |
| AC-6 | US-1, DR-1 | integration |
| AC-7 | US-1 | component |
| AC-8 | US-2 | integration |
| AC-9 | US-3, DR-4 | integration |
| AC-10 | US-3, DR-4 | integration |
| AC-11 | US-3, DR-13 | component |
| AC-12 | US-3 | component |
| AC-13 | US-3 | component |
| AC-14 | US-4, DR-5 | component |
| AC-15 | US-4, DR-6 | integration |
| AC-16 | US-4, DR-6 | integration |
| EC-1 | DR-7 | component |
| EC-2 | DR-7 | integration |
| EC-3 | DR-8 | component |
| EC-4 | DR-8 | component |
| EC-5 | DR-8 | integration |
| EC-6 | DR-9 | component |
| EC-7 | DR-9 | component |
| EC-8 | DR-11 | integration |
| EC-9 | DR-11 | integration |
| EC-10 | DR-10 | component |
| EC-11 | DR-10 | integration |
| EC-12 | DR-12 | component |
| NFR-1 | US-1 | integration |
| NFR-2 | US-3 | integration |
| NFR-3 | US-1 | integration |
| NFR-4 | US-1, US-4 | static |
| NFR-5 | US-1 | component |
| NFR-6 | US-1, US-4 | static |
| NFR-7 | US-3, US-4 | integration |

## Inputs and provenance
| Source | Path or URL | What it settled |
|---|---|---|
| request | course stretch task "Case Editor: manual case creation" (L06), relayed by the coordinator 2026-10-05 | The minimum editor shape (paste diff → preview, type, file, line range). Manual cases share the set and `POST /agents/:id/eval-runs`. The set grows from two sources. Design-06 extras are kept only where they do not conflict. |
| answers | user via coordinator, 2026-10-05: "pull ALL deferred design extras into this lesson's scope" | The case editor, per-case runs and skill-level evals are in scope. A per-case run is a distinct kind, excluded from suite views. The skill execution default is to be decided and flagged. |
| design | specs/designs/eval-pipeline/06-eval-case-editor-modal.webp; source/screen_cizruns.jsx:64-100 | Editor layout, Diff/Files/PR meta tabs, expected JSON, Finding skeleton, Run on save, Run case, last-run panel |
| design | specs/designs/eval-pipeline/05-agent-editor-evals-tab.webp | Row run/edit/delete actions, "New eval case" |
| design | specs/designs/eval-pipeline/source/screen_skills.jsx:126-137, :274 | Skill editor Evals tab |
| repo | client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx:14-20; server/src/vendor/shared/contracts/platform.ts:189-194 | Existing diff viewer and its per-file input |
| repo | reviewer-core/src/review/run.ts:137-147 | No whole-file prompt slot |
| repo | server/src/db/schema/eval.ts:7-21; server/src/vendor/shared/contracts/eval-ci.ts:20-29 | Case columns and input contract |
| repo | client/src/app/skills/[id]/_components/SkillEditor/constants.ts:4; server/src/modules/skills/routes.ts:24-27 | Skill tabs; skill versions; linked agents |
| insights | INSIGHTS.md:286-291 | Mirror contract changes into both shared copies → NFR-6 |
| insights | INSIGHTS.md:346-356 | Client and server trust rules drift → the pasted diff gets the same untrusted wrapping as a live review |
| insights | server/INSIGHTS.md:393-396 | "Exactly one call" needs transport retries off → NFR-2 |

## Untrusted inputs
| Input | Source | Validation | On invalid |
|---|---|---|---|
| Pasted diff | Editor form, any origin | Shape: unified diff with ≥ 1 file and ≥ 1 hunk, ≤ 64 KB. Rendered as plain text in the preview. Reaches the prompt as untrusted text under `INJECTION_GUARD` | 422 naming `input_diff`; an instruction inside it is data, never followed |
| PR title and body | Editor form | Title ≤ 300 characters, body ≤ 16 KB; plain text; reaches the prompt as untrusted | 422 naming the field |
| Expected-output JSON | Editor form | Strict expectation shape: type enum, file in the diff, integer lines ≥ 1 with start ≤ end, ≤ 8 KB | Marked invalid in the editor; 422 naming the field |
| Case name | Editor form | 1–120 characters, unique in the set, plain text | 422 naming `name` |
| `:id` of agent, skill, case; host agent id | URL params / body | uuid; resolves in the caller's workspace; the host is linked to the skill | 422 for shape; 404 for unknown or foreign ids |

## Open questions
- **Q-1 (non-blocking):** Files tab. Default: a read-only list of the diff's files and changed lines, with nothing extra sent to the model (DR-3). The alternative stores whole-file context and feeds it to the model, which needs a reviewer-core prompt slot and relaxes parent AC-7. — the user decides
- **Q-2 (non-blocking):** How is a skill executed? Default: on a host agent the user picks from the agents linked to the skill, with the host's prompt, model and strategy and only the skill under test enabled (AC-15). The alternative is a minimal built-in agent with a neutral prompt and only that skill, which needs a model choice that has no setting today. — the user decides
- **Q-3 (non-blocking):** "Run on save" starts switched off (DR-13), while design 06 shows it on. — the user decides
- **Q-4 (non-blocking):** Should skill suite runs also appear on the Eval Dashboard? Default: no; they appear on the skill's Evals tab only. — the user decides
- **Q-5 (non-blocking):** Expected-output JSON: editable and in sync with the form (default, DR-14), or a read-only view of the form? — the user decides
