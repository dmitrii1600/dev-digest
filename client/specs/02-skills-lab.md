# Skills Lab and the agent Skills tab (studio)

**Status:** Implemented. The cross-package spec is
[`../../specs/03-skills.md`](../../specs/03-skills.md); this one covers only
`@devdigest/web`.

## Problem

`messages/en/skills.json` is a finished ~90-key copy deck that no component
reads. `helpers.ts:33` routes `/skills` to the nav key `skills` and `shell.json`
has the label, but `NAV` has no such entry and no such page exists.
`AgentCard` takes a `skillCount` prop nothing passes. `AgentEditor.tsx:2` says in
a comment that later lessons add the Skills tab. The run-trace drawer already
renders a Skills prompt block that the server never sends.

Everything except the screens is here.

## Scope

In:

- `/skills` — a card grid, search, and one **Add Skill** modal with three
  tabs: Create (hand-typed), From file (`.md` / `.zip`), Import from URL.
  Clicking a card opens the editor. (Revised 2026-09-20 — the side-panel
  preview and the Create/Import dropdown are gone.)
- `/skills/[id]` — Config, Preview, Versions and Stats tabs.
- A Skills tab in the agent editor: attach, enable per binding, reorder.
- `SKILLS LAB` in the sidebar, with Agents moved into it.
- `client/src/lib/hooks/skills.ts`.

Out:

- **The Evals tab**, on a skill or an agent. L06.
- **The CI tab** on the agent editor. L06.
- **A Stats tab on the agent editor.** L08. The rail card's summary line is the
  one exception, and it is the last thing built.
- **The Community tab.** Its strings were deleted from `skills.json` on
  2026-09-20 along with the dropdown and side-panel copy; the catalog is a
  later lesson. (From-URL is now **in** — see below.)
- **Six of the mock's nine nav items.** They are future lessons; shipping them
  now means shipping links to 404s.
- **A drag-and-drop library.** See below.

## Contract

### Placement

| Component | Location | Interactive? |
|---|---|---|
| `SkillsListView` | `app/skills/_components/SkillsListView/` | yes — search, open editor, enable toggle, delete |
| `AddSkillModal` | `app/skills/_components/AddSkillModal/` | yes — `Tabs` shell; opened by the grid and the rail |
| `CreateTab` | `.../AddSkillModal/_components/CreateTab/` | yes — form, create |
| `FileTab` | `.../AddSkillModal/_components/FileTab/` | yes — file picker, preview, confirm |
| `UrlTab` | `.../AddSkillModal/_components/UrlTab/` | yes — URL, fetch, preview, import |
| `ImportPreviewFields` | `.../AddSkillModal/_components/ImportPreviewFields/` | yes — name/type + read-only body, shared by File and URL |
| `SecurityBanner` | `app/skills/_components/SecurityBanner/` | no — the injection-scan findings (File, URL, Config) |
| `DeleteSkillConfirm` | `app/skills/_components/DeleteSkillConfirm/` | yes — `ConfirmModal` + `useDeleteSkill`, shared by grid and rail |
| `SkillCard` | `app/skills/_components/SkillCard/` | yes — open editor, enable toggle, delete; grid **and** rail |
| `ConfirmModal` | `src/components/confirm-modal/` | yes — shared by skill and agent cards |
| `SkillsRail` | `app/skills/[id]/_components/SkillsRail/` | yes — the editor's left column: `SkillCard`s + Add Skill |
| `SkillEditor` | `app/skills/[id]/_components/SkillEditor/` | tab shell |
| `ConfigTab` | `.../SkillEditor/_components/ConfigTab/` | yes — form, save |
| `PreviewTab` | `.../SkillEditor/_components/PreviewTab/` | no — rendered markdown |
| `VersionsTab` | `.../SkillEditor/_components/VersionsTab/` | yes — diff, restore |
| `StatsTab` | `.../SkillEditor/_components/StatsTab/` | no — tiles and a donut |
| `SkillsTab` | `app/agents/[id]/_components/AgentEditor/_components/SkillsTab/` | yes — check, filter, reorder |

Both `page.tsx` files are thin route entries. Each folder carries its own
`constants.ts`, `helpers.ts`, `styles.ts`, `index.ts` and `*.test.tsx`.

### Idioms copied rather than reinvented

`/agents` is the model end to end: a card grid, then `/agents/[id]/page.tsx`'s
master-detail — a fixed rail beside a pane whose tab lives in the query
string and is set with `router.replace`. `/skills` once had a read-only preview
pane that duplicated the editor's Preview tab; spec 03 removed it, criterion 10
briefly brought it back as a side panel, and on 2026-09-20 the author asked for
the direct path: **a card click navigates to `?tab=config`**. The editor's rail
(`SkillsRail`, 320 px rather than the agents' 280 so a full tile fits) renders
the **same `SkillCard`** as the grid — same badges, toggle and delete — so the
two screens never disagree about a skill, and its **Add Skill** button opens the
same `AddSkillModal`. Otherwise the two Skills Lab lists are the same screen
with different cards.

**One modal, three sources.** `AddSkillModal` is a `Modal` with `Tabs`; each tab
owns its own state and action row, and switching tabs discards that state — the
tabs are three different sources, not steps of one form. File and URL share
`ImportPreviewFields` (editable name/type, read-only body) because the server
takes only those fields back on commit.

**Flagged skills.** The server scans every `imported_*` body on read and the
DTO carries `security: { status, findings }`. `SkillCard` shows a red *flagged*
badge instead of the source and its toggle is inert; `ConfigTab` shows
`SecurityBanner` (rule, line, excerpt) above the form, keeps Enabled inert, and
never sends `enabled: true` while flagged. Saving a clean body refetches the
skill and the flag clears — no client state to reset. `PreviewTab`'s
`UNTRUSTED_SOURCES` mirrors the server's `TRUSTED_SKILL_SOURCES`
(`manual` and `extracted` trusted) — it had drifted to list `extracted`.
`ConfigTab.tsx` is the form model: one `useState` per field, a `useEffect` keyed
on the entity id to reset on selection change, one `save()` calling the mutation.
No form library, no client-side zod — validation is the server's, and mutation
errors are already toasted by the `MutationCache` in `AppProviders`.

Primitives come from `@devdigest/ui` only. The Preview tab is `Markdown`; the
Config tab's body field is `Textarea mono`; the drawer is `Drawer`; the Stats tab
is `MetricCard` plus `Donut`.

### The agent Skills tab

One list of **every** workspace skill — drag handle, checkbox, name, type badge —
with unchecked rows dimmed. The header is `{linked} of {total} enabled` and a
filter input; the hint below it is `orderHint`, which already ends *"Drag to
reorder."*

**Why the checkbox is a checkbox and not a `Toggle`.** In the mock an unchecked
skill sits at position 2, between two checked ones. Position is independent of
enabled-ness, so the checkbox is a property of a row that exists either way — not
a switch that adds and removes the row. A binding is created lazily the first
time a skill is dragged or checked, `enabled: false` by default; until then
unlinked skills render after the linked ones in name order.

**Why native drag and not a library.** The hint text promises dragging, so
up/down buttons are not enough. A vertical single-column list is the one case
where the HTML5 drag API is genuinely sufficient, and the repo should not gain a
DnD dependency for one screen. Arrow-key reordering on the focused handle ships
alongside it — that is the accessibility path, and since jsdom cannot fire a real
drag it is also what the component test asserts. The drag itself is covered in
`e2e/`.

**One colour map.** `SKILL_TYPE_COLOR` lives once in
`client/src/lib/skill-tokens.ts` and is imported by both the Skills Lab and the
agent tab. `INSIGHTS.md` already records three copies of `SEV_COLOR`; this is not
the fourth. It does not go in `src/vendor/ui`, which is vendored.

### Navigation

`SKILLS LAB` holds **Skills** (new) and **Agents** (moved out of `WORKSPACE`),
which is what the `Skills Lab / Agents` breadcrumb hardcoded at
`agents/[id]/page.tsx:35` has always implied. The mock's other two groups wait
for their lessons.

**Why a vendored file is edited.** `NAV` lives in `src/vendor/ui/nav.ts`, and
`AGENTS.md` marks that tree do-not-touch. Unlike `src/vendor/shared`, `nav.ts`
has no canonical upstream to drift from — the rule exists to stop primitives
being hand-rolled and to keep contracts in step with the server. There is no
app-side override seam, and everything downstream already expects the entry:
`activeKeyFor` maps `/skills`, `shell.json` has `nav.skills`, and
`useShellCommands` derives the palette entry from `NAV` itself. The exception is
recorded in `AGENTS.md` rather than left for the next reader to rediscover.

### Data

`client/src/lib/hooks/skills.ts`, re-exported from `hooks/index.ts`, everything
through `lib/api.ts`: `useSkills`, `useSkill`, `useCreateSkill`, `useUpdateSkill`,
`useDeleteSkill`, `useSkillVersions`, `useRestoreSkillVersion`, `useSkillStats`,
`useSkillAgents`, `usePreviewSkillImport`, `useImportSkill`. A file is read with
`arrayBuffer()` and sent base64 — `api.ts` is JSON-only and stays that way.

### Copy

`skills.json` gains keys for the archive branch of the drawer (kept and discarded
entries, the nothing-was-executed notice, Cancel and Confirm), the Config tab
including the "what changed" note field, the Versions tab, and the Stats tab
including its attribution caveat. `agents.json` needs almost nothing: the tab
label, the count, the filter placeholder and the order hint are all written.

### Stats, stated honestly

A finding cannot be traced to a skill, only to the agent that ran carrying it. So
every tile counts the runs of the agents the skill is attached to, and the tab
says so in a line under the tiles rather than implying otherwise. The mock's
"pull frequency" is dropped: it would be 100 % by construction. The mock's donut
shows dollar amounts where it means counts.

## Acceptance

- `/skills` lists seeded skills with type, source, version and agent-count
  badges; an imported one shows "needs vetting"; clicking a card opens
  `/skills/:id?tab=config`. The editor rail shows identical tiles; deleting
  the open skill returns to `/skills`.
- **Add Skill** on the grid, its empty state and the rail opens the same modal
  with Create / From file / Import from URL. Importing from a URL previews the
  parsed body, then lands the skill `imported_url` and disabled.
- A preview or skill whose body trips the injection scan shows the banner with
  rule + line + excerpt; the card badge reads *flagged*; the toggle is inert;
  editing the line and saving clears all three.
- Every non-current version row expands a diff of itself against the **current**
  version (what restoring it would change); the current row has neither Diff
  nor Restore. Bodies come from `useSkillVersions`, which already carries every
  snapshot, so no extra request is made.
- Importing a `.md` and a `.zip` both reach the same preview, and the archive
  preview names every discarded member. Nothing is written until Confirm.
- Saving a changed body adds an entry to Versions with the note the author typed;
  renaming does not. Restore adds a new entry rather than removing later ones.
- The Stats tab renders `—` rather than `0 %` for an accept rate with no accepted
  or dismissed findings, and shows the attribution caveat.
- The agent Skills tab shows every workspace skill, counts `3 of 6 enabled`
  correctly, filters by name, and dims unchecked rows. Only enabled rows can be
  reordered: an unchecked row's handle is disabled and it ignores both drag and
  arrow keys.
- Checking a skill and then reordering the list leaves it checked after a reload.
- Reordering with the keyboard changes the order; the same operation by drag is
  asserted in `e2e/specs/09-skills.flow.json`, not in jsdom.
- The sidebar shows `SKILLS LAB` with Skills and Agents, `g`-then-`s` reaches
  `/skills`, and the command palette lists it without extra wiring.
- Component tests import the real `messages/en/skills.json`, mock the hooks module
  and never touch `fetch`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` stay green — `build`
  is the gate, not `test`, once files move.

## Open questions

- The mock's rail cards carry `142 runs · 70 % accept · $0.04 avg`. The data is in
  `agent_runs` and `findings` and it is the same aggregate as the skill Stats tab
  keyed on `agent_id`, but per-agent performance is L08. Ship the summary line
  now because it is nearly free, or leave the card as it is?

  **Resolved: leave it.** Only the `⚡ N skills` chip was wired (`AgentCard`
  now counts enabled `agent_skills` links for the card's agent). The
  runs/accept/cost line is real per-agent performance work — L08's job, not a
  by-product of this lesson.
