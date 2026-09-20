# Conventions page and the Create-skill modal (studio)

**Status:** Implemented (2026-09-20). The cross-package spec is
[`../../specs/04-conventions-extractor.md`](../../specs/04-conventions-extractor.md);
this one covers only `@devdigest/web`.

## Problem

`messages/en/conventions.json` is a partial copy deck with no reader,
`activeKeyFor` returns `conventions` for a route that does not exist, and
`shell.json` has the nav label. The mock (`Skills Lab › Conventions`, the
three-card list, the *Create skill from conventions* modal) is the target.

## Scope

In:

- `/repos/[repoId]/conventions` — thin `page.tsx` over
  `_components/ConventionsView/`.
- `CandidateCard` with inline edit; `CreateSkillModal`; the selection bar.
- `Conventions` in `NAV` under SKILLS LAB, `g c` shortcut.
- `client/src/lib/hooks/conventions.ts`.
- `CONVENTION_CATEGORY_COLOR` in `lib/skill-tokens.ts`.
- Copy-deck growth in `conventions.json`.
- `e2e/specs/10-conventions.flow.json` (read-only, seeded scan).

Out:

- Polling / progress for an async scan — the request is synchronous.
- A "rejected" list with restore. The bar shows `N hidden`; that is all.
- Any change to `/skills`, `/skills/[id]` or the agent editor — the created
  skill shows up there through the existing hooks' cache invalidation.

## Contract

### Placement

| Component | Location | Interactive? |
|---|---|---|
| `ConventionsView` | `app/repos/[repoId]/conventions/_components/ConventionsView/` | yes — scan, selection bar, opens modal |
| `CandidateCard` | `.../ConventionsView/_components/CandidateCard/` | yes — accept / reject / edit inline |
| `CreateSkillModal` | `.../ConventionsView/_components/CreateSkillModal/` | yes — form, agent picks, create |

Each folder: `<Name>.tsx`, `<Name>.test.tsx`, `constants.ts`, `helpers.ts`,
`styles.ts`, `index.ts`. `page.tsx` reads `repoId` from `useParams` and hands
it down; the view uses `useRepoNotFound(repoId)` for the stale-id empty state
exactly as the PR list does.

### Idioms copied rather than reinvented

- **Route shape** is `/repos/[repoId]/pulls`'s: repo-scoped, `RepoProvider`
  derives the active repo from the path, the breadcrumb is
  `Skills Lab › Conventions` (`page.crumbLab` / `page.crumbConventions` exist).
- **Header** is the mock's: `Conventions in <code>name</code>` — the deck
  already carries `headingPrefix`; the subtitle is
  `Detected from {n} sample files · last scan {ago}` after a scan and
  `page.subtitle` before one.
- **Cards** are `Card` from `@devdigest/ui` with a left accent rule keyed on
  status (`accepted` → success, `rejected` never renders, `pending` → none),
  the rule as the title, a category `Badge` (colour from
  `CONVENTION_CATEGORY_COLOR`), a `MonoLink`-styled `path:line` with a copy
  `IconBtn`, the snippet in a mono block, and `ConfidenceNum` + `ProgressBar`
  for the percentage. An `edited` badge and an `In skill` badge when the flags
  are set.
- **Form model** is `ConfigTab`'s: one `useState` per field, reset on open, no
  form library, no client-side zod; mutation errors toast via `MutationCache`.
- **Modal** is `Modal` from `@devdigest/ui` (title, subtitle, `onClose`,
  `footer`) — criterion 51 says modal, not drawer.
- **Toggle / Checkbox / SearchableSelect / SelectInput / Textarea mono** all
  exist in `@devdigest/ui`; nothing is hand-rolled.

### `ConventionsView`

State: `scanning: boolean`, `modalOpen: boolean`. Data: `useConventions(repoId)`.

- No scan yet (`scan === null`) → `EmptyState` with **Run Scan** as the CTA
  (`page.empty.*`, CTA label `page.runScan`). A scan exists → **ReScan**
  (`page.rescan`, `RefreshCw` icon) in the header, regardless of how many
  candidates survived. These are two labels on one button, chosen by
  `scan === null`; criterion 45 wants both visible behaviours, not two
  buttons on screen at once.
- While the extract mutation is pending: button disabled, label
  `page.scanning`, cards dimmed. On error: `ErrorState` inline under the
  header with the server's message; the `repo_not_indexed` code gets its own
  copy pointing at the Indexed badge.
- **Selection bar** under the header: `Deselect all` (sets every accepted
  candidate back to `pending` — one `PATCH` each, batched with
  `Promise.all`), `{accepted} of {total} accepted`, `{hidden} rejected · hidden`
  when non-zero, and on the right **Create skill** (`Sparkles`), rendered only
  when `accepted > 0` (criterion 50) and disabled while any PATCH is in flight.
- List order is the server's (confidence desc).

### `CandidateCard`

Props: `candidate`, `onPatch(patch)`, `busy`.

- Buttons on the right, stacked as in the mock: **Accept** (primary when
  `pending`, filled/“Accepted ✓” when `accepted` — clicking again returns it to
  `pending`), **Reject**, **Edit**.
- **Edit** flips the card into inline mode (criterion 49): the title becomes a
  `Textarea` with the rule, the badge becomes a `SelectInput` over
  `ConventionCategory`, evidence stays read-only (it is what grounds the rule
  and cannot be edited into truth), and the buttons become **Save** / **Cancel**.
  Save sends `{ rule, category }` only when something changed; `Escape`
  cancels. The `edited` badge appears from the server's response, not from
  local state.
- Reject removes the card optimistically via the query cache and the hook's
  `onSuccess` invalidation confirms it; on error the card comes back (the
  toast explains).

### `CreateSkillModal`

Opens with `usePreviewConventionSkill(repoId)` fired once (`candidate_ids`
omitted → every accepted, unabsorbed candidate). Until it resolves, the body
area shows a `Skeleton`.

Fields, top to bottom, all editable (criterion 41):

- Banner (`Info` icon): *Merged from **N accepted conventions** in `repo`.
  Everything below is editable before you save.*
- **Name** (`TextInput`, default from the draft: `repo-conventions`).
- **Description** (`TextInput`, default `N house conventions extracted from
  <repo>`).
- **Type** (`SelectInput` over `SkillType`, default `convention`) and
  **Enabled** (`Toggle`, default on, hint *Whether this block is added to
  agents' prompts.*).
- **Agents** — a checkbox list from `useAgents()`, name + model chip.
  **Optional, nothing pre-checked** (revised 2026-09-20: the first cut
  pre-checked General Reviewer and required at least one). With none checked
  the hint says so and points at the agent editor's Skills tab; Create stays
  enabled and the skill lands unbound in Skills Lab.
- **Skill body** — `Textarea mono`, min 14 rows, with a header row showing
  `<name>.md`, an `unsaved` chip, and `≈ {n} tokens` computed as
  `Math.ceil(body.length / 4)` in `helpers.ts`. The counter is a hint; the
  run trace shows the real count.
- Footer: left, `Saved as v1 · added to Skills Lab` (muted, static — it says
  what Create does); right, **Cancel** and **Create skill** (`Sparkles`).

Create → `useCreateConventionSkill(repoId).mutate({...})` → the response is
`{ skill_id }` only; on success: toast `skill.created` with the name the user
typed, close, invalidate `['conventions', repoId]`, `['skills']` and
`['agent-skills', id]` for each chosen agent, and
`router.push('/skills/<skill_id>?tab=preview')` so the user lands on the rendered
body they just wrote (criterion 52 is then a click away in the sidebar, and
the list will show it because the query was invalidated).

### Navigation

`NAV` (`src/vendor/ui/nav.ts`, the sanctioned exception recorded in
`AGENTS.md`): `{ key: "conventions", label: "Conventions", icon: "ListChecks",
href: "/repos/:repoId/conventions", gKey: "c" }` appended to SKILLS LAB;
`{ keys: "g c", label: "Go to Conventions", group: "Navigation" }` in
`SHORTCUTS`. `resolveHref` fills `:repoId`; with no active repo the link goes
to `/repos/_/conventions` and the page's not-found state handles it, as the PR
list already does.

### Data — `lib/hooks/conventions.ts`, re-exported from `hooks/index.ts`

```ts
useConventions(repoId)                 // GET  …/conventions          key ['conventions', repoId]
useExtractConventions(repoId)          // POST …/conventions/extract  → setQueryData on success
useUpdateCandidate(repoId)             // PATCH …/conventions/:id     → invalidate ['conventions', repoId]
usePreviewConventionSkill(repoId)      // POST …/skill/preview        (useMutation — it is a POST that writes nothing;
                                       //   called once on modal open, result held in state)
useCreateConventionSkill(repoId)       // POST …/skill                → invalidate skills + agent-skills
```

All through `lib/api.ts`; types from `@devdigest/shared` (`ConventionCandidate`,
`ConventionScan`, `ConventionsPage`, `ConventionSkillDraft`, `ConventionCategory`,
`ConventionStatus`) re-exported through `lib/types.ts`.

### Copy — `conventions.json`

Keep the existing keys (`page.*`, `card.confidence`, `card.accepted`) and add:
`page.runScan`, `page.rescan` (already), `page.detectedFrom`
(`Detected from {count, plural, …} · last scan {ago}`), `page.notIndexed`,
`page.scanRunning`, `bar.deselectAll`, `bar.acceptedCount`, `bar.hidden`,
`bar.createSkill`, `card.accept`, `card.reject`, `card.edit`, `card.save`,
`card.cancel`, `card.edited`, `card.inSkill`, `card.category.<enum>`,
`modal.title` (*Create skill from conventions*), `modal.banner`, `modal.name`,
`modal.description`, `modal.type`, `modal.enabled`, `modal.enabledHint`,
`modal.agents`, `modal.agentsRequired`, `modal.body`, `modal.tokens`,
`modal.unsaved`, `modal.savedAs`, `modal.cancel`, `modal.create`,
`skill.created`. `card.acceptAsSkill` and `card.accepting` become unused and
are removed — a key nobody reads is the drift the deck already suffers from.

### Tests

- `ConventionsView.test.tsx` — hooks mocked, real `conventions.json`:
  no scan → Run Scan CTA; scan present → ReScan; `Create skill` absent with
  zero accepted and present with one; `3 of 3 accepted` counts; the
  `repo_not_indexed` error renders its specific copy.
- `CandidateCard.test.tsx` — Accept calls `onPatch({status:'accepted'})`;
  Reject → `rejected`; Edit shows the textarea and select; Save sends only
  changed fields; Escape cancels; evidence has no input.
- `ConventionSkillModal.test.tsx` (the component is `ConventionSkillModal`, not
  `CreateSkillModal` — that name belongs to the Skills Lab) — preview mutation
  called once on mount; fields prefilled from the draft; body is editable and
  the token counter follows it; no agent checked by default and Create still
  enabled; submit payload carries the edited body and the checked `agent_ids`
  (possibly `[]`).
- `e2e/specs/10-conventions.flow.json` — open `{BASE}/repos/<seeded>/conventions`
  via the sidebar entry, wait for the seeded rule text
  (`Always use async/await instead of .then() chains`), the `91%` confidence
  and the **ReScan** label. Read-only; Accept/Reject/Edit stay in jsdom, the
  extract never runs (no model in `e2e/`).

## Acceptance

- `/repos/:repoId/conventions` renders from the sidebar and from `g c`; the
  breadcrumb reads `Skills Lab › Conventions`.
- Fresh seed: three cards with rule, `file:line`, confidence %, and Accept /
  Reject / Edit each; header says ReScan because a scan row is seeded.
- Reject a card, reload: two cards, bar says `1 rejected · hidden`.
- Edit a rule inline, Save: the card shows the new text and an `edited` badge;
  the evidence line is unchanged.
- Accept two: bar says `2 of 2 accepted`, Create skill appears; the modal
  shows both rules under their category headings in an editable body with a
  token estimate; Create lands on the new skill's Preview tab and the skill is
  in the `/skills` grid.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green — `build` is
  the gate for a new route (client `INSIGHTS.md`, 2026-09-18).

## Open questions

- The mock's header shows *Detected from 84 sample files*; ours will say 12–20.
  Show the number honestly, or hide it below some threshold? **Lean: show
  it.** A small honest number is the argument for improvement 3 (stratified
  sampling) in the cross-package spec.
- `usePreviewConventionSkill` as a mutation vs a query keyed on the accepted
  id set. A query would refetch when the user accepts something while the
  modal is open — but the modal is modal, so that cannot happen. **Lean:
  mutation**, fired on open.
