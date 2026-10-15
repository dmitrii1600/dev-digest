# Spec: Eval case confirmation modal and a one-command L06 test script
Spec ID: SPEC-2026-10-11-eval-case-confirm-modal
Status: approved
Supersedes: none
Packages: client, server

## Problem and user
An agent author reviewing a PR turns decided findings into eval cases. One click on "Turn into eval case" saves the case at once. Nothing shows what will be frozen or which expectation it gets, and nothing lets the author back out, so a stray click adds an unwanted case to the agent's regression set. Mentor feedback on lesson 06 asks for a confirmation step. It should preview the diff and offer Run, Save only and Cancel. A reviewer checking the L06 work also has no single command that runs only the eval pipeline's tests.
**Request vs tree:** differs in part. The click does save at once (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:67`). It does **not** navigate to the Evals tab, though. It shows an inline status line on the card (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:146`). This spec replaces only the "in that single action and without opening a form" clause of parent AC-2 (`specs/2026-10-05-eval-pipeline.md:47`). The mentor's example path `server/test/modules/evals` does not exist; the eval tests are flat files `server/test/evals*.test.ts`, `server/test/evals*.it.test.ts` and `server/test/seed-eval.it.test.ts`.

## Goals / Non-goals
**Goals**
- No eval case is stored from a finding until the author confirms in a modal that previews it.
- The author chooses between saving and running the case, saving only, and cancelling.
- One server script, `verify:l06`, runs the L06 eval tests without Docker; a second, `verify:l06:it`, runs their integration lane.
- A client script, also named `verify:l06`, runs the client's L06 eval tests in one hermetic command. No root `package.json` exists, and none is created: this is not a monorepo, and each package owns its scripts.

**Non-goals**
- New seeded eval cases. The author writes them in the UI.
- Any server route or contract change. The existing create and single-case-run endpoints are reused.
- Editing the case before saving. The case editor from `SPEC-2026-10-05-eval-case-authoring` already does that after save.

## User stories
- **US-1** As an agent author, I want to see what a finding will freeze into before it is saved, so that I only add cases I mean to keep.
- **US-2** As an agent author, I want to save and immediately run the new case, so that I see at once whether the agent passes it.
- **US-3** As a reviewer of the L06 work, I want one command that runs exactly the eval pipeline tests, so that I can check the feature without running the whole suite.

## Acceptance criteria (EARS)
- **AC-1** WHEN the user activates "Turn into eval case" on a decided finding, the PR page shall open a confirmation modal and send no create request. · traces: US-1 · verify: component
- **AC-2** The modal shall show the finding's title, severity, file and line range, and the expectation the case will get: `must_find` for an accepted finding, `must_not_flag` for a dismissed one. · traces: US-1 · verify: component
- **AC-3** The modal shall preview the hunk or hunks of the PR's diff for the finding's file that overlap the finding's line range. · traces: US-1, DR-1 · verify: component
- **AC-4** WHEN the user activates "Cancel", presses Escape or clicks outside the modal, the system shall close the modal and persist nothing. · traces: US-1 · verify: component
- **AC-5** WHEN the user activates "Save only", the system shall create the case and close the modal. The user shall stay on the PR page, and the card shall confirm the case was created, or say it already existed. · traces: US-1 · verify: component
- **AC-6** WHEN the user activates "Run", the system shall create the case and start a single-case run of it (parent authoring AC-9). It shall then open the owning agent's Evals tab. · traces: US-2, DR-2 · verify: component
- **AC-7** WHEN the hermetic L06 script named in Goals runs in `server`, the system shall run every hermetic eval test file (`server/test/evals*.test.ts` that are not `*.it.test.ts`) and no other file, without Docker. It shall exit non-zero if any test fails. · traces: US-3 · verify: manual
- **AC-8** WHEN the integration L06 script named in Goals runs in `server` with Postgres up, the system shall run the eval integration files (`server/test/evals*.it.test.ts` and `server/test/seed-eval.it.test.ts`) and no other file. · traces: US-3 · verify: manual
- **AC-9** WHEN the client L06 script named in Goals runs in `client`, the system shall run, without a server or Docker, every test under these areas: `client/src/app/eval/`, `client/src/components/eval-cases/`, `client/src/components/eval-metrics/`, the agent and skill Evals tabs (`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` and `client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/`, including HostPickerModal), the FindingCard and FindingsPanel folders, `client/src/lib/hooks/evals.test.tsx` and `client/src/test/eval-contract-sync.test.ts`. It shall run no test outside those areas and exit non-zero if any test fails. · traces: US-3 · verify: manual

Manual steps for AC-7, AC-8 and AC-9: (1) in the package, run the script; (2) check that the vitest file list holds exactly the files named; (3) break one assertion in one listed file, re-run, and confirm a non-zero exit.

## Edge cases
- **EC-1** WHILE a create or run request from the modal is in flight, the system shall disable "Run" and "Save only", so that a second activation sends no second request. · traces: DR-3 · verify: component
- **EC-2** IF creating the case fails, THEN the modal shall stay open and show the reason, using the existing card messages for a too-large diff and for a generic failure. The system shall persist nothing and enable the actions again. · traces: DR-4 · verify: component
- **EC-3** IF the case is saved but the single-case run fails to start for a reason other than "already running", THEN the system shall close the modal and stay on the PR page. The card shall say the case was saved but the run did not start. · traces: DR-4 · verify: component
- **EC-4** IF the run fails to start because that case is already running (409), THEN the system shall treat it as started and open the Evals tab. · traces: DR-4 · verify: component
- **EC-5** IF the PR's diff for the finding's file is not loaded, or holds no hunk at the finding's lines, THEN the modal shall say that a diff preview is not available and keep both save actions enabled. The server still freezes the diff from git or reports `diff_unavailable` under EC-2. · traces: DR-5 · verify: component
- **EC-6** IF the finding is already an eval case, THEN "Save only" shall report that it already exists, and "Run" shall run the existing case. · traces: DR-4 · verify: component
- **EC-7** WHILE the modal is open, the findings panel's keyboard shortcuts (j, k, a, d) shall not act on any finding. · traces: DR-6 · verify: component

## Design review
**Source:** none. The checklist was run against the tree.
### Gaps
- **DR-1** A preview of what will be frozen. Nothing shows it today: the click goes straight to `POST /findings/:id/eval-case` (`client/src/lib/hooks/evals.ts:131`). The frozen diff is computed only server-side (`server/src/modules/evals/service.ts:142-157`). The PR page already holds each file's patch (`PrFile.patch`, `server/src/vendor/shared/contracts/platform.ts:193`), so a client-side preview needs no new endpoint.
- **DR-2** Save-then-run from a finding does not exist. The single-case run exists (`POST /eval-cases/:id/runs`, `server/src/modules/evals/routes.ts:183`; `client/src/lib/hooks/evals.ts:104`), and the Evals tab is `/agents/<id>?tab=evals` (`client/src/app/agents/[id]/page.tsx:15`).
### Uncovered cases
- **DR-3** The same action twice: today the button is disabled only while the request is pending (`FindingCard.tsx:137`); the modal has two submit actions → EC-1.
- **DR-4** Error and interrupted states: create fails, run fails after a successful save, run already in progress (`server/src/modules/evals/service.ts:428`), case already exists (`EvalCaseCreateResult.created`, `server/src/vendor/shared/contracts/eval-ci.ts:223`) → EC-2, EC-3, EC-4, EC-6.
- **DR-5** Degraded data: the file has no persisted patch, so the server falls back to git (`server/src/modules/evals/service.ts:143-152`) → EC-5.
- **DR-6** Keyboard: the panel's window-level j/k/a/d handler ignores only inputs and textareas (`FindingsPanel.tsx:54-60`), so "a" or "d" pressed in the modal would change the decision, and with it the expectation → EC-7.
### Module interactions
| From | To | Through | Contract |
|---|---|---|---|
| `client` PR page modal | `server` `modules/evals` | `POST /findings/:id/eval-case` | `EvalCaseCreateResult` in server/src/vendor/shared/contracts/eval-ci.ts · existing |
| `client` PR page modal | `server` `modules/evals` | `POST /eval-cases/:id/runs` | `EvalSuiteRun` in server/src/vendor/shared/contracts/eval-ci.ts · existing |
| `client` PR page | `server` PR files read already on the page | existing | `PrFile` in server/src/vendor/shared/contracts/platform.ts · existing |
### UX improvements
- **DR-7** *proposed, adopted (Q-2)* "Save only" is the default focused action, not "Run", because a run spends LLM budget. Motivated by US-1. See Q-2.

## Non-functional requirements
- **NFR-1** Cost: opening and cancelling the modal sends no request; "Save only" sends exactly one; "Run" sends at most two and makes no LLM call beyond the single-case run. · verify: component
- **NFR-2** i18n: every label and message in the modal comes from `messages/en/prReview.json`; no literal user-facing text. · verify: static
- **NFR-3** Accessibility: the modal has the dialog role and an accessible name, puts focus on "Save only" when it opens (DR-7), and can be completed and cancelled with the keyboard alone. · verify: component
- **NFR-4** Size: the diff preview shows at most 200 lines, followed by a note that it is truncated. · verify: component
- **NFR-5** Maintainability: a new eval test file that follows the existing names (`evals*.test.ts`, `evals*.it.test.ts`) is picked up by AC-7 or AC-8 without editing either script. Likewise, a new client test placed in one of the AC-9 areas is picked up without editing the client script. · verify: manual

## Traceability
| Requirement | Traces to | Verify how |
|---|---|---|
| AC-1 | US-1 | component |
| AC-2 | US-1 | component |
| AC-3 | US-1, DR-1 | component |
| AC-4 | US-1 | component |
| AC-5 | US-1 | component |
| AC-6 | US-2, DR-2 | component |
| AC-7 | US-3 | manual |
| AC-8 | US-3 | manual |
| AC-9 | US-3 | manual |
| EC-1 | DR-3 | component |
| EC-2 | DR-4 | component |
| EC-3 | DR-4 | component |
| EC-4 | DR-4 | component |
| EC-5 | DR-5 | component |
| EC-6 | DR-4 | component |
| EC-7 | DR-6 | component |
| NFR-1 | US-1, US-2 | component |
| NFR-2 | US-1 | static |
| NFR-3 | US-1, DR-7 | component |
| NFR-4 | DR-1 | component |
| NFR-5 | US-3 | manual |

## Inputs and provenance
| Source | Path or URL | What it settled |
|---|---|---|
| request | caller brief quoting the mentor's L06 feedback (Ukrainian, translated) | confirm step with diff preview and Run / Save only / Cancel; a `verify:l06` script; seeding out of scope |
| answers | user, via the coordinator, 2026-10-11: "also add a `verify:l06` script to `client/package.json` (there is no root package.json and none should be created)"; Q-1 no supersede, Q-2 Save only is default focus, Q-3 200-line cap | AC-9, the Goals line, NFR-5; Q-1 to Q-3 resolved |
| repo | client/src/app/eval/ · client/src/components/eval-cases/ · client/src/components/eval-metrics/ · client/src/app/skills/[id]/_components/SkillEditor/_components/EvalsTab/_components/HostPickerModal/HostPickerModal.test.tsx | the client test areas exist; no root package.json |
| repo | client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:67 | the click creates at once; no navigation today |
| repo | server/src/modules/evals/service.ts:124-175 | what the case holds: file, lines, title, severity, expectation from accept/dismiss, frozen diff, PR title and body |
| repo | server/src/modules/evals/routes.ts:109, :183 | both endpoints exist, so no contract change is needed |
| repo | specs/2026-10-05-eval-pipeline.md:47 · specs/2026-10-05-eval-case-authoring.md:46 | parent AC-2 (one click, no form) and the single-case run (AC-9) |
| repo | server/package.json:6-16 | no eval-only script exists today |
| insights | client/INSIGHTS.md:75 | a confirm dialog must not render inside another `Modal` panel; relevant if the preview modal grows a nested confirm |
| insights | server/INSIGHTS.md:75 | `*.it.test.ts` files need Postgres; this is why the integration lane is a separate script (AC-8) |
| insights | server/INSIGHTS.md:431 | the hermetic lane is green on Windows, so AC-7 can be run locally |

## Untrusted inputs
| Input | Source | Validation | On invalid |
|---|---|---|---|
| Finding title, file path | LLM output persisted on the finding | *Text that is rendered*: plain text | rendered as plain text, never as HTML |
| File patch shown in the preview | GitHub PR diff | *Text that is rendered* and *Size and rate*: plain text, max 200 lines | rendered as plain text; cut at 200 lines with a truncation note |
| Finding id in the create request | client state | *Identity*: existing route resolves it in the workspace | 404 shown as the generic failure under EC-2 |

## Open questions
**Resolved decisions** (2026-10-11, decided by the user)
- Q-1, resolved: no supersede. `Supersedes: none` stays, because only one clause of parent AC-2 changes and the rest stays in force.
- Q-2, resolved: DR-7 adopted. "Save only" is the default focused action, since Run spends LLM budget.
- Q-3, resolved: the preview cap stays at 200 lines (NFR-4).

