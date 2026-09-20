# Skills Lab — closing the lab criteria that the extractor does not cover

**Status:** Implemented (2026-09-20) except criterion 21, which is left for the author (see below). Criteria 10 and 11+12 were **revised the same day** after the author reviewed the result — see the notes inside each. Companion to
[`04-conventions-extractor.md`](./04-conventions-extractor.md). The lab is
graded on 53 criteria; this file lists the ones the current tree does **not**
meet and the smallest change that meets each. Everything not listed here was
verified against the tree on 2026-09-20 and already holds (AGENTS.md stubs in
root + four packages, the three authoring skills, SKILLS LAB nav, skills CRUD,
import, versions, the agent editor, the trace's Skills block and token count,
Settings → Feature Models with a Conventions row).

## Problem

Spec 03 built the Skills Lab against the course mock; the grading sheet was
written against a slightly different reading of the same mock. Five of the
differences are one-component changes, one is seed content, one is a policy
question. None of them touches the extractor, so they ship as their own PR (or
two) and do not block it.

## Scope

In: criteria 10, 11, 22, 23, 24, 28, 31, 34, 43. Discussed but unresolved: 21.
Out: anything the extractor spec owns (38–53 minus 43), and the two control
experiments (17, 18) — `docs/skills-control-experiment.md` already is the
runbook; it gains one fixture for `repo-conventions` when that skill exists.

## Contract

### 10 — card click opens the **editor** on `/skills` (revised 2026-09-20)

Spec 03 removed the preview pane on purpose ("edit mode a second click away").
The first reading of this criterion reinstated a side-panel preview with an
**Open editor** button; the author reviewed it and asked for the shorter path
back: **a card click opens the editor directly** at `/skills/:id?tab=config`.
The side panel (`SkillPreviewDrawer`) is deleted; the editor's own Preview tab
is the one preview.

- `SkillsListView` has no `selectedId`; the card's `onClick` is `router.push`.
- The card's enable `Toggle` and Delete keep working without navigating
  (`stopPropagation`).
- The editor's rail renders the **same `SkillCard` tiles** as the grid
  (description, type, source or *needs vetting* or *flagged*, `vN`, `M agents`,
  toggle, delete) — `SkillListItem` is deleted; the rail is 320 px so a tile
  fits. Deleting the open skill returns to `/skills`.
- `09-skills.flow.json` clicks the card and waits for `tab=config` directly.

### 11 + 12 — **Add Skill** is one modal with three tabs (revised 2026-09-20)

The first cut was a `Dropdown` (Create → modal, Import → drawer) on the grid
only, while the editor rail's button still opened the file drawer alone. The
author asked for one behaviour everywhere:

- **Add Skill** (grid header, grid empty state, editor rail) opens
  `AddSkillModal` — a `Modal` with `Tabs` **Create** / **From file** /
  **Import from URL**. Placement: `app/skills/_components/AddSkillModal/`
  (two consumers → promoted out of `SkillsListView`).
- **Create** is the hand-typed form (Name, Description, Type, Body → `useCreateSkill`).
- **From file** is the former `AddSkillDrawer` body: `.md`/`.zip` picker →
  preview → confirm, same base64 transport.
- **Import from URL** is new end to end: `POST /skills/import/url/preview` and
  `POST /skills/import/url` on the server (fetch through a guarded `UrlFetcher`
  port — public hosts only, size-capped, redirects re-checked), lands
  `imported_url` + disabled.
- Every imported preview and every `imported_*` skill carries the server's
  heuristic **injection scan** (`security` on the DTO); a flagged body shows a
  red banner naming rule + line + excerpt, the card shows *flagged* instead
  of its source, and enabling is refused (client toggle inert, server 422)
  until the body is edited clean. Details in `specs/03-skills.md`.
- `CreateSkillModal/` and `AddSkillDrawer/` are deleted.

### 22 — card shows **version and agent count**

- `Skill` gains `agent_count: z.number().int()` in both shared copies. It is
  built per request (`SkillsRepository.list` / `getById` LEFT JOIN + COUNT on
  `agent_skills`), never persisted, so no `.nullish()` is needed — the
  `RunStats` history lesson does not apply.
- `SkillCard` renders `v{version} · {agent_count} agents` (ICU plural key
  `card.agents` in `skills.json`). The version badge already exists.

### 23 + 24 — **Delete** on the skill card, confirmed in a modal

- A `Trash` `IconBtn` on `SkillCard` (`onDelete` prop, `stopPropagation` so
  it does not open the preview).
- One shared `ConfirmModal` in `src/components/confirm-modal/` built on
  `Modal`: title, body, **Confirm** (danger), **Cancel**, and the `X` in the
  header — three ways out, as the criterion enumerates. Props: `title`,
  `body`, `confirmLabel`, `onConfirm`, `onCancel`, `busy`.
- `SkillsListView` owns `deletingId` state and calls `useDeleteSkill` on
  confirm; the toast comes from the mutation cache.

### 34 — agent delete confirmed in the **same modal**

`AgentCard` currently uses `window.confirm` (and a hardcoded English string —
an `AGENTS.md` violation on its own). Replace with `ConfirmModal` and
`agents.json` keys `card.deleteTitle` / `card.deleteBody`. Criterion 33 (the
button) already holds.

### 28 — **Diff against the current version**

`VersionsTab` diffs a version against its predecessor. The criterion wants each
*previous* version's **Diff** to show the difference to the **current** one.
`helpers.ts`: replace `previousVersion(v, versions)` with `currentVersion(versions)`
at the call site; label key `versions.diffVsCurrent` (*Diff vs current*); the
current row shows no Diff button (it would be empty). The oldest-version case
that spec 03 called out ("reads as an all-new body") goes away — every diff
now has two real sides. Update `client/specs/02-skills-lab.md` Acceptance.

### 31 — **drag only for enabled** rows on the agent Skills tab

`SkillsTab` sets `draggable` on every row. Gate it: `draggable={row.enabled}`,
hide the drag handle (or render it disabled with `aria-disabled`) on unchecked
rows, and make the keyboard reorder handler a no-op unless `row.enabled`.
`SkillsTab.test.tsx` gains: an unchecked row has no handle and ArrowDown on it
does not reorder. The order semantics do not change — an unchecked row keeps
its position; it just cannot be moved until it is checked. Update the
tab's `orderHint` copy to say so.

### 43 — four API Contract skills

Seed four `manual`, `convention`-typed skills bound to **API Contract
Reviewer**, each with a directive description and a *Good / Bad* pair in the
body, and move their bodies out of `seed.ts` into `seed-skills.ts` next to
`seed-prompts.ts`:

| name | description (directive) |
|---|---|
| `breaking-change` | Flag any change that makes an existing caller fail: removed/renamed field or route, narrowed type, new required input, changed status code. |
| `response-schema` | Every response shape is a shared Zod contract; flag a route that returns fields the contract does not declare, or a contract change not mirrored in the client copy. |
| `semver-discipline` | A breaking change needs a major bump or a versioned route; additive needs minor; flag a breaking change shipped as a patch. |
| `deprecation-policy` | Nothing is removed without a deprecation window: flag removal without a prior `@deprecated` marker, a sunset date, and a replacement named in the description. |

`api-contract-gate` overlaps `breaking-change` + `semver-discipline`. It is
**not** deleted from existing databases (the seed is idempotent by name and
never deletes), but it is dropped from `seedSkills` and its binding row from
`seedSkillLinks`, so a fresh seed shows exactly the four plus
`pr-quality-rubric`. `docs/skills-control-experiment.md`'s Fixture 2 names the
new skills. `09-skills.flow.json` does not reference `api-contract-gate`, so it
is unaffected.

Bodies obey `docs/agent-prompts/README.md` — no JSON shape, no second severity
scale — because a skill body is prompt text (spec 03).

### 21 — manual `pr-self-review` on a mixed diff, auto-invoke off — **unresolved**

The criterion reads: the `git push` auto-invocation is disabled; the skill,
run by hand on a diff touching `client/` and `server/`, loads both skill
sets. The second half already holds (`routing.md` fans out per touched
package). The first half contradicts `AGENTS.md`, which enables both the
Claude Code `PreToolUse` gate and `.githooks/pre-push`. Options:

1. Keep the `PreToolUse` gate, make `.githooks/pre-push` opt-in (remove the
   `git config core.hooksPath` line from `scripts/dev.sh`, document the manual
   enable). The gate still blocks `git push` **from a Claude Code session**,
   which is where the skill is invoked, and a plain terminal push is no longer
   intercepted — matching the criterion's wording.
2. Leave everything as is and argue the criterion is about the *skill* not
   auto-running the review (it does not — the gate only checks for a fresh
   report; the review is always a manual `/pr-self-review`).

**Author's call.** Option 2 changes nothing and may be the correct reading;
option 1 is a two-line change plus an `AGENTS.md` edit. Not decided here.

## Acceptance

- `/skills`: card click opens `/skills/:id?tab=config`; the editor rail shows
  the same tiles as the grid, and deleting the open skill returns to the grid. [10]
- `/skills` and the editor rail: **Add Skill** opens the same modal with
  Create / From file / Import from URL; Create has Name, Description, Type,
  Body; a created skill appears in the grid. A URL import with an injection
  pattern in its body lands flagged and cannot be enabled until edited. [11, 12]
- Every card shows `vN · M agents` with M equal to the `agent_skills` rows for
  that skill. [22]
- Every card has Delete; clicking it opens a modal with Confirm, Cancel and X;
  Confirm removes the skill from the grid and the DB. [23, 24]
- Agent tile Delete opens the same modal; no `window.confirm` remains in
  `src/app`. [34]
- Versioning: each non-current row's Diff shows its difference to the current
  version; the current row has Restore hidden and no Diff. [28, 29]
- Agent Skills tab: unchecked rows have no drag handle and ignore keyboard
  reorder; checked rows drag as before. [31]
- Fresh seed: API Contract Reviewer carries `pr-quality-rubric` plus the four
  named skills, each body containing a *Good* and a *Bad* example. [43]
- All client and server checks green; `09-skills.flow.json` updated and
  passing.

## Open questions

- Criterion 21 — see above.
- `ConfirmModal` lives in `src/components/` (shared, imported by two feature
  folders under `src/app`). `frontend-ui-architecture` says promote on the
  second consumer; this is the second consumer, so promotion is correct at
  birth. Confirm nobody prefers it inside `@devdigest/ui` — that tree is
  vendored and do-not-touch, so **no**.
