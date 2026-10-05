# Design 05 — Project Context authoring + picker polish (markdown mockup)

Source: the "DevDigest — App prototype" artifact
(https://claude.ai/artifact/KP2JTS2LE2eDQCTx6MU1hK/), screens N6 (Project Context
page), N2b (Agent Editor "Context" tab) and N2c (Skill Editor section). Extracted
from the prototype's source on 2026-10-01; this file records **behaviour and
layout only**. Mock data (file names, bodies, numbers) is illustrative.
Supersedes nothing: designs 01–04 still apply where this file is silent.

## N6 — Project Context page

Breadcrumb: `<owner/repo>` (mono) › `Project Context` › `<selected file>` (mono).

### Left pane (240 px, surface background)

- Header label `PROJECT CONTEXT`, under it the root path in mono: `.devdigest/specs/`.
- Toolbar of four icon buttons, in this order:
  1. **New file** (`Plus`) — creates `untitled.md` with the body
     `# Untitled spec\n\n## Goals\n- `, selects it and opens it in **Edit** mode.
  2. **New folder** (`Folder`) — creates `new-folder/spec.md` with
     `# New folder spec\n`, selects it, opens it in **Edit** mode.
  3. **Upload** (`Upload`) — adds a Markdown file from the user's machine, selects
     it, opens it in **Preview** mode.
  4. **Re-index** (`RefreshCw`) — refreshes the list; footer shows "last just now".
- Name collision on create: append `-2`, `-3`, … before `.md` until the name is free.
- File list: one row per file — `FileText` icon + mono name. Selected row has the
  hover background and an accent-coloured icon. Clicking a row selects it and
  switches to **Preview**.
- Footer: green dot + `Indexed: <N> files · <chunks> chunks`, second line
  `last <relative time>`. (Chunk count is out of scope — see spec Q-4.)

### Right pane

- Header row: selected file name (mono, 600) · segmented control **Preview | Edit** ·
  right-aligned `Cpu` icon + `Used by N agents` · coverage ring labelled `COVERAGE`
  (out of scope — spec Q-3).
- **Preview**: rendered Markdown, max width 680 px (h1, h2, bullet list, paragraphs,
  inline code).
- **Edit**: a monospace textarea, max width 680 px, min height ≈ 280 px, vertical
  resize, `spellCheck=false`, code background, strong border. Editing updates the
  document body in place (the prototype has no Save button — persistence, dirty
  state and conflicts are for the spec to decide).

### Empty state

No files yet → centred empty state: icon `Folder`, title "No spec files yet", body
"Drop your PRDs, tech specs, and acceptance criteria here. Every agent reads them as
grounding context.", CTA button "Add a spec file".

## Shared picker — Agent Editor "Context" tab (N2b) and Skill Editor (N2c)

Stores **paths, never bodies**.

### Row (`ContextDocRow`)

Drag handle (`Menu`, grab cursor) · checkbox (accent fill + check when attached) ·
file name (mono, 600) · folder (mono, muted) · spacer · source badge (`specs` accent,
`docs` green `#10b981`, `insights` amber `#f59e0b`, tinted background) · **Preview**
button (`Eye` + "Preview"; icon only in compact mode). Unattached rows at 0.78
opacity; attached rows on the hover background.

### Preview drawer (`DocPreviewDrawer`) — replaces a modal

Right-side drawer, 560 px wide.
- Title: `FileText` icon in the source colour + full path (mono).
- Subtitle: source badge · `Cpu` + "Used by N agent(s)" · `<tokens> tokens` (mono,
  formatted `1.2K`).
- Primary/secondary button **Attach** (`Plus`) / **Attached** (`Check`) toggles the
  attachment from inside the drawer.
- Body: the rendered Markdown in a bordered surface card. Read-only.

### Agent tab list (`ProjectContextList`, max width 720 px)

- Header: h2 "Project context" · badge `<attached> of <total> attached` · filter
  input "Filter documents…" (search icon, 200 px) on the right.
- Hint: "Order matters — earlier docs appear earlier in the assembled
  `## Project context` block. Toggle to attach."
- Order: attached docs first (in attach order), then the rest; filter applies to both.
- No documents → empty state icon `Folder`, "No documents found", body "Add markdown
  to specs/ · docs/ · insights/ in the repo, then Re-index.", CTA "Re-index".
- Footer (top border): `≈ <tokens> tokens` (mono); when over the **soft cap of 4,000
  tokens** the figure turns critical red and a badge `over 4K soft cap`
  (`AlertTriangle`) appears; right side "Injected as an untrusted block
  (`## Project context`) into every run."

### Skill section (`SkillContextSection`)

- Collapsible (chevron) when embedded, always open as a tab. Header "Project context
  to use" + badge `<n> attached` + filter (180 px).
- Hint "Any agent using this skill inherits these documents."
- Compact rows.
- Nothing attached → dashed box "No project context attached to this skill." +
  link button "+ Attach documents".
- **SERIALIZES AS** box, grouped by source, only non-empty groups:
  ```
  ## Project specifications
  - specs/public-api.md
  ## Project docs
  - docs/webhooks.md
  ## Project insights
  - INSIGHTS.md
  ```
  (The engine injects a single `## Project context` heading — spec Q-6 / DR-17.)
