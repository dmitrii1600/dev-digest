# Implementation Plan: Eval case confirmation modal + `verify:l06` scripts

**Plan ID:** 2026-10-11-eval-case-confirm-modal  ·  **Spec:** [specs/2026-10-11-eval-case-confirm-modal.md](specs/2026-10-11-eval-case-confirm-modal.md)  ·
**Execution mode:** single-agent  ·  **Packages:** client, server (`package.json` + one vitest config only)  ·
**Assumptions:**
- **A1:** while a request is in flight, Cancel, Escape, the backdrop and X are ignored too, so "closed" never means "saved anyway".
- **A2:** the modal component wires the dialog's accessible name by setting `aria-labelledby` on the kit `Modal`'s `role="dialog"` node. The vendor `Modal` has no name prop, and `src/vendor/ui` is do-not-touch.
- **A3:** the diff preview is a plain-text `<pre>`, not `DiffViewer`.

## Summary
"Turn into eval case" stops creating the case and opens a confirmation modal. The modal shows the finding's title, severity, file and lines, its expectation, and the PR-diff hunks that overlap the finding (capped at 200 lines). It offers **Save only** (focused by default), **Run** and **Cancel**. The modal is presentational. `FindingsPanel` owns:
- the two existing mutations (`POST /findings/:id/eval-case`, `POST /eval-cases/:id/runs`);
- the card status;
- the shortcut block;
- the navigation to `/agents/<owner_id>?tab=evals`.

The PR's `files` are passed down from the page as a prop. There is no new endpoint and no contract change. Three package scripts (`verify:l06` and `verify:l06:it` in `server`, `verify:l06` in `client`) select the L06 tests by include-glob config or path filter, so a new file that follows the naming is picked up without edits.

## Requirements review
**What I understood:** gate finding→eval-case creation behind a preview modal with Save only / Run / Cancel, and add per-package L06 test scripts.
**Inputs read:** spec · request text · AGENTS.md · client/AGENTS.md · client/INSIGHTS.md · server/INSIGHTS.md · INSIGHTS.md (grep) · routing.md · the files cited below.

### Requirements ledger
| # | Requirement (trimmed) | Source | Status |
|---|---|---|---|
| AC-1 | "open a confirmation modal and send no create request" | spec §AC-1 | clear |
| AC-2 | "title, severity, file and line range, and the expectation … `must_find` … `must_not_flag`" | §AC-2 | clear |
| AC-3 | "preview the hunk or hunks … that overlap the finding's line range" | §AC-3 | clear: same overlap rule as server `freezeDiff` ([server/src/modules/evals/helpers.ts:80](server/src/modules/evals/helpers.ts:80)) |
| AC-4 | "Cancel, presses Escape or clicks outside … persist nothing" | §AC-4 | clear |
| AC-5 | "Save only … create the case and close … stay on the PR page … card shall confirm … or say it already existed" | §AC-5 | clear |
| AC-6 | "Run … create the case and start a single-case run … open the owning agent's Evals tab" | §AC-6 | clear: owner is `res.case.owner_id` ([knowledge.ts:204-207](server/src/vendor/shared/contracts/knowledge.ts:204)), tab URL `/agents/<id>?tab=evals` ([client/src/app/agents/[id]/page.tsx:15](client/src/app/agents/[id]/page.tsx:15)) |
| AC-7 | "every hermetic eval test file (`server/test/evals*.test.ts` not `*.it.test.ts`) and no other file" | §AC-7 | clear |
| AC-8 | "`server/test/evals*.it.test.ts` and `server/test/seed-eval.it.test.ts` and no other file" | §AC-8 | clear: needs an include override (vitest 2 has no `--include`; path filters are OR'd substrings) |
| AC-9 | client areas list, "no test outside those areas" | §AC-9 | clear |
| EC-1 | "disable 'Run' and 'Save only'" while in flight | §EC-1 | clear (+ A1) |
| EC-2 | create fails → modal stays open, existing card messages, actions re-enabled | §EC-2 | clear: reuse `evalStatusForError` ([FindingsPanel/helpers.ts:28](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts:28)) |
| EC-3 | run fails (not 409) → close, stay, card says saved but run did not start | §EC-3 | clear: needs one new status + message |
| EC-4 | run 409 → treat as started, open Evals tab | §EC-4 | clear |
| EC-5 | no patch / no overlapping hunk → "preview not available", actions enabled | §EC-5 | clear |
| EC-6 | already a case → Save only says exists; Run runs the existing case | §EC-6 | clear: `created:false` still returns `case` ([eval-ci.ts:223](server/src/vendor/shared/contracts/eval-ci.ts:223)) |
| EC-7 | j/k/a/d do nothing while open | §EC-7 | clear |
| NFR-1 | open/cancel = 0 requests; Save only = 1; Run ≤ 2 | §NFR | clear |
| NFR-2 | all copy from `messages/en/prReview.json` | §NFR | clear |
| NFR-3 | dialog role + accessible name, focus on Save only, keyboard-completable | §NFR | ambiguous: kit `Modal` renders `role="dialog"` with no name and no name prop ([client/src/vendor/ui/kit/Modal.tsx:25-27](client/src/vendor/ui/kit/Modal.tsx:25)); resolved by A2 |
| NFR-4 | preview ≤ 200 lines + truncation note | §NFR | clear |
| NFR-5 | new files following the naming are picked up without editing scripts | §NFR | clear: glob/path-prefix selection, never file lists |
| UI-1 | finding title, file path rendered as plain text | §Untrusted inputs | clear |
| UI-2 | patch rendered as plain text, max 200 lines | §Untrusted inputs | clear |
| UI-3 | finding id → 404 shown as generic failure (EC-2) | §Untrusted inputs | clear (`evalStatusForError` maps non-422 to `error`) |

**Execution mode:** stated by caller, single-agent.

### Recommendations
1. **Keep the modal presentational; the panel owns the mutations.** Adopted. FindingsPanel already owns `evalStatus` and the create hook ([FindingsPanel.tsx:37-38](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:37)), and the EC-7 shortcut handler lives there too ([:53-65](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:53)).
2. **Pass `files` down as a prop; do not re-query PR detail in the panel.** Adopted. A second `usePullDetail` observer could refetch on mount, against NFR-1's spirit. `pr.files` is already on the page ([page.tsx:221](client/src/app/repos/[repoId]/pulls/[number]/page.tsx:221)).
3. **Select tests by vitest include-glob config, not CLI path filters, for AC-8 and AC-9.** Adopted. Vitest 2 ORs filters and cannot express "evals AND .it". The client paths contain `[id]`, which is a glob character class and fragile in a shell, so the globs use `*` for those segments.
4. **`ReviewRunAccordion.test.tsx` must be updated.** Adopted. It renders the real FindingsPanel and mocks the evals hooks module ([ReviewRunAccordion.test.tsx:19-21](client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.test.tsx:19)). Adding `useStartCaseRun` and `useRouter` to the panel would otherwise break it.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md), [client/AGENTS.md](client/AGENTS.md) | `src/vendor/ui` do-not-touch; no hardcoded text; `_components/<Name>/<Name>.tsx` + test; pnpm in client/server |
| [FindingsPanel.tsx](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx) | `turnIntoEval` at :67 creates immediately; shortcut handler :53-65 ignores only INPUT/TEXTAREA |
| [FindingCard.tsx:27-34,132-150](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:27) | `EvalCaseStatus` + `EVAL_STATUS_KEY` → card status line |
| [client/src/lib/hooks/evals.ts:104-115,131-137](client/src/lib/hooks/evals.ts:104) | `useStartCaseRun` (`{caseId}` → `EvalSuiteRun`) and `useCreateEvalCaseFromFinding` exist; no new hook needed |
| [client/src/vendor/ui/kit/Modal.tsx](client/src/vendor/ui/kit/Modal.tsx) | backdrop `onClick={onClose}`; X shown only when `onClose` is given; no Escape; no accessible name; body unpadded |
| [RunAllAgentsModal.tsx:23-29](client/src/app/eval/_components/EvalDashboardView/_components/RunAllAgentsModal/RunAllAgentsModal.tsx:23) | precedent: Escape via `document` keydown listener in the consumer |
| [ReviewRunAccordion.tsx:160-167](client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:160), [FindingsTab.tsx:162-171](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:162), [page.tsx:192-201](client/src/app/repos/[repoId]/pulls/[number]/page.tsx:192) | the prop chain `files` must travel |
| [server/src/modules/evals/service.ts:124-175](server/src/modules/evals/service.ts:124), [helpers.ts:56-86](server/src/modules/evals/helpers.ts:56) | server freezes per new-side hunk overlap `from <= end && start <= to` (to = from + max(len,1) − 1) |
| [server/vitest.config.ts](server/vitest.config.ts), [client/vitest.config.ts](client/vitest.config.ts), [server/package.json:6-16](server/package.json:6), [client/package.json:5-12](client/package.json:5) | include globs; no eval-only script today; vitest `^2.1.8` |
| `e2e/` (rg "Turn into eval case") | no e2e flow clicks the button, so no flow changes |
| [.claude/skills/pr-self-review/routing.md:41-50](.claude/skills/pr-self-review/routing.md:41) | write-time skills only |

## Insights that bind this work
1. **The kit `Modal` gives `children` no padding**, [client/INSIGHTS.md:48](client/INSIGHTS.md:48). The modal's `styles.ts` starts with `body: { padding: 24 }`.
2. **Never render a confirm dialog inside another `Modal`**, [client/INSIGHTS.md:75](client/INSIGHTS.md:75). The new modal is the only dialog. It renders as a sibling of the findings list inside FindingsPanel's root `div`, not inside a card. It also sits outside any clickable ancestor, which avoids the click-bubbling trap in [client/INSIGHTS.md:181](client/INSIGHTS.md:181): FindingCard's header has `onClick`, so the modal must **not** be rendered from inside `FindingCard`.
3. **`*.it.test.ts` needs Postgres and is a separate lane**, [server/INSIGHTS.md:75](server/INSIGHTS.md:75). AC-7 excludes `**/*.it.test.ts`, and AC-8 is its own script with its own include. The hermetic lane is green on Windows ([server/INSIGHTS.md:431](server/INSIGHTS.md:431)), so AC-7 can be checked locally.
- "What Doesn't Work": the plan does not edit `src/vendor/ui` ([client/INSIGHTS.md:175-180](client/INSIGHTS.md:175)). A2 is the workaround for the missing dialog name.

## Constraints
- `src/vendor/ui/**` and `src/vendor/shared/**` (client) are do-not-touch. No contract changes, so there is no mirror edit.
- No server source changes. `server/` gets only a `package.json` script pair and a new root `vitest.l06-it.config.ts`, and no lock-file is touched (no dependency change).
- Every user-facing string goes in `client/messages/en/prReview.json` and is read with `useTranslations("prReview")`.
- New component: `FindingsPanel/_components/EvalCaseConfirmModal/EvalCaseConfirmModal.tsx` + `EvalCaseConfirmModal.test.tsx` (folder = file = export name).
- Untrusted text (title, file, patch) is rendered as React text children only, never through `Markdown` or `dangerouslySetInnerHTML`.
- Scripts use escaped double quotes in `package.json` (Windows `cmd` does not strip single quotes).

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `client/src/app/repos/[repoId]/pulls/[number]/_components/**` (modal, panel, accordion, tab, page) | `frontend-ui-architecture`, `react-best-practices` | placement of the nested `_components` modal; state/effect/handler rules |
| `client/**/*.test.tsx`, `*.test.ts` | `react-testing-library` | query priority, async/act patterns |
| `server/package.json`, `server/vitest.l06-it.config.ts`, `client/package.json`, `client/vitest.l06.config.ts` | none | tooling config, no ring or component rules apply |

## Steps

### 1. Copy, card status, and `lineLabel` export
- **Files:** [`client/messages/en/prReview.json`](client/messages/en/prReview.json) (edit) · [`FindingCard/FindingCard.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx) (edit) · [`FindingCard/index.ts`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/index.ts) (edit)
- **Skills:** `frontend-ui-architecture`, `react-best-practices`
- **Do:**
  - Under the existing `finding` object, add `"evalRunNotStarted": "Eval case saved, but the run did not start."`
  - Add a top-level `"evalConfirm"` object with exactly these strings:
    `"title": "Create eval case"`, `"subtitle": "Check what this finding will freeze into before saving it."`, `"expectation": "Expectation"`, `"mustFind": "must_find"`, `"mustNotFlag": "must_not_flag"`, `"diffPreview": "Diff preview"`, `"previewUnavailable": "A diff preview is not available for this finding."`, `"previewTruncated": "Preview truncated to the first {count} lines."`, `"cancel": "Cancel"`, `"saveOnly": "Save only"`, `"run": "Run"`.
  - `EvalCaseStatus` gains `"run_failed"`, and `EVAL_STATUS_KEY.run_failed = "finding.evalRunNotStarted"`.
  - `FindingCard/index.ts` also re-exports `lineLabel` from `./helpers`.
- **Done when:** typecheck is green and `t("finding.evalRunNotStarted")` resolves for `run_failed`.
- **Verify:** `node scripts/verify.mjs client --checks`

### 2. `EvalCaseConfirmModal` (presentational) + preview helper + tests
- **Files (all new):** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/_components/EvalCaseConfirmModal/` → `EvalCaseConfirmModal.tsx`, `EvalCaseConfirmModal.test.tsx`, `helpers.ts`, `helpers.test.ts`, `constants.ts`, `styles.ts`, `index.ts`
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- **Do:**
  - `helpers.ts`: `previewHunks(files: PrFile[] | undefined, finding: Pick<FindingRecord,"file"|"start_line"|"end_line">): { lines: string[]; truncated: boolean } | null`.
    - It picks the file whose `path === finding.file` (exact, case-sensitive) with a non-empty `patch`.
    - It splits the patch into hunks at `^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@`, computing `to = from + max(len,1) − 1` (len defaults to 1). It keeps the hunks where `from <= end && start <= to`, using `start = max(1,start_line)` and `end = max(start,end_line)`, the server's rule.
    - It returns `null` when there is no file, no patch, or no overlapping hunk. Otherwise it returns the concatenated lines capped at `PREVIEW_MAX_LINES = 200` (in `constants.ts`), with `truncated` true when more existed.
  - Props: `{ finding: FindingRecord; files?: PrFile[]; busy: boolean; error: "too_large" | "error" | null; onSaveOnly(): void; onRun(): void; onCancel(): void }`.
  - It renders the kit `Modal` with:
    - `width={720}`;
    - `title={<span id={titleId}>{t("evalConfirm.title")}</span>}`;
    - `subtitle={t("evalConfirm.subtitle")}`;
    - `onClose={busy ? () => {} : onCancel}`, a no-op while busy so the X stays rendered but inert (A1).
  - The body shows, as plain text:
    - the finding title;
    - a non-compact `SeverityBadge`;
    - `{file}:{lineLabel(f)}`, with `lineLabel` imported from `"../../../FindingCard"`;
    - `t("evalConfirm.expectation")` with `mustFind` when `accepted_at` is set, else `mustNotFlag`;
    - under `t("evalConfirm.diffPreview")`, a `<pre>` with `lines.join("\n")` as a text child, plus `t("evalConfirm.previewTruncated", { count: PREVIEW_MAX_LINES })` when truncated. When the helper returns `null`, `t("evalConfirm.previewUnavailable")` replaces the `<pre>`.
  - When `error` is set it renders `role="alert"` with `t("finding.evalDiffTooLarge")` or `t("finding.evalCaseFailed")`.
  - Footer:
    - `Cancel` (ghost, disabled while busy);
    - `Run` (secondary, `disabled={busy}`);
    - `Save only` (primary, `autoFocus`, `disabled={busy}`).
  - A `document` keydown listener calls `onCancel` on Escape unless `busy` (RunAllAgentsModal pattern).
  - Accessible name (A2): a `useEffect` on a body-wrapper ref sets `aria-labelledby={titleId}` on `ref.current.closest('[role="dialog"]')`, with `titleId` from `useId`.
- **Done when:**
  - `getByRole("dialog", { name: "Create eval case" })` finds it.
  - "Save only" has focus on mount.
  - All tests below pass.
- **Tests to write:**
  - `helpers.test.ts`, covering the boundaries of NFR-4 and AC-3:
    - finding line equal to a hunk's last new-side line → kept;
    - one past it → dropped;
    - two overlapping hunks of three → both kept, the third not;
    - path case variant `src/Config.ts` vs `src/config.ts` → `null`;
    - near-miss path `src/config.ts.bak` → `null`;
    - `patch: null` / `undefined` / no file → `null`;
    - exactly 200 lines → `truncated: false`;
    - 201 lines → 200 lines, `truncated: true`;
    - hunk header without `,len` → treated as len 1.
  - `EvalCaseConfirmModal.test.tsx`:
    - AC-2: title, severity label, `src/config.ts:11`, `must_find` for an accepted finding and `must_not_flag` for a dismissed one.
    - AC-3: the overlapping hunk's text is shown and a non-overlapping hunk's text is not.
    - EC-5: unavailable message, both actions enabled.
    - NFR-4: truncation note at 201 lines, none at 200.
    - UI-1/UI-2: a title or patch containing `<b>x</b>` renders literally (no `b` element).
    - AC-4: Cancel, Escape (`fireEvent.keyDown(document, {key:"Escape"})`), the backdrop and X each call `onCancel`, and none calls `onSaveOnly`/`onRun`.
    - EC-1: with `busy`, Run and Save only are disabled, and neither Escape nor X calls `onCancel`.
    - EC-2: `error="too_large"` / `"error"` render the existing card strings in an alert.
    - NFR-3: dialog name, focus on Save only, and Enter-equivalent: a `fireEvent.click` on the focused button calls `onSaveOnly`. No `user-event` in `client/package.json`.
- **Verify:** `node scripts/verify.mjs client --file "src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/_components/EvalCaseConfirmModal/helpers.test.ts" --file "src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/_components/EvalCaseConfirmModal/EvalCaseConfirmModal.test.tsx"`

### 3. Wire the modal into FindingsPanel; pass `files` down from the page
- **Files (edit):** [`FindingsPanel/FindingsPanel.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx) · [`FindingsPanel/FindingsPanel.test.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx) · [`ReviewRunAccordion/ReviewRunAccordion.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx) · [`ReviewRunAccordion/ReviewRunAccordion.test.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.test.tsx) · [`FindingsTab/FindingsTab.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx) · [`page.tsx`](client/src/app/repos/[repoId]/pulls/[number]/page.tsx)
- **Skills:** already loaded
- **Do:**
  - Add an optional `files?: PrFile[]` prop through `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel`. `page.tsx` passes `files={pr.files}`.
  - In FindingsPanel:
    - State: `confirming: FindingRecord | null`, `busy`, `modalError`, plus a `busyRef` guard.
    - `onTurnIntoEval={() => setConfirming(f)}` sends nothing (AC-1).
    - The keyboard handler returns early when `confirming` is set (EC-7). Add it to the deps.
    - Render `<EvalCaseConfirmModal>` after the list when `confirming` is set. `onCancel` clears `confirming` and `modalError`.
    - Shared submit `(mode: "save" | "run")`:
      - If `busyRef.current`, return. Otherwise set busy.
      - `res = await createEvalCase.mutateAsync(f.id)`. On error: `setModalError(evalStatusForError(err))`, clear busy, return. The modal stays open (EC-2).
      - `save`: set the card status to `res.created ? "created" : "exists"`, then close (AC-5, EC-6).
      - `run`: `await startCaseRun.mutateAsync({ caseId: res.case.id })` (`useStartCaseRun`). On an `ApiError` with status 409, fall through as started (EC-4). On any other error, set the card status to `"run_failed"` and close (EC-3). On success or 409, `router.push(`/agents/${res.case.owner_id}?tab=evals`)` (`useRouter` from `next/navigation`) (AC-6).
    - Pass `evalPending={confirming !== null}` to the cards.
  - Tests, `FindingsPanel.test.tsx`:
    - Replace the `mutate` mock with `mutateAsync` mocks for `useCreateEvalCaseFromFinding` and `useStartCaseRun`, and add `vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))`.
    - Rewrite the two existing "Turn into eval case" tests to go through the modal.
  - Tests, `ReviewRunAccordion.test.tsx`: add `useStartCaseRun` to its evals mock and the same `next/navigation` mock.
- **Done when (FindingsPanel tests):**
  - AC-1 / NFR-1: clicking "Turn into eval case" opens the dialog with zero create calls, and Cancel leaves zero create and zero run calls.
  - AC-5: Save only → one create call with `"f1"`, zero run calls, dialog gone, `push` not called, and the status reads "Eval case created." (or "This finding is already an eval case." for `created:false`, EC-6).
  - AC-6: Run → create, then run with `{ caseId }` from the response, then `push("/agents/a1?tab=evals")`.
  - EC-6: Run with `created:false` runs the returned case id.
  - EC-1: two synchronous clicks on Save only (or Save only then Run) while create is pending → exactly one create call.
  - EC-2: create rejects 422 `diff_too_large` → the dialog stays with "The diff is too large to freeze as an eval case." and the buttons re-enabled. A 500 shows "Could not create the eval case." Run calls stay at zero.
  - EC-3: run rejects 500 → the dialog closes, there is no `push`, and the status reads "Eval case saved, but the run did not start."
  - EC-4: run rejects 409 → `push` is called.
  - EC-7: with the dialog open, `fireEvent.keyDown(window, {key:"a"})` and `"d"` → the `useFindingAction` mutate is not called. After Cancel, `"a"` does call it (control).
- **Verify:** `node scripts/verify.mjs client --file "src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx" --file "src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.test.tsx"`

### 4. `verify:l06` scripts (server hermetic + integration, client)
- **Files:** [`server/package.json`](server/package.json) (edit) · `server/vitest.l06-it.config.ts` (new) · [`client/package.json`](client/package.json) (edit) · `client/vitest.l06.config.ts` (new)
- **Do:**
  - `server/package.json` scripts:
    - `"verify:l06": "vitest run test/evals --exclude \"**/*.it.test.ts\""` (AC-7). The lowercase path filter matches only `test/evals*`, and `--exclude` is the same flag the root AGENTS hermetic command uses.
    - `"verify:l06:it": "vitest run --config vitest.l06-it.config.ts"` (AC-8).
  - `server/vitest.l06-it.config.ts` imports `base from './vitest.config'`. The import is extensionless, which is the documented vitest pattern; the file is outside the `tsconfig` `include`. It exports `defineConfig({ ...base, test: { ...base.test, include: ['test/evals*.it.test.ts', 'test/seed-eval.it.test.ts'] } })`. Do **not** use `mergeConfig`, because it concatenates `include` arrays.
  - `client/package.json`: `"verify:l06": "vitest run --config vitest.l06.config.ts"` (AC-9).
  - `client/vitest.l06.config.ts` uses the same spread pattern, with `include` set to exactly these globs. `*` stands in for the `[id]`/`[repoId]`/`[number]` segments, because brackets are glob classes:
    - `src/app/eval/**/*.test.{ts,tsx}`
    - `src/components/eval-cases/**/*.test.{ts,tsx}`
    - `src/components/eval-metrics/**/*.test.{ts,tsx}`
    - `src/app/agents/*/_components/AgentEditor/_components/EvalsTab/**/*.test.{ts,tsx}`
    - `src/app/skills/*/_components/SkillEditor/_components/EvalsTab/**/*.test.{ts,tsx}`
    - `src/app/repos/*/pulls/*/_components/FindingCard/**/*.test.{ts,tsx}`
    - `src/app/repos/*/pulls/*/_components/FindingsPanel/**/*.test.{ts,tsx}`
    - `src/lib/hooks/evals.test.tsx`
    - `src/test/eval-contract-sync.test.ts`
- **Done when** (manual, spec steps 1–2; record the file lists in the hand-off):
  - `cd server && pnpm run verify:l06` lists exactly the 7 hermetic files `evals-authoring-helpers`, `evals-authoring-service`, `evals-create-case`, `evals-helpers`, `evals-routes`, `evals-run-controls` and `evals-service` (`.test.ts`). It lists no `.it.` file and exits 0.
  - `cd client && pnpm run verify:l06` lists the 29 existing test files in the AC-9 areas plus the two new modal tests. It lists nothing from other folders such as `DiffTab/` or `ReviewRunAccordion/`, and exits 0.
  - `verify:l06:it` needs Docker. If Docker is unavailable, confirm the selection with `pnpm exec vitest list --config vitest.l06-it.config.ts`. It should show only `evals.it`, `evals-authoring.it`, `evals-authoring-edges.it`, `evals-run-controls.it` and `seed-eval.it`. Say so in the hand-off.
  - Spec step 3 (break an assertion → non-zero exit) is left to the person. Do not commit a broken test.
- **Verify:** `node scripts/verify.mjs client --checks` and `node scripts/verify.mjs server --checks`

### 5. Full verify
- **Done when:** both packages are green.
- **Verify:** `node scripts/verify.mjs client` · `node scripts/verify.mjs server`

## Test plan
| Package | Command | Covers |
|---|---|---|
| client | `node scripts/verify.mjs client --file …/EvalCaseConfirmModal/helpers.test.ts` | AC-3, NFR-4, EC-5 boundaries (hunk edge in/out, path case variant, near-miss path, 200 vs 201 lines) |
| client | `node scripts/verify.mjs client --file …/EvalCaseConfirmModal/EvalCaseConfirmModal.test.tsx` | AC-2, AC-3, AC-4, EC-1 (UI), EC-2 (UI), EC-5, NFR-2, NFR-3, NFR-4, UI-1, UI-2 |
| client | `node scripts/verify.mjs client --file …/FindingsPanel/FindingsPanel.test.tsx` | AC-1, AC-5, AC-6, EC-1, EC-2, EC-3, EC-4, EC-6, EC-7, NFR-1, UI-3 |
| client | `node scripts/verify.mjs client --file …/ReviewRunAccordion/ReviewRunAccordion.test.tsx` | regression: accordion still renders with the new hooks |
| server / client | `pnpm run verify:l06` (+ `verify:l06:it` or `vitest list`) | AC-7, AC-8, AC-9, NFR-5 (manual) |
| client | `node scripts/verify.mjs client` | lint · typecheck · full hermetic suite |
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic suite (no server source changed) |

## Risks & rollback
- **A2 sets a DOM attribute from an effect.** If the arch reviewer rejects it, the alternative is an additive `ariaLabelledBy` prop on the kit `Modal`. That edits `src/vendor/ui` and needs the owner's OK; see Open questions. Rollback: drop the effect, and the dialog stays unnamed (NFR-3 partially unmet).
- **The vitest config import does not resolve** (extensionless `./vitest.config`). Fallback: inline the `resolve.alias` and `test` fields in the new config instead of importing. Rollback: remove the script and the config file.
- **Existing panel tests assumed one-click creation.** They are rewritten in step 3. No e2e flow clicks "Turn into eval case" (`rg` over `e2e/`: no match), so no flow changes.

## Out of scope
- Any server route, service, contract or migration change. Seeded eval cases. Editing the case before saving.
- A root `package.json`.
- Refactoring `FindingCard`'s status line or the kit `Modal`.
- Writing or amending the spec.
- Architectural review and security review, which separate agents own.
- Opening or pushing a PR, which `/pr-self-review` and the gate own.

## Open questions
- **Non-blocking:** NFR-3 accessible name: is the A2 effect-set `aria-labelledby` acceptable, or may `client/src/vendor/ui/kit/Modal.tsx` gain an additive `labelledBy` prop? Default taken: A2, no vendor edit. The user decides.
- **Non-blocking:** should Cancel/Escape be allowed while a request is in flight? Default taken: no (A1). The spec is silent, and allowing it could close the modal on a case that still gets saved.
- **Non-blocking:** the spec does not fix the modal's title, subtitle and message copy. Default: the strings quoted in step 1.
