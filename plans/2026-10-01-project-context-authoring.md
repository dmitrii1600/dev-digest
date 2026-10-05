# Implementation Plan: Project Context authoring and picker polish

**Plan ID:** 2026-10-01-project-context-authoring  ·  **Spec:** [specs/2026-10-01-project-context-authoring.md](../specs/2026-10-01-project-context-authoring.md) (partially supersedes [specs/2026-09-29-project-context.md](../specs/2026-09-29-project-context.md), whose non-overridden criteria still hold)  ·
**Execution mode:** multi-agent (step 0 → tracks A ∥ B ∥ C → Integration)  ·  **Packages:** server, client  ·
**Assumptions:** the author's answers of 2026-10-01: Q1 = A, Q2 = A, Q3 = A, Q4 = B, Q5 = A; the EC-5 byte cap is measured on the bytes written (after CRLF→LF); Recommendations 1–7 are adopted. The copy drafted in step 0 is approved together with this plan.

## Summary
The Project Context page gains authoring under `<clone>/.devdigest/specs/`: New file, New folder, Upload, Preview | Edit, an explicit Save and a Delete. Optimistic concurrency uses a SHA-256 version token, and a stale write gets a 409 that the page resolves with Reload or Overwrite. An unsaved-changes guard covers in-page selection, links, the shell's six `router.push` sites, reload and tab close. The shared picker gets:
- a 560 px preview drawer that can attach;
- per-row token counts, with "—" when unknown;
- a 4K soft-cap badge;
- a "No documents found" empty state with a Refresh action.

The skill's SERIALIZES AS box shows the injected heading and the attached, present paths in order, each with its kind. The server owns all safety rules: path and name rules, the symlink and junction refusal, the tracked check (fail closed), the size and encoding rules, atomic writes and a per-repo lock. `reviewer-core` and the injected prompt are untouched.

## Requirements review
Execution mode: **stated by caller** (multi-agent, 3 tracks). Answers from the re-invocation are folded into the ledger.

| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "breadcrumb `<owner/repo>` › Project Context › `<selected path>` … root path `.devdigest/specs/` … New file, New folder, Upload and Refresh, in that order … a note that files there exist only in the local clone" | §AC-1 | clear |
| R2 | "pre-filled with `untitled.md` or `new-folder` … body `# Untitled spec\n\n## Goals\n- ` … `<name>/spec.md` with the body `# New folder spec\n`" | §AC-2 | clear |
| R3 | "uploads a `.md` file … write its bytes unchanged … in the root and never in a subfolder" | §AC-3 | clear (base64 transport, Rec 3) |
| R4 | "select the new file, in Edit mode after a create and in Preview mode after an upload" | §AC-4 | clear |
| R5 | "Preview \| Edit control and a Delete action … monospace text area … Preview shall render the current text, including unsaved edits" | §AC-5 | clear |
| R6 | "Preview only … 'read-only' label that states the reason: outside `.devdigest/specs/`, tracked …, or over 64 KB" | §AC-6 | clear; precedence is outside_root > tracked > too_large (Q5) |
| R7 | "'Unsaved changes' text indicator and enable Save" | §AC-7 | clear |
| R8 | "Save … LF line endings, but only if the file is byte-identical … listing shall show the new size and token count" | §AC-8 | clear (SHA-256 version, Rec 2) |
| R9 | "selects another file, deletes the open file, or leaves the page (in-app navigation, reload or closing the tab) … ask for confirmation" | §AC-9 | clear. Q1 = A: links + six shell `router.push` sites + reload/close; Back/Forward is a documented limitation |
| R10 | "Delete … only if byte-identical … remove every folder … left empty (never the root itself) … clear the selection" | §AC-10 | clear |
| R11 | "560 px right-side drawer … full path, kind badge, 'Used by N agent(s)', token count, rendered document, read-only" | §AC-11 | clear |
| R12 | "Attach or Attached in the drawer … exactly as the row checkbox does" | §AC-12 | clear |
| R13 | "each readable row's token count, written as `1.2K` from 1,000 upward" | §AC-13 | clear (`formatTokenCount`, `client/src/components/run-cost-badge/RunCostBadge.tsx:31-35`) |
| R14 | "exceed 4,000 … critical colour beside a text badge 'over 4K soft cap'" | §AC-14 | clear |
| R15 | "'No spec files yet' with an 'Add a spec file' action … 'No documents found' with a Refresh action … only `.md` files are listed" | §AC-15 | clear |
| R16 | "SERIALIZES AS … `## Project context` … attach order … `- [specs] .devdigest/specs/x.md` … no other `##` line" | §AC-16 | clear. Q4 = B: paths missing from the listing are omitted from the box (still shown as rows) |
| R17 | "no clone … disable New file, New folder and Upload … reject any write or delete with 409" | §EC-1 | clear |
| R18 | "taken in its folder (compared case-insensitively) … append `-2`, `-3` … never overwrite" | §EC-2 | clear |
| R19 | "absolute, `..`, empty segment, outside `.devdigest/specs/`, not `.md` … CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9 … `< > : \" / \\ \| ? *` or U+0000–U+001F; trailing dot or space; more than 255 bytes → 422 naming the field" | §EC-3 | clear |
| R20 | "symlink, a junction or not a directory → 422 … clone root reached through a junction shall stay writable" | §EC-4 | clear |
| R21 | "exceeds 65,536 bytes as UTF-8, is not valid UTF-8, or contains a NUL byte → 422 naming the rule" | §EC-5 | clear; measured after CRLF→LF for Save |
| R22 | "changed or was deleted on disk after the page loaded it → 409" | §EC-6 | clear |
| R23 | "keep the user's text … Reload … and, after a rejected save, Overwrite" | §EC-7 | clear. Q2 = A: 409 `details` `{ reason, current_version }`; `version: null` = expect absent; Overwrite after a delete recreates |
| R24 | "in flight … disable Save and Delete and show progress … one request" | §EC-8 | clear |
| R25 | "fails for any reason other than a conflict … keep … the 'Unsaved changes' indicator, and show an error with a retry action" | §EC-9 | clear |
| R26 | "tracked in the clone's current commit, or larger than 64 KB → 422 … read-only" | §EC-10 | clear; Q5 = A, fail closed |
| R27 | "preview, save, delete and attach of a path under `.devdigest/specs/` shall be accepted … whether or not it is among the 500 … pinned row 'not in the first 500'" | §EC-11 | contradicts tree — [client/src/components/context-docs-picker/helpers.ts:221-224](../client/src/components/context-docs-picker/helpers.ts) labels an attached path absent from the capped listing `missing`. Rec 6 adopted: no picker change; recorded in Risks |
| R28 | "the next run shall inject the saved text … or skip the deleted document … a run already in progress shall keep what it read at its start" | §EC-12 | clear (already true, `server/src/modules/project-context/service.ts:109-132`; test only) |
| R29 | "'—' with the accessible name 'token count unavailable' and leave the row out of the total" | §EC-13 | clear |
| R30 | "at most 65,536 bytes … under the API's 1 MiB body limit" | §NFR-1 | clear (base64 ≤ 87,384 chars; `server/src/app.ts:49`) |
| R31 | "only in the clone working tree … never stores their text in Postgres, never commits and never pushes" | §NFR-2 | clear |
| R32 | "never appear in a PR diff or in the repo-intel index, and are never read by Onboarding or Conventions" | §NFR-3 | clear |
| R33 | "two simultaneous creates produce two distinct files … old or the new content, never a mix" | §NFR-4 | clear |
| R34 | "`reviewer-core` and `INJECTION_GUARD` are unchanged … additive and mirrored" | §NFR-5 | clear |
| R35 | "accessible names … Preview \| Edit keyboard-operable and exposes its selected state … drawer closes on Escape and returns focus" | §NFR-6 | clear (kit `Drawer` lacks both — `client/src/vendor/ui/kit/Drawer.tsx:4-66`; the wrapper adds them) |
| R36 | "every new string comes from `client/messages/en/context.json`" | §NFR-7 | clear (copy drafted in step 0, Q3 = A) |
| R37 | "no LLM call … the drawer takes tokens and 'Used by' from the listing" | §NFR-8 | clear |
| R38 | "every write and delete logs one line with repo id, path, byte count and outcome … never the content" | §NFR-9 | clear |
| R39 | "exceeding 4,000 tokens never disables attaching and never changes what a run injects" | §NFR-10 | clear |
| R40 | Untrusted: entered/upload name "1–255 bytes, the EC-3 name rules; a file name ends in `.md`" | §Untrusted inputs | clear |
| R41 | Untrusted: upload content "at most 65,536 bytes; valid UTF-8; no NUL byte" | §Untrusted inputs | clear |
| R42 | Untrusted: save body "strict object … version a bounded string … stale version → 409" | §Untrusted inputs | clear (`version` nullable per Q2) |
| R43 | Untrusted: delete request "(path, version) … target untracked and within 64 KB" | §Untrusted inputs | clear (query string, Rec 4) |
| R44 | Untrusted: create body "strict object, kind is `file` or `folder`" | §Untrusted inputs | clear |
| R45 | Untrusted: repo `:id` "404, indistinguishable" | §Untrusted inputs | clear |
| R46 | Untrusted: clone layout "real path … under the real clone root; no link on the target path" | §Untrusted inputs | clear |
| R47 | Untrusted: text in Edit/Preview "existing Markdown renderer only; the editor is plain text" | §Untrusted inputs | clear |
| R48 | Untrusted: authored text reaching a prompt "wrapped as untrusted exactly as today" | §Untrusted inputs | clear |
| P1 | "list every `.md` file … sorted by path" (page lists all clone docs; only root ones are editable) | 2026-09-29 §AC-1 | clear |
| P2 | "content rendered as Markdown, with its path as the heading" | 2026-09-29 §AC-3 | clear |
| P3 | "checkbox, the path, a kind badge and a Preview action … 'N of M attached'" | 2026-09-29 §AC-6 | clear |
| P4 | "'≈ N tokens' … without a network round trip" | 2026-09-29 §AC-9 | clear |
| P5 | "not cloned … empty state saying the repo is not cloned" | 2026-09-29 §EC-1 | clear |
| P6 | "more than 500 … 'showing 500 of N'" | 2026-09-29 §EC-3 | clear |
| P7 | "attached path no longer in the clone listing … 'missing' row" | 2026-09-29 §EC-7 | clear |
| P8 | "attach request names a path not in the current listing → 422" (still holds outside `.devdigest/specs/`) | 2026-09-29 §EC-8 | clear |

**Recommendations**
1. `GitClient.listTracked(clonePath, underDir)` keyed by the DB clone path — **adopted** (step 0, used in steps 3–4).
2. Version = SHA-256 hex of the on-disk bytes — **adopted** (step 0 contract, step 2).
3. Upload as `content_base64` in JSON — **adopted** (step 0, step 3).
4. DELETE takes `path` and `version` in the query string — **adopted** (step 0, step 4, step 7).
5. Writer in a ring-3 `repository-writes.ts`; pure rules in `helpers.ts` — **adopted** (steps 1–2).
6. No picker change for an attached file past the cap; documented — **adopted** (Risks).
7. Keep the page heading text "Project Context" for `e2e/specs/14-project-context.flow.json` — **adopted** (step 8).

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](../AGENTS.md) | Naming rules, do-not-touch, `verify.mjs` flags, pnpm for server/client |
| [server/AGENTS.md](../server/AGENTS.md) | Onion enforcement, declarative validation, `.js` imports, `*.it.test.ts` |
| [client/AGENTS.md](../client/AGENTS.md) | `vendor/ui` is do-not-touch; no `fetch` in components; messages per namespace |
| [server/src/modules/project-context/README.md](../server/src/modules/project-context/README.md) | Six existing routes, reader guards, token rule (wrapped block) |
| [server/src/modules/project-context/service.ts:20-57](../server/src/modules/project-context/service.ts) | `list` tokenises each file; `file` requires the capped listing (EC-11 gap) |
| [server/src/modules/project-context/repository-files.ts:51-103](../server/src/modules/project-context/repository-files.ts) | Walk skips symlinks; `readDoc` guards (absolute, `..`, realpath containment, NUL, 64 KB) |
| [server/src/modules/project-context/types.ts:61-70](../server/src/modules/project-context/types.ts) | `ProjectContextDeps` shape the container wires |
| [server/src/platform/container.ts:112-115, 171-179](../server/src/platform/container.ts) | `git` getter; `projectContext` wiring |
| [server/src/vendor/shared/adapters.ts:98-101, 220-243](../server/src/vendor/shared/adapters.ts) | `RepoRef`, `GitClient` port (identical in the client mirror) |
| [server/src/vendor/shared/contracts/platform.ts:254-304](../server/src/vendor/shared/contracts/platform.ts) | `SpecFile`, `ContextFileList`, `ContextPath`, queries (identical in the client mirror) |
| [server/src/adapters/git/simple-git.ts:37-43, 77-87](../server/src/adapters/git/simple-git.ts) | `clonePathFor` vs DB clone path; resync is `reset --hard` |
| [server/src/adapters/mocks.ts:269-300](../server/src/adapters/mocks.ts) | `MockGitOptions`, `MockGitClient` |
| [server/src/platform/errors.ts:7-29](../server/src/platform/errors.ts) | `AppError(code, msg, status, details)`; 409 precedent `server/src/modules/conventions/service.ts:76` |
| [server/src/modules/skills/routes.ts:57-66](../server/src/modules/skills/routes.ts) | base64-in-JSON upload precedent |
| [server/test/project-context.it.test.ts](../server/test/project-context.it.test.ts) | `startPg`, `makeApp(overrides)`, `newRepo(clonePath)` fixture shape |
| [client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx](../client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx) | Current read-only page; crumb at :22, empty state at :43-44 |
| [client/src/components/context-docs-picker/](../client/src/components/context-docs-picker/) | Picker, modal (to replace), `mergeDocRows` coerces `null` tokens to 0 (`helpers.ts:223,233`) |
| [client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx:37-43](../client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx) | SERIALIZES AS is `paths.join("\n")` |
| [client/src/lib/hooks/project-context.ts](../client/src/lib/hooks/project-context.ts) · [client/src/lib/api.ts:66-72](../client/src/lib/api.ts) | Query keys; `api.del` takes no body |
| [client/src/providers/AppProviders.tsx:41-43](../client/src/providers/AppProviders.tsx) | Global `MutationCache.onError` toasts every mutation error |
| [client/src/components/app-shell/hooks/](../client/src/components/app-shell/hooks/) | The six `router.push` sites: `useGlobalShortcuts.ts:46,47`, `useShellCommands.ts:27,35`, `useShellContext.ts:34,39` |
| [client/src/vendor/ui/kit/Drawer.tsx](../client/src/vendor/ui/kit/Drawer.tsx) · [Textarea.tsx](../client/src/vendor/ui/kit/Textarea.tsx) | No Escape/focus handling; Textarea has no `aria-label`/`spellCheck` pass-through |
| [.claude/skills/pr-self-review/routing.md](../.claude/skills/pr-self-review/routing.md) | Write-time skill set |
| [INSIGHTS.md:273](../INSIGHTS.md) · [server/INSIGHTS.md:106,126,194,216,316](../server/INSIGHTS.md) · [client/INSIGHTS.md:99,175,235,282](../client/INSIGHTS.md) | See *Insights that bind this work* |

## Insights that bind this work
1. **`@devdigest/shared` is two physical copies** — [INSIGHTS.md:273](../INSIGHTS.md). Step 0 edits `contracts/platform.ts` and `adapters.ts` in **both** `server/src/vendor/shared` and `client/src/vendor/shared` in the same step, and verifies both packages.
2. **A clone dir reached through a junction: realpath both sides** — [server/INSIGHTS.md:106](../server/INSIGHTS.md). The writer (step 2) resolves `realpath(clonePath)` once and checks every segment below it with `lstat`. A junction *at* the clone root is therefore fine, and one *below* it is refused. The writes test (step 2) pins both cases.
3. **A port goes in `vendor/shared/adapters.ts`; a service may not import `adapters/**`; a module's filesystem reader is a ring-3 `repository-<what>.ts`** — [server/INSIGHTS.md:216](../server/INSIGHTS.md), [:194](../server/INSIGHTS.md). Placement follows from this:
   - `listTracked` is a `GitClient` port method (step 0), and the container (step 4) wires it into `ProjectContextDeps`.
   - The writer lives in `modules/project-context/repository-writes.ts` (ring 3).
   - Name, path and content rules live in `helpers.ts` (ring 2, pure).

**What Doesn't Work, checked:**
- **The leading-slash directory pattern matched with `includes`** ([server/INSIGHTS.md:126](../server/INSIGHTS.md)). The `.devdigest/specs/` predicate must be **anchored at the start** of the repo-relative path. Step 1 pins the near-misses `docs/.devdigest/specs/a.md`, `.devdigest/specs-old/a.md` and `.devdigest/SPECS/a.md`.
- **`pnpm exec` in a worktree** ([INSIGHTS.md:205](../INSIGHTS.md)). Not relevant: every command here goes through `scripts/verify.mjs` in the main checkout.
- **`pnpm build` while `next dev` runs** ([client/INSIGHTS.md:34](../client/INSIGHTS.md)). No step builds.
- **Other insights that apply:**
  - `formatTokenCount`, not `formatTokens` ([client/INSIGHTS.md:99](../client/INSIGHTS.md)).
  - `Modal`/`Drawer` render in place, so the drawer is mounted at picker level and never inside a row ([client/INSIGHTS.md:175](../client/INSIGHTS.md)).
  - Tests use `fireEvent`, because user-event is not installed ([client/INSIGHTS.md:235](../client/INSIGHTS.md)).
  - "Unknown renders —, never 0" ([INSIGHTS.md:266](../INSIGHTS.md)), which EC-13 restates.

## Constraints
- **Onion rings (server).**
  - `helpers.ts` and `constants.ts` are ring 2: pure, no `node:fs`, no runtime `zod`.
  - `service.ts` is ring 2: no `adapters/**` import, not even `import type`.
  - `repository-writes.ts` and `repository-files.ts` are ring 3, which allows `node:fs` and `node:crypto`.
  - `routes.ts` is ring 4 and `platform/container.ts` is the composition root.
  - `pnpm lint` and `pnpm arch` must stay green.
- **Contract once + mirror.** Every contract and port change goes into `server/src/vendor/shared/**` (canonical) and is mirrored byte-for-byte into `client/src/vendor/shared/**` in step 0. The changes are additive only (NFR-5): new optional or `nullish` fields and new schemas.
- **Declarative validation.** New routes declare zod `params`, `body` or `querystring`, and `response`; no `.parse()` runs inside a handler. Body-size rules live in the contract, and post-normalisation rules live in the service.
- **`.js` on relative imports** in every new or edited server file.
- **`*.it.test.ts` for anything that touches Postgres.** New filesystem-only server tests use tmpdirs and are plain `*.test.ts`, following the precedent `server/test/project-context-files.test.ts`.
- **Client placement.**
  - Feature code lives in `_components/<Name>/<Name>.tsx`, with `<Name>.test.tsx` beside it.
  - No `fetch` in a component; mutations are hooks in `client/src/lib/hooks/project-context.ts` over `api`.
  - Every user-facing string comes from `client/messages/en/context.json`.
  - `src/components` and `src/lib` never import `src/app`.
- **Do not touch:**
  - `client/src/vendor/ui/**`: Drawer, Textarea and Modal are wrapped, never edited.
  - `reviewer-core/**`, including `INJECTION_GUARD` and `grounding.ts`.
  - `server/src/db/migrations/**`: no schema change, no migration.
  - every lock-file.
  - `clones/` and `server/clones/`: tests use tmpdirs, never a real clone.
- **No new dependency** in either package.
- **No `git` mutation of a clone.** `listTracked` only reads (`ls-tree`). Nothing runs `git add` or `commit` in a clone (NFR-2).

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/**`, `client/src/vendor/shared/contracts/**` (step 0) | `zod`, `onion-architecture` | wire contracts, ring 1 (`typescript-expert` is review-time) |
| `server/src/vendor/shared/adapters.ts`, `server/src/adapters/**` (step 0) | `onion-architecture` | port in ring 1, adapter in ring 3 |
| `server/src/modules/project-context/{helpers,constants,service,types}.ts` (track A) | `onion-architecture` | ring 2 purity, DI through deps |
| `server/src/modules/project-context/repository-*.ts` (track A) | `onion-architecture` | ring-3 filesystem reader/writer |
| `server/src/modules/project-context/routes.ts`, `server/src/platform/container.ts` (track A) | `onion-architecture`, `fastify-best-practices` | HTTP surface, hooks, composition root (`security` is the gate's, review-time) |
| `client/src/app/repos/[repoId]/context/**`, `client/src/providers/navigation-guard.tsx`, `client/src/components/app-shell/hooks/*` (track B) | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | placement, hook/state rules, `'use client'` files and `next/navigation` |
| `client/src/components/context-docs-picker/**`, both `ContextTab` folders (track C) | `frontend-ui-architecture`, `react-best-practices` | shared component + feature folders |
| `client/**/*.test.tsx` (tracks B, C) | `react-testing-library` | component tests |

Each implementer loads its skills **once**, at the first step that needs them.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`, `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts`, `server/test/git-list-tracked.test.ts`, `client/messages/en/context.json` | 0 | `node scripts/verify.mjs server --file server/test/git-list-tracked.test.ts` · `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs client --checks` | — |
| A — server | `server/src/modules/project-context/**` except `README.md`, `server/src/platform/container.ts`, `server/test/project-context-*.test.ts`, `server/test/project-context.it.test.ts` | 1–5 | `node scripts/verify.mjs server --file <test>` per step · `node scripts/verify.mjs server --checks` at step 5 | step 0 |
| B — client page | `client/src/app/repos/[repoId]/context/**`, `client/src/lib/hooks/project-context.ts`, `client/src/providers/navigation-guard.tsx`, `client/src/providers/navigation-guard.test.tsx`, `client/src/providers/AppProviders.tsx`, `client/src/components/app-shell/hooks/*` | 6–9 | `node scripts/verify.mjs client --file <test>` per step | step 0 |
| C — client picker | `client/src/components/context-docs-picker/**`, `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/**`, `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/**` | 10–12 | `node scripts/verify.mjs client --file <test>` per step | step 0 |
| shared — integration | `client/messages/en/context.json` (dead-key cleanup only), `server/src/modules/project-context/README.md`, `server/README.md`, `client/README.md` | 13 | `node scripts/verify.mjs server --it` · `node scripts/verify.mjs client` (the full runs) | A, B, C |

No path appears in two track rows. The two shared rows are one track that runs at the start and at the end. Each of A, B and C is one `implementer` invocation.

## Steps

### 0. Contracts, git port, adapters and copy (contract first)
- **Track:** shared
- **Files:**
  - [`server/src/vendor/shared/contracts/platform.ts`](../server/src/vendor/shared/contracts/platform.ts) (edit) and [`client/src/vendor/shared/contracts/platform.ts`](../client/src/vendor/shared/contracts/platform.ts) (edit, byte-identical mirror)
  - [`server/src/vendor/shared/adapters.ts`](../server/src/vendor/shared/adapters.ts) (edit) and [`client/src/vendor/shared/adapters.ts`](../client/src/vendor/shared/adapters.ts) (edit, mirror)
  - [`server/src/adapters/git/simple-git.ts`](../server/src/adapters/git/simple-git.ts) (edit)
  - [`server/src/adapters/mocks.ts`](../server/src/adapters/mocks.ts) (edit)
  - `server/test/git-list-tracked.test.ts` (new)
  - [`client/messages/en/context.json`](../client/messages/en/context.json) (edit, additive)
- **Layer:** ring 1 (contracts, port) · ring 3 (adapters) · client messages.
- **Skills:** `zod`, `onion-architecture`.
- **Do:**
  - Contracts (additive, in the `// ---- Project Context ----` block). These are field shapes, not final code:
    - `ContextReadOnlyReason = z.enum(['outside_root', 'tracked', 'too_large'])`.
    - `ContextFileVersion = z.string().regex(/^[0-9a-f]{64}$/)`: the SHA-256 hex of the file's bytes on disk.
    - `SpecFile` gains three `nullish` fields: `version: ContextFileVersion`, `editable: z.boolean()`, `read_only_reason: ContextReadOnlyReason`.
    - `ContextFileSave = { path: ContextPath, content: z.string().max(65_536), version: ContextFileVersion.nullable() }.strict()`.
      - `max` counts UTF-16 units. One unit is never more than one UTF-8 byte's worth of the cap, so this is a safe pre-filter.
      - The exact byte rule runs in the service, after CRLF→LF.
      - `version: null` means "expect the file to be absent".
    - `ContextFileDeleteQuery = { path: ContextPath, version: ContextFileVersion }.strict()`.
    - `ContextFileCreate = { kind: z.enum(['file', 'folder']), name: z.string().min(1).max(255) }.strict()`.
    - `ContextFileUpload = { name: z.string().min(1).max(255), content_base64: z.string().max(87_384).regex(/^[A-Za-z0-9+/]*={0,2}$/) }.strict()`. 87,384 = 4·⌈65,536/3⌉. An empty file is allowed.
    - `ContextConflictDetails = { reason: z.enum(['changed', 'deleted']), current_version: ContextFileVersion.nullable() }`. It is the `details` of a 409 whose `error.code` is `version_conflict`.
  - Port: add to `GitClient`:
    ```ts
    /** Repo-relative POSIX paths tracked at HEAD under `underDir` (`git ls-tree -r -z --name-only HEAD -- <underDir>`).
        Throws when `clonePath` has no `.git` entry of its own or git fails. */
    listTracked(clonePath: string, underDir: string): Promise<string[]>;
    ```
    It takes the **absolute clone path from the DB**, not a `RepoRef`. `clonePathFor` can differ from `repos.clone_path` ([INSIGHTS.md:360](../INSIGHTS.md)).
  - `SimpleGitClient.listTracked`:
    - First assert that `<clonePath>/.git` exists, as a dir or a file. Without that check, git would walk up into an enclosing repo and return nothing, which would silently "fail open".
    - Then run `simpleGit(clonePath).raw(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', underDir])` and split on `\0`, dropping empty entries.
    - Throw on any git error. A repo with no HEAD throws too.
  - `MockGitClient`: add `MockGitOptions.tracked?: string[] | 'fail'`. `listTracked` returns the list filtered to entries under `underDir`, `[]` by default, and throws when the option is `'fail'`.
  - `server/test/git-list-tracked.test.ts`: a hermetic test with `git init` in a tmpdir (the `git` CLI is on PATH; no Postgres). Cases:
    - a committed `.devdigest/specs/a.md` is returned;
    - an untracked `.devdigest/specs/b.md` is not;
    - a gitignored `.devdigest/specs/c.md` is not;
    - a committed `docs/x.md` is not returned for `underDir` `.devdigest/specs`;
    - a subdirectory with no `.git` inside an outer repo **throws**;
    - a repo with no commit throws.
  - `client/messages/en/context.json`: **add** these keys verbatim. Keep every existing key; step 13 removes the dead ones.
    ```json
    "rootPath": ".devdigest/specs/",
    "localNote": "Files under .devdigest/specs/ exist only in this local clone. If the repository later commits a file at the same path, the next sync replaces your copy.",
    "toolbar": { "newFile": "New file", "newFolder": "New folder", "upload": "Upload" },
    "uploadInput": "Choose a Markdown file to upload",
    "nameDialog": {
      "fileTitle": "New file", "folderTitle": "New folder", "label": "Name",
      "create": "Create", "cancel": "Cancel",
      "defaultFile": "untitled.md", "defaultFolder": "new-folder"
    },
    "pinned": "not in the first 500",
    "mode": { "group": "View mode", "preview": "Preview", "edit": "Edit" },
    "editorLabel": "Edit {path}",
    "save": "Save", "saving": "Saving…", "saved": "All changes saved",
    "delete": "Delete", "deleting": "Deleting…",
    "unsaved": "Unsaved changes",
    "readOnly": {
      "label": "read-only",
      "outside_root": "Only files under .devdigest/specs/ can be edited here.",
      "tracked": "Tracked by the repository — DevDigest does not change committed files.",
      "too_large": "Over 64 KB — this file can be previewed but not edited."
    },
    "emptyRoot": {
      "title": "No spec files yet",
      "body": "Drop your PRDs, tech specs, and acceptance criteria here. Every agent reads them as grounding context. Only .md files are listed.",
      "cta": "Add a spec file"
    },
    "confirm": {
      "cancel": "Cancel",
      "discardTitle": "Discard unsaved changes?",
      "discardBody": "Your changes to {path} have not been saved and will be lost.",
      "discard": "Discard changes",
      "leave": "You have unsaved changes to {path}. Leave and discard them?",
      "deleteTitle": "Delete {path}?",
      "deleteBody": "This removes the file from the local clone. It cannot be undone.",
      "deleteBodyUnsaved": "This removes the file from the local clone, together with your unsaved changes. It cannot be undone.",
      "deleteConfirm": "Delete file",
      "reloadTitle": "Reload from disk?",
      "reloadBody": "Your text will be replaced by the version on disk.",
      "reloadConfirm": "Reload"
    },
    "conflict": {
      "changed": "This file changed on disk after you opened it. Your text has not been saved.",
      "deleted": "This file no longer exists on disk. Your text has not been saved.",
      "deleteChanged": "This file changed on disk after you opened it, so it was not deleted.",
      "deleteGone": "This file no longer exists on disk.",
      "reload": "Reload",
      "overwrite": "Overwrite"
    },
    "writeError": {
      "save": "Couldn’t save this file.",
      "delete": "Couldn’t delete this file.",
      "create": "Couldn’t create the file.",
      "upload": "Couldn’t upload the file.",
      "invalid": "That name or file can’t be used. A file name must end in .md; every name must be at most 255 bytes and avoid reserved names (CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9) and the characters < > : \" / \\ | ? *. A file must be UTF-8 text of at most 64 KB.",
      "retry": "Retry"
    }
    ```
    Inside `"picker"`, add:
    ```json
    "noDocs": {
      "title": "No documents found",
      "body": "Only .md files in the clone are listed. Add Markdown to the repo, then refresh.",
      "cta": "Refresh"
    },
    "rowTokens": "{tokens} tokens",
    "tokensUnavailable": "token count unavailable",
    "overCap": "over 4K soft cap",
    "attach": "Attach",
    "attachedState": "Attached"
    ```
    Inside `"skillTab"`, add `"serializedHeading": "## Project context"`.
- **Done when:**
  - Both `platform.ts` copies are byte-identical (`diff` prints nothing), and so are both `adapters.ts` copies.
  - The existing keys of `context.json` are unchanged and the new keys parse.
  - `git-list-tracked.test.ts` passes, including the "no own `.git` → throws" case.
  - The server and client typechecks are green: the additions are optional fields, and both `GitClient` implementations exist.
- **Verify:** `node scripts/verify.mjs server --file server/test/git-list-tracked.test.ts` · `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs client --checks`

### 1. Pure rules: root predicate, names, suffixing, content, read-only reason
- **Track:** A
- **Files:** [`server/src/modules/project-context/constants.ts`](../server/src/modules/project-context/constants.ts) (edit), [`server/src/modules/project-context/helpers.ts`](../server/src/modules/project-context/helpers.ts) (edit), [`server/test/project-context-helpers.test.ts`](../server/test/project-context-helpers.test.ts) (edit)
- **Layer:** ring 2 (pure; no `node:fs`, no runtime `zod`).
- **Skills:** `onion-architecture`.
- **Do:**
  - Constants, verbatim:
    - `SPECS_ROOT = '.devdigest/specs'`
    - `MAX_NAME_BYTES = 255`
    - `FILE_TEMPLATE = '# Untitled spec\n\n## Goals\n- '`
    - `FOLDER_TEMPLATE = '# New folder spec\n'`
    - `FOLDER_SPEC_NAME = 'spec.md'`
    - `MAX_DOC_BYTES` already exists (65,536) and is the write cap.
  - `isUnderSpecsRoot(path)` is true only when the path starts with exactly `.devdigest/specs/` (case-sensitive) and has at least one segment after it.
  - `specsPathRule(path)` returns `null` or the failed rule: `absolute`, `dotdot`, `empty_segment`, `outside_root` or `not_md`. It reuses the absolute-like rule of `repository-files.ts:70-72`; copy it, don't import across rings.
  - `entryNameRule(name, kind)` returns `null` or one of these rules:
    - `too_long`: more than 255 UTF-8 bytes.
    - `reserved`: the base before the first `.`, case-insensitive, is one of CON, PRN, AUX, NUL, COM1–COM9, LPT1–LPT9.
    - `bad_char`: contains `< > : " / \ | ? *` or U+0000–U+001F.
    - `trailing`: a trailing dot or space.
    - `dot_name`: the name is `.` or `..`.
    - `not_md`: `kind === 'file'` and the name does not end in `.md` (any case).
  - `nextFreeName(name, kind, takenLower: ReadonlySet<string>)`:
    - A file whose name is taken (compared lower-case) becomes `<stem>-2<ext>`, then `-3`, and so on, keeping the extension's case.
    - A folder becomes `<name>-2`, `<name>-3`, and so on.
  - `toLf(text)` replaces every `\r\n` with `\n`.
  - `contentRule(text)` runs on the already-LF text and returns `null`, `too_large` (more than 65,536 UTF-8 bytes), `not_utf8` (`!text.isWellFormed()`) or `nul`.
  - `uploadBytesRule(bytes: Uint8Array)` returns `too_large`, `not_utf8` (via `new TextDecoder('utf-8', { fatal: true })`) or `nul`. A BOM is allowed.
  - `readOnlyReason({ path, tracked, size })` returns `outside_root`, `tracked` or `too_large` (size over 65,536), or `null`. Precedence is outside_root > tracked > too_large (Q5).
- **Done when:** the helpers test pins these boundary inputs (EC-2, EC-3, EC-5, AC-6):
  - Root predicate:
    - `true`: `.devdigest/specs/a.md`, `.devdigest/specs/sub/a.md`.
    - `false`: `docs/.devdigest/specs/a.md` (not at the root), `.devdigest/specs-old/a.md` (near miss), `.devdigest/SPECS/a.md` (case variant), `.devdigest/specs/` (no file).
  - Paths: `/a.md`, `C:\x.md`, `.devdigest/specs/../x.md`, `.devdigest/specs//a.md` and `.devdigest/specs/a.txt` each return their rule.
  - Names:
    - `CON`, `con.md`, `Lpt9.md` and `aux.txt.md` → `reserved`; `COM0.md` and `CONSOLE.md` → `null` (near misses).
    - `a<b.md` → `bad_char`; `a\u001fb.md` → `bad_char`.
    - `x.md.` and `x.md ` → `trailing`.
    - A 255-byte name passes and a 256-byte name fails. Multibyte case: `'€'.repeat(83) + '.md'` (252 bytes) passes and `'€'.repeat(84) + '.md'` (255 bytes) passes; `'€'.repeat(85) + '.md'` (258 bytes) fails.
    - `notes.MD` passes as a file; `notes.mdx` → `not_md`; `new-folder` passes as a folder.
  - Suffixing:
    - `untitled.md` with `{untitled.md}` → `untitled-2.md`.
    - With `{untitled.md, untitled-2.md}` → `untitled-3.md`.
    - `untitled.md` with `{Untitled.MD}` → `untitled-2.md` (case-insensitive).
    - `Notes.MD` with `{notes.md}` → `Notes-2.MD`.
    - Folder `new-folder` with `{new-folder}` → `new-folder-2`.
  - Content:
    - exactly 65,536 bytes passes; 65,537 → `too_large`;
    - `'€'.repeat(21_846)` (65,538 bytes, 21,846 UTF-16 units) → `too_large`;
    - a CRLF text of 65,600 bytes that is 65,500 after `toLf` passes;
    - `'a\u0000b'` → `nul`; `'\ud800'` → `not_utf8`;
    - upload bytes `[0xC3, 0x28]` → `not_utf8`; BOM-prefixed bytes pass.
  - Read-only reason: size 65,536 → `null`; 65,537 → `too_large`; tracked and 70,000 bytes → `tracked`; `docs/a.md` → `outside_root`.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context-helpers.test.ts`

### 2. Ring-3 writer and versioned reader
- **Track:** A
- **Files:**
  - `server/src/modules/project-context/repository-writes.ts` (new)
  - [`server/src/modules/project-context/repository-files.ts`](../server/src/modules/project-context/repository-files.ts) (edit)
  - `server/test/project-context-writes.test.ts` (new)
  - [`server/test/project-context-files.test.ts`](../server/test/project-context-files.test.ts) (edit)
- **Layer:** ring 3 (`modules/*/repository*.ts`; `node:fs`, `node:path` and `node:crypto` allowed).
- **Skills:** `onion-architecture`.
- **Do:**
  - `readDoc` additionally returns `version`, the SHA-256 hex of the **full** on-disk bytes (before truncation). No other behaviour changes; runs ignore the field.
  - `repository-writes.ts` exports small functions. Every function takes the clone path and resolves `realRoot = realpath(clonePath)` once (server/INSIGHTS.md:106).
    - `checkLayout(realRoot, relPath, { createDirs })`:
      - Walk `.devdigest`, `.devdigest/specs` and each folder segment of `relPath` with `lstat`. Any segment that is a symlink or junction (`isSymbolicLink()`) or not a directory → `{ ok: false, rule: 'layout' }`.
      - A missing segment is created with a non-recursive `mkdir` when `createDirs`, and re-`lstat`ed. Otherwise the result is `{ ok: true, exists: false }`.
      - The target file itself must not be a symlink.
      - The function returns the absolute target path.
    - `readCurrent(abs)` returns `{ bytes, version, size }`, or `null` on ENOENT.
    - `listNames(absDir)` returns the entry names.
    - `createExclusive(abs, bytes)` opens with `'wx'` and lets `EEXIST` surface.
    - `mkdirExclusive(abs)` is a non-recursive `mkdir` that lets `EEXIST` surface.
    - `replaceAtomic(abs, bytes)` writes `<dir>/.<base>.<random>.tmp` and then `rename`s it over `abs`. The temp name never ends in `.md`, so the listing never shows it. The temp file is removed on failure.
    - `removeAndPrune(realRoot, abs)` unlinks the file, then `rmdir`s each now-empty parent up to, and **excluding**, `<realRoot>/.devdigest/specs`.
    - `versionOf(bytes)` returns the SHA-256 hex.
- **Done when:** the writes test, hermetic with tmpdirs, shows:
  - **EC-4:**
    - `.devdigest` as a regular file → `layout`.
    - `.devdigest/specs` as a symlink (`symlink(target, p, 'junction')` on Windows, `'dir'` elsewhere) → `layout`, and a file in the link target is untouched.
    - A sub-folder link → `layout`.
    - A clone root that is *itself* a junction to a real dir stays writable.
  - **AC-10:** after removing `.devdigest/specs/a/b/x.md`, `a/b` and `a` are gone and `.devdigest/specs` still exists, even when empty. A sibling file keeps its folder.
  - **NFR-4:**
    - `replaceAtomic` leaves no `*.tmp` behind.
    - A reader looping `readFile` during 50 replacements only ever sees the old or the new bytes.
    - `createExclusive` on an existing path rejects with `EEXIST`.
  - **Versioned reader:** `project-context-files.test.ts` asserts that `readDoc(...).version` equals the SHA-256 of the full bytes for `big.md` (over 64 KB), not of the truncated text.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context-writes.test.ts --file server/test/project-context-files.test.ts`

### 3. Service: listing editability, EC-11 access, create / upload / save / delete
- **Track:** A
- **Files:**
  - [`server/src/modules/project-context/types.ts`](../server/src/modules/project-context/types.ts) (edit)
  - [`server/src/modules/project-context/service.ts`](../server/src/modules/project-context/service.ts) (edit)
  - `server/test/project-context-service.test.ts` (new)
- **Layer:** ring 2.
- **Skills:** `onion-architecture`.
- **Do:**
  - `ProjectContextDeps` gains two members:
    - `writes`: the step-2 functions, typed structurally in `types.ts`.
    - `listTracked: (clonePath: string, underDir: string) => Promise<string[]>`.
    - The service never imports `adapters/**` or `repository-writes.ts`.
  - `ProjectContextPort` gains `create(ws, repoId, input)`, `upload(ws, repoId, input)`, `save(ws, repoId, input)` and `remove(ws, repoId, input)`. Each returns `SpecFile`, except `remove`, which returns `void`.
  - **List:** call `listTracked(clonePath, SPECS_ROOT)` once per call. A throw marks **every** root file as tracked (fail closed, Q5). Each row gets `editable` and `read_only_reason` from `readOnlyReason`.
  - **File:**
    - For a path under the root that passes `specsPathRule`, passes `checkLayout`, and exists on disk, skip the capped-listing check (EC-11). Every other path keeps today's listing check (P8).
    - Return `version`, `editable` and `read_only_reason`.
  - **Attach:** in `assertListed`, a fresh path under the root that passes the same three checks is accepted even when it is past the cap (EC-11).
  - **Writes**, all serialised by a per-repo in-process lock (`Map<repoId, Promise>` on the service instance; NFR-4). Error order:
    1. Unknown repo → 404.
    2. No clone → `new AppError('repo_not_cloned', …, 409)`, and nothing is touched (EC-1).
    3. Path, name or content rule → `ValidationError(msg, { field, rule })`, which is a 422 (EC-3, EC-5).
    4. Layout → 422 with `field: 'path'`, `rule: 'layout'` (EC-4).
    5. `listTracked` throws, or the target is tracked → 422 with `rule: 'tracked'`. This applies to create and upload as well (Q5).
    6. Size over 65,536 on disk → 422 `too_large` (EC-10).
    7. Version mismatch → `new AppError('version_conflict', …, 409, { reason, current_version })` (EC-6).
  - **create:**
    - `kind: 'file'`: `checkLayout(..., { createDirs: true })` on the root, then `nextFreeName` against `listNames(root)` lower-cased, then `createExclusive` with `FILE_TEMPLATE`. On `EEXIST`, recompute the name and retry, up to 50 times.
    - `kind: 'folder'`: the same loop with `mkdirExclusive(<name>)`, then `createExclusive(<name>/spec.md, FOLDER_TEMPLATE)`.
  - **upload:** decode `content_base64` to bytes, apply `uploadBytesRule`, `entryNameRule(name, 'file')` and `nextFreeName` in the **root only**, then `createExclusive` with the bytes **unchanged**.
  - **save:**
    - The written bytes are `Buffer.from(toLf(content), 'utf8')` after `contentRule`.
    - `version: null` → create the parents (`createDirs`), then `createExclusive`. If the file exists → 409 `{ reason: 'changed', current_version }`.
    - `version` set → `readCurrent`. Missing → 409 `{ reason: 'deleted', current_version: null }`. A different hash → 409 `{ reason: 'changed', current_version }`. Otherwise `replaceAtomic`.
  - **remove:** the same tracked, size and version checks, then `removeAndPrune`.
  - Every success returns a `SpecFile`: `path`, `content` (UTF-8 text), `size`, `updated_at`, `kind`, `version`, `tokens` (`countTokens(wrapProjectDoc(...))`, same rule as the listing), `used_by` (0), `editable: true` and `read_only_reason: null`.
  - The service returns `{ path, bytes, outcome }` to the route for logging (step 4). Content is never logged.
- **Done when:** the service test passes. It is hermetic: a fake `ProjectContextStore` whose `getRepo` returns a tmp clone, the real step-2 writes, and a stub `listTracked`. It covers:
  - **AC-2:** create file → `.devdigest/specs/untitled.md` with exactly `# Untitled spec\n\n## Goals\n- `. Create folder → `.devdigest/specs/new-folder/spec.md` with exactly `# New folder spec\n`. The root is created on first use.
  - **EC-2:** a second file create → `untitled-2.md`, and an existing `Untitled.MD` forces `-2`. A second folder → `new-folder-2/spec.md`.
  - **AC-3:** an upload of a BOM + CRLF file is byte-identical on disk and lands in the root.
  - **AC-8:** a CRLF save is written as LF and the returned version changes.
  - **EC-6:**
    - A stale version → 409 `changed` with `current_version`, and the disk is unchanged.
    - A version for a file that was deleted on disk → 409 `deleted` with `current_version: null`.
  - **Q2:** `version: null` on an absent path recreates it, including pruned parent folders. `version: null` on an existing path → 409 `changed`.
  - **AC-10:** delete prunes empty folders and keeps the root.
  - **EC-1:** `clonePath: null` → 409 `repo_not_cloned` for all four writes, and nothing is written.
  - **EC-3:** `name: 'CON.md'` → 422 `name`. Save path `docs/a.md` → 422 `path`.
  - **EC-5:** 65,537 bytes after LF → 422 `content`.
  - **EC-10:** a tracked root file → 422 for save and delete. A 70,000-byte root file → 422 `too_large`.
  - **Q5:** a throwing `listTracked` → every root row has `read_only_reason: 'tracked'` and a create → 422.
  - **EC-11:** `file()` and `putAgent()` accept a root path that exists but is not in the listing passed to the fake. A non-root path not in the listing still → 422 (P8).
  - **NFR-4:** `Promise.all` of two creates yields two distinct files.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context-service.test.ts`

### 4. Routes, write log line, container wiring, integration tests
- **Track:** A
- **Files:**
  - [`server/src/modules/project-context/routes.ts`](../server/src/modules/project-context/routes.ts) (edit)
  - [`server/src/platform/container.ts`](../server/src/platform/container.ts) (edit)
  - [`server/test/project-context.it.test.ts`](../server/test/project-context.it.test.ts) (edit)
- **Layer:** ring 4 (routes, composition root).
- **Skills:** `onion-architecture`, `fastify-best-practices`.
- **Do:**
  - Routes (update the header comment block), each with declarative zod schemas:
    - `POST /repos/:id/context/files`: body `ContextFileCreate` → `201: SpecFile`.
    - `POST /repos/:id/context/upload`: body `ContextFileUpload` → `201: SpecFile`.
    - `PUT /repos/:id/context/file`: body `ContextFileSave` → `200: SpecFile`.
    - `DELETE /repos/:id/context/file`: querystring `ContextFileDeleteQuery` → `204`, empty.
  - **NFR-9**, one line per write request:
    - Each write route declares `config: { writeOutcome: 'created' | 'uploaded' | 'saved' | 'deleted' }`.
    - Plugin-scoped `onError` and `onResponse` hooks act only when `routeOptions.config.writeOutcome` is set. They log exactly one `app.log.info({ repoId, path, bytes, outcome }, 'project-context write')`.
    - On a 2xx, `outcome` is the configured value. On an error whose `code === 'version_conflict'` it is `conflict`. Every other error is `rejected`, including schema 422s, 404 and `repo_not_cloned`.
    - `bytes` is the written byte count on success, otherwise the received content's byte length, or 0.
    - The content is never logged.
  - Container: `projectContext` deps gain `writes` (import the step-2 module) and `listTracked: (c, d) => this.git.listTracked(c, d)`.
  - In the it test, `makeApp` overrides `git` with `new MockGitClient({ tracked: [...] })` where needed.
- **Done when:** `project-context.it.test.ts` has new cases (the existing ones stay green), against real Postgres and a tmp clone:
  - **EC-1:** each write to a `clonePath: null` repo → 409 and no file. An unknown repo id or another workspace's repo → 404.
  - **Untrusted shapes:** an extra body key (strict) → 422; a malformed `version` → 422; `content_base64` with `!` → 422.
  - **AC-2 / AC-3:** both created through HTTP, bodies and bytes checked on disk.
  - **AC-8:** save, then `GET /repos/:id/context` shows the new `size` and a changed `tokens`.
  - **AC-10:** delete returns 204, the folders are pruned, and the listing no longer has the file.
  - **EC-6:** a stale PUT → 409 with `error.details.reason === 'changed'` and `current_version` set.
  - **EC-10:** with the mock tracked list, PUT → 422 and the listing row shows `editable: false`, `read_only_reason: 'tracked'`.
  - **EC-11:**
    - 500 files named `!f-000.md` … `!f-499.md` (they sort before `.devdigest/`), then a created `.devdigest/specs/untitled.md`.
    - The listing has 500 rows and `total` 501.
    - `GET file`, `PUT` save and `PUT /agents/:id/context` all accept that path.
  - **EC-12:**
    - Attach a root doc to an agent and save new text; the next run's `specs_read` contains the path and `prompt_assembly.specs` contains the new text.
    - Delete it; the next run skips it and names it in the run log, using the existing EC-4 test helpers.
  - **NFR-8:** the mock LLM call count is unchanged across all writes.
  - **NFR-9:** a spy on `app.log.info` sees exactly one `project-context write` line per write request, with outcomes `created`, `saved`, `conflict`, `rejected` and `deleted`, and no logged object contains the content string.
  - **NFR-2:** after the writes, no row of `agent_context_docs` or `skill_context_docs` holds anything but paths. The step adds no table, so this only pins the existing schema.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context.it.test.ts`. It needs Docker and self-skips without it; if it skips, say so in the report.

### 5. NFR-3 isolation pin, and the track's checks
- **Track:** A
- **Files:** `server/test/project-context-isolation.test.ts` (new)
- **Layer:** test only.
- **Skills:** none new.
- **Do:**
  - Build a tmp clone containing `.devdigest/specs/x.md`, `.devdigest/specs/y.ts` and `src/a.ts`, then assert:
    - `walkClone(root)` (`server/src/modules/repo-intel/pipeline/walk.ts:55`) never yields a `.devdigest/` path. The case uses a `.ts` file under the root to prove the dot-folder, not only the extension, keeps it out; if `walkClone` *does* include it, record the finding and assert only the `.md` case. The spec's claim rests on `.md` not being indexed.
    - `findConfigFiles(root)` (`conventions/repository-samples.ts:24`) never returns a `.devdigest/` path.
    - `readRunSources(root)` (`onboarding/repository-files.ts:50`) never returns a `.devdigest/` path.
  - The PR-diff half of NFR-3 is structural: diffs are commit-to-commit (`git diff base...head`, `server/src/adapters/git/simple-git.ts:91`), and untracked files are never in a commit. Cite it in the report; there is no test.
- **Done when:** the isolation test passes, and the server lint, typecheck and arch checks are green for the whole track.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context-isolation.test.ts` · `node scripts/verify.mjs server --checks`

### 6. Unsaved-changes navigation guard
- **Track:** B
- **Files:**
  - `client/src/providers/navigation-guard.tsx` (new)
  - `client/src/providers/navigation-guard.test.tsx` (new)
  - [`client/src/providers/AppProviders.tsx`](../client/src/providers/AppProviders.tsx) (edit)
  - [`client/src/components/app-shell/hooks/useGlobalShortcuts.ts`](../client/src/components/app-shell/hooks/useGlobalShortcuts.ts) (edit)
  - [`client/src/components/app-shell/hooks/useShellCommands.ts`](../client/src/components/app-shell/hooks/useShellCommands.ts) (edit)
  - [`client/src/components/app-shell/hooks/useShellContext.ts`](../client/src/components/app-shell/hooks/useShellContext.ts) (edit)
- **Layer:** `src/providers` (app-wide provider stack) and shared shell hooks. Neither imports `src/app`.
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`.
- **Do:**
  - `NavigationGuardProvider` and `useNavigationGuard()` return `{ setBlocker(message: string | null), confirmLeave(): boolean }`.
    - The **default context**, with no provider, is a no-op where `confirmLeave()` returns `true`, so existing tests that render shell hooks without the provider keep working.
    - `confirmLeave()` returns `true` when there is no blocker, otherwise `window.confirm(message)`. The precedent is the sync `window.confirm` at `useShellContext.ts:44`.
    - While a blocker is set, two listeners are active:
      - A `document` **capture-phase** `click` listener for an `<a href>` that is same-origin, primary button, has no modifier key, has no `target="_blank"` or `download`, and points to a different URL. If `confirmLeave()` is false, it calls `preventDefault()` and `stopPropagation()`. Next's `Link` skips a default-prevented click.
      - A `beforeunload` listener that calls `preventDefault()` and sets `returnValue = ''`.
    - Both listeners are removed when the blocker clears.
  - Mount the provider in `AppProviders.tsx` inside `RepoProvider`.
  - In the same file, make `MutationCache.onError` skip the toast when `mutation.meta?.inlineError === true`. Step 7's write mutations set it so EC-7 and EC-9 render inline without a duplicate toast.
  - Guard the six shell sites by returning early when `!confirmLeave()`:
    - `useGlobalShortcuts.ts:46` and `:47`;
    - `useShellCommands.ts:27` and `:35`;
    - `useShellContext.ts:34` (check **before** `setRepoId`) and `:39`.
    - `useShellContext.ts:52` (after removing the active repo) is not guarded; see Out of scope.
- **Done when:** the guard test, using `fireEvent` and a `vi.spyOn(window, 'confirm')`, shows:
  - with no blocker, an anchor click is not intercepted;
  - with a blocker, confirm → false leaves the click default-prevented, and confirm → true lets it through;
  - a `#hash` link and a `target="_blank"` link are never intercepted (near misses);
  - `beforeunload` is default-prevented only while a blocker is set;
  - `confirmLeave()` with no provider returns `true`;
  - removing the blocker removes both listeners.
- **Verify:** `node scripts/verify.mjs client --file client/src/providers/navigation-guard.test.tsx`

### 7. Write hooks
- **Track:** B
- **Files:** [`client/src/lib/hooks/project-context.ts`](../client/src/lib/hooks/project-context.ts) (edit)
- **Layer:** `src/lib/hooks` over `src/lib/api.ts`. No `fetch`, no `src/app` import.
- **Skills:** already loaded.
- **Do:**
  - Add four hooks, each with `meta: { inlineError: true }`:
    - `useCreateContextFile(repoId)`: `api.post('/repos/:id/context/files', { kind, name })`.
    - `useUploadContextFile(repoId)`: `api.post('/repos/:id/context/upload', { name, content_base64 })`.
    - `useSaveContextFile(repoId)`: `api.put('/repos/:id/context/file', { path, content, version })`.
    - `useDeleteContextFile(repoId)`: `api.del('/repos/:id/context/file?path=…&version=…')`, both values `encodeURIComponent`-ed.
  - On success, every hook invalidates `contextFilesKey(repoId)` and sets or removes `contextFileKey(repoId, path)`.
  - Export `conflictOf(err: unknown): ContextConflictDetails | null`. It reads `ApiError.status === 409 && code === 'version_conflict'`.
- **Done when:** the hooks typecheck. They are exercised through the mocked hook module in steps 8 and 9.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx"` (the existing test stays green)

### 8. Page: chrome, toolbar, name dialog, upload, list with read-only and pinned rows, empty state
- **Track:** B
- **Files:**
  - [`client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx`](../client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx) (edit)
  - [`.../ProjectContextView/styles.ts`](../client/src/app/repos/[repoId]/context/_components/ProjectContextView/styles.ts) (edit)
  - [`.../ProjectContextView/ProjectContextView.test.tsx`](../client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx) (edit)
  - `.../ProjectContextView/helpers.ts` (new) and `.../ProjectContextView/helpers.test.ts` (new)
  - `.../ProjectContextView/_components/SpecsToolbar/SpecsToolbar.tsx`, `SpecsToolbar.test.tsx`, `index.ts` (new)
  - `.../ProjectContextView/_components/NameDialog/NameDialog.tsx`, `NameDialog.test.tsx`, `index.ts` (new)
  - (`...` = `client/src/app/repos/[repoId]/context/_components`)
- **Layer:** feature folder under the route segment. Sub-components sit in the view's own `_components/`.
- **Skills:** already loaded.
- **Do:**
  - **Crumb (AC-1):**
    - `[{ label: <repo full_name>, mono: true }, { label: t("title") }, …(selected ? [{ label: selected, mono: true }] : [])]`.
    - The full name comes from `useActiveRepo().repos.find(r => r.id === repoId)?.full_name ?? repoId`.
    - Keep the `<h1>{t("title")}</h1>` that reads "Project Context" (`e2e/specs/14-project-context.flow.json`), with `t("rootPath")` under it in mono.
  - **`SpecsToolbar` (AC-1):** buttons in this order, each with its label as the accessible name:
    1. "New file" (`Plus`)
    2. "New folder" (`Folder`)
    3. "Upload" (`Upload`)
    4. "Refresh" (`RefreshCw`; existing `refresh` key; refetches the listing)

    The first three are `disabled` when `!list.data?.cloned` (EC-1). Below the toolbar sits `t("localNote")`.
  - **`NameDialog` (AC-2):** a `Modal` with a labelled text input pre-filled `t("nameDialog.defaultFile")` ("untitled.md") or `t("nameDialog.defaultFolder")` ("new-folder"), plus Create and Cancel. On Create, the page calls `useCreateContextFile`.
  - **Upload (AC-3):**
    - A visually hidden `<input type="file" accept=".md,text/markdown" aria-label={t("uploadInput")}>` that the Upload button clicks.
    - The file's `arrayBuffer()` goes through `bytesToBase64` (helpers) to `useUploadContextFile`.
    - A 422 shows `t("writeError.invalid")`, and any other failure `t("writeError.upload")`. Create failures likewise show `writeError.invalid` or `writeError.create`.
  - **AC-4:** on success, select the returned path, in `edit` mode after a create and in `preview` mode after an upload.
  - **EC-11:** when the returned path is not in `list.data.files`, keep the returned `SpecFile` as `pinned` and render it as the first row with a `t("pinned")` ("not in the first 500") badge until another file is selected.
  - **List rows:** a non-editable row shows a `t("readOnly.label")` ("read-only") badge.
  - **AC-15:** when `cloned && files.length === 0`, show `EmptyState` with title `t("emptyRoot.title")` ("No spec files yet"), body `t("emptyRoot.body")`, and cta `t("emptyRoot.cta")` ("Add a spec file") whose `onCta` opens New file. Keep the not-cloned empty state (P5) and "showing 500 of N" (P6).
  - **Selecting another row (AC-9):** when the draft is dirty (step 9), open a `ConfirmModal` (`@/components/confirm-modal`):
    - title `t("confirm.discardTitle")`, body `t("confirm.discardBody", { path })`;
    - confirm `t("confirm.discard")`, cancel `t("confirm.cancel")`;
    - Cancel keeps the edits.
  - `helpers.ts`: `bytesToBase64(buf)`, `crumbFor(...)`, `isDirty(draft, baseline)` (compares after CRLF→LF on both sides) and `isPastCap(path, files)`.
- **Done when:**
  - The page test shows:
    - **AC-1:**
      - the crumb shows the repo full name, "Project Context" and, after selecting, the path;
      - ".devdigest/specs/" is visible;
      - the four toolbar buttons appear in the order New file, New folder, Upload, Refresh (`getAllByRole("button")` order);
      - the local note text is present.
    - **EC-1:** with `cloned: false`, New file, New folder and Upload are disabled and Refresh is not.
    - **AC-15:** "No spec files yet", and "Add a spec file" opens the name dialog with "untitled.md".
    - **AC-4:** a mocked create returning `.devdigest/specs/untitled.md` selects it with the Edit mode pressed; a mocked upload selects with Preview pressed.
    - **EC-11:** a created path absent from the listing renders a pinned row with "not in the first 500", which disappears after another row is selected.
    - **AC-9:** with a dirty draft, selecting another row opens "Discard unsaved changes?"; Cancel keeps the text, and Discard switches.
    - **P1–P2:** the existing heading, rendered Markdown, used-by, refresh and error assertions stay green.
  - `helpers.test.ts` covers:
    - `isDirty("a\r\nb", "a\nb") === false` and `isDirty("a\nb ", "a\nb") === true`;
    - `bytesToBase64` round-trips a BOM + CRLF buffer, and an empty buffer gives `""`.
  - `SpecsToolbar.test.tsx` covers the order and the disabled state; `NameDialog.test.tsx` covers prefill, edit and confirm.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx" --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/helpers.test.ts" --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/_components/SpecsToolbar/SpecsToolbar.test.tsx" --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/_components/NameDialog/NameDialog.test.tsx"`

### 9. Page: document pane with Preview | Edit, Save, Delete, conflicts, errors, guard registration
- **Track:** B
- **Files:**
  - `.../ProjectContextView/_components/DocPane/DocPane.tsx`, `DocPane.test.tsx`, `index.ts` (new)
  - `.../ProjectContextView/useSpecDraft.ts` (new; feature-local hook over the step-7 hooks)
  - `ProjectContextView.tsx` (edit, wiring)
  - (`...` = `client/src/app/repos/[repoId]/context/_components`)
- **Layer:** feature folder.
- **Skills:** already loaded.
- **Do:**
  - **Draft state is derived, not synced:** the page keeps `draft: { path, baseline, version, text } | null`.
    - The effective draft is `draft?.path === selected ? draft : (doc.data ? { path, baseline: content, version, text: content } : null)`.
    - `setDraft` runs only on user input, save success or reload. No effect copies server data into state (the `react-hooks/set-state-in-effect` rule).
  - While `isDirty`, call `setBlocker(t("confirm.leave", { path }))`, and clear it otherwise and on unmount (AC-9).
  - **Header row:** the path as a heading (P2), plus a **Preview | Edit** group:
    - `role="group"` with `aria-label={t("mode.group")}`;
    - two hand-rolled `<button type="button" aria-pressed>` labelled "Preview" and "Edit" (`Chip` has no aria pass-through, client/INSIGHTS.md:277);
    - "Used by N agents" (P-existing `usedBy`);
    - Delete and Save, editable files only (AC-5).
  - **Read-only file (AC-6):** no Edit and no Delete; show the "read-only" badge and the text `t(\`readOnly.${read_only_reason}\`)`.
  - **Edit (AC-5):** a hand-rolled `<textarea className="mono" spellCheck={false} aria-label={t("editorLabel", { path })}>`. The kit `Textarea` cannot take `aria-label`.
  - **Preview:** `<Markdown>{effective.text}</Markdown>`, which includes unsaved edits.
  - **AC-7:** when dirty, show the text `t("unsaved")` ("Unsaved changes") and enable Save. When clean, Save is disabled and the text `t("saved")` is shown.
  - **Save (AC-8):** `save({ path, content: text, version })`. On success the baseline becomes `toLf(text)` and the version becomes `response.version`.
  - **EC-8:** while a save or delete is pending, Save and Delete are `disabled` with `loading`, the labels switch to `t("saving")` or `t("deleting")`, and a second click sends nothing.
  - **Conflict (EC-7):** `conflictOf(err)` drives an inline banner, `role="alert"`:
    - **Save conflicts:** `t("conflict.changed")` or `t("conflict.deleted")`, with two buttons:
      - Reload → `ConfirmModal` using `confirm.reloadTitle`, `reloadBody` and `reloadConfirm`. It refetches the file and resets the draft. If the file is gone, it clears the selection and refetches the listing.
      - Overwrite → `save({ path, content: text, version: current_version })`. `current_version: null` recreates the file (Q2).
    - **Delete conflicts:** `t("conflict.deleteChanged")` or `t("conflict.deleteGone")`, with Reload only.
    - The text is kept in every case.
  - **EC-9:** any other save or delete failure shows `t("writeError.save")` or `t("writeError.delete")` with a `t("writeError.retry")` button that re-sends the same request. The text and "Unsaved changes" stay.
  - **Delete (AC-10):**
    - `ConfirmModal` with `confirm.deleteTitle` (`{ path }`), `deleteBody` (or `deleteBodyUnsaved` when dirty, which serves as the AC-9 confirmation for "deletes the open file"), and `deleteConfirm`.
    - On success it clears the selection and the blocker. The listing refetch comes from step 7.
- **Done when:** `DocPane.test.tsx` (mocked step-7 hooks, `fireEvent`) shows:
  - **AC-5:** the Edit button has `aria-pressed="true"` after clicking. Typing in the textarea changes the Preview content.
  - **AC-6:** a `read_only_reason: 'tracked'` file shows "read-only" and "Tracked by the repository — DevDigest does not change committed files.", and no Edit or Delete button. The same holds for `outside_root` and `too_large`, each with its exact string from step 0.
  - **AC-7:** "Unsaved changes" appears after typing and Save becomes enabled. Typing back to the original text hides it.
  - **AC-8:** Save calls the mutation with `{ path, content, version }`, then the indicator clears.
  - **EC-8:** with the mutation pending, Save and Delete are disabled; two clicks give one `mutate` call.
  - **EC-7:**
    - A `changed` 409 shows the message, keeps the text, and offers Reload and Overwrite. Overwrite sends `version: current_version`.
    - A `deleted` 409 → Overwrite sends `version: null`.
    - A delete 409 offers Reload only.
  - **EC-9:** a 500 shows "Couldn’t save this file." and "Retry", and keeps "Unsaved changes".
  - **AC-9:** `setBlocker` is called with the leave message while dirty and with `null` after save. Delete on a dirty file shows the `deleteBodyUnsaved` text.
  - **AC-10:** confirming Delete calls the mutation with `{ path, version }` and clears the selection.
  - **NFR-6:** every toolbar and pane button has an accessible name, and the mode group exposes `aria-pressed`.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/_components/DocPane/DocPane.test.tsx" --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx"`

### 10. Picker helpers: nullable tokens, used-by, soft cap
- **Track:** C
- **Files:**
  - [`client/src/components/context-docs-picker/helpers.ts`](../client/src/components/context-docs-picker/helpers.ts) (edit)
  - [`client/src/components/context-docs-picker/helpers.test.ts`](../client/src/components/context-docs-picker/helpers.test.ts) (edit)
  - `client/src/components/context-docs-picker/constants.ts` (new)
- **Layer:** shared component folder (`src/components`). It must not import `src/app`.
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`.
- **Do:**
  - `DocRow.tokens: number | null`; stop coercing `null` to 0 (`helpers.ts:223,233`).
  - Add `DocRow.usedBy: number` (from `used_by ?? 0`).
  - `estimateTokens` skips `null` and missing rows (EC-13, P4).
  - `SOFT_CAP_TOKENS = 4000` in `constants.ts`; `isOverSoftCap(total) = total > SOFT_CAP_TOKENS`.
- **Done when:** the helpers test pins:
  - `isOverSoftCap(4000) === false` and `isOverSoftCap(4001) === true` (AC-14 boundary);
  - a `tokens: null` attached row is excluded from `estimateTokens` while a `0` row counts as 0;
  - a missing row stays excluded;
  - `usedBy` is copied.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/context-docs-picker/helpers.test.ts`

### 11. Picker: row tokens, over-cap badge, empty state with Refresh, preview drawer that attaches
- **Track:** C
- **Files:**
  - [`client/src/components/context-docs-picker/ContextDocsPicker.tsx`](../client/src/components/context-docs-picker/ContextDocsPicker.tsx) (edit)
  - `client/src/components/context-docs-picker/DocPreviewDrawer.tsx` (new)
  - [`client/src/components/context-docs-picker/DocPreviewModal.tsx`](../client/src/components/context-docs-picker/DocPreviewModal.tsx) (delete)
  - [`client/src/components/context-docs-picker/styles.ts`](../client/src/components/context-docs-picker/styles.ts) (edit)
  - [`client/src/components/context-docs-picker/index.ts`](../client/src/components/context-docs-picker/index.ts) (edit, only if the exported types change)
  - [`client/src/components/context-docs-picker/ContextDocsPicker.test.tsx`](../client/src/components/context-docs-picker/ContextDocsPicker.test.tsx) (edit)
- **Layer:** shared component folder.
- **Skills:** already loaded.
- **Do:**
  - Add `onRefresh: () => void` to `ContextListState`.
  - **AC-15:** when `list.files.length === 0`, render `EmptyState` with title `t("picker.noDocs.title")` ("No documents found"), body `t("picker.noDocs.body")`, cta `t("picker.noDocs.cta")` ("Refresh") and `onCta={listState.onRefresh}`.
  - **AC-13:** each row shows its tokens beside the kind badge:
    - a number renders as `t("picker.rowTokens", { tokens: formatTokenCount(n) })`, using `formatTokenCount` from `@/components/run-cost-badge`;
    - `null` renders `<span aria-label={t("picker.tokensUnavailable")}>—</span>` (EC-13).
  - **AC-14:** the footer total keeps `t("picker.tokens", { tokens })` ("≈ N tokens", P4). When `isOverSoftCap`, the total uses `color: "var(--crit)"` and is followed by `<Badge>{t("picker.overCap")}</Badge>` ("over 4K soft cap", text, not colour alone). Attaching stays enabled (NFR-10).
  - **AC-11 drawer:** `DocPreviewDrawer` wraps the kit `Drawer`:
    - `width={560}`, with `title` = the full path in mono.
    - `subtitle`: kind badge text `t(\`kind.${kind}\`)`, `t("usedBy", { count: usedBy })`, and the tokens rendered as in AC-13. All of it comes from the listing row (NFR-8).
    - `footer`: one button — `t("picker.attach")` ("Attach", `Plus`) when unattached, `t("picker.attachedState")` ("Attached", `Check`) when attached.
    - Body: `<Markdown>` of `useContextFile(repoId, path)`, read-only, with the existing loading and error/retry states.
    - **Escape closes it:** a `document` `keydown` listener in an effect, with cleanup.
  - **AC-12:** the drawer button calls the **same** `toggle(path, !attached)` the checkbox uses, so the drawer button and the checkbox always reflect one `attached` array.
  - **NFR-6 focus return:**
    - Each row's Preview `Button` gets `data-preview-path={row.path}`.
    - The picker wraps its body in a `div` ref.
    - On close, it focuses `wrap.querySelector(\`[data-preview-path="${CSS.escape(path)}"]\`)`.
  - Mount the drawer once at the picker root, never inside a row (client/INSIGHTS.md:175). Remove the `DocPreviewModal` import and delete the file.
- **Done when:** `ContextDocsPicker.test.tsx` shows:
  - **AC-13:**
    - a row with `tokens: 1234` shows "1.2K tokens";
    - `tokens: 999` shows "999 tokens";
    - `tokens: 1000` shows "1K tokens".
  - **EC-13:** `tokens: null` shows "—" with `getByLabelText("token count unavailable")`, and the total excludes it.
  - **AC-14:**
    - attached totals of exactly 4,000 → no "over 4K soft cap";
    - 4,001 → the badge is present;
    - checkboxes stay enabled.
  - **AC-15:** an empty listing shows "No documents found" and the `/Only \.md files/` text, and "Refresh" calls `onRefresh`.
  - **AC-11:**
    - clicking Preview opens a `dialog` that shows the path, the kind badge, "Used by 2 agents", the token text and the rendered body;
    - no `Modal` is used.
  - **AC-12:** clicking "Attach" in the drawer calls `onChange` with the path appended, exactly as the checkbox click does. With `attached` containing the path, the drawer shows "Attached" and the checkbox is checked.
  - **NFR-6:** `Escape` closes the drawer and `document.activeElement` is that row's Preview button.
  - **P3, P7 and the filter case:** the existing assertions ("N of M attached", "missing" row, reorder, "No documents match") stay green.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/context-docs-picker/ContextDocsPicker.test.tsx --file client/src/components/context-docs-picker/helpers.test.ts`

### 12. Context tabs: Refresh wiring and SERIALIZES AS
- **Track:** C
- **Files:**
  - [`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx`](../client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx) (edit) and its `ContextTab.test.tsx` (edit)
  - [`client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx`](../client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx) (edit) and its `ContextTab.test.tsx` (edit)
  - `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/helpers.ts` (new)
  - `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/helpers.test.ts` (new)
- **Layer:** feature folders; `helpers.ts` is feature-local.
- **Skills:** already loaded.
- **Do:**
  - Both tabs pass `onRefresh: () => void list.refetch()` in `listState`.
  - `serializeAs(paths, files)` returns ordered `{ kind, path }[]` for the attached paths **present** in `files`, in attach order. Missing paths are omitted (Q4 = B).
  - The SERIALIZES AS box (`data-testid="serializes-as"`) renders `t("skillTab.serializedHeading")` ("## Project context") on the first line. Then comes one line per entry: `` `- [${t(`kind.${kind}`)}] ${path}` ``.
  - The box still shows only when `paths.length > 0`; when every attached path is missing it shows the heading alone.
- **Done when:**
  - The skill tab test asserts `getByTestId("serializes-as").textContent` equals `"## Project context\n- [specs] specs/a.md\n- [insights] INSIGHTS.md"` for attached `["specs/a.md", "INSIGHTS.md"]`. This replaces the old `"specs/a.md\nINSIGHTS.md"` assertion (AC-16).
  - With `["gone.md", "specs/a.md"]` where `gone.md` is not listed, the text is `"## Project context\n- [specs] specs/a.md"`, and the picker still shows the "missing" row (Q4, P7).
  - `helpers.test.ts` pins the order, the omission, and that exactly one line starts with `##`.
  - The agent tab test asserts that the empty-listing Refresh calls `list.refetch`.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx" --file "client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/helpers.test.ts" --file "client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx"`

### 13. Integration: dead copy, docs, full verify
- **Track:** shared
- **Files:**
  - [`client/messages/en/context.json`](../client/messages/en/context.json) (edit)
  - [`server/src/modules/project-context/README.md`](../server/src/modules/project-context/README.md) (edit)
  - [`server/README.md`](../server/README.md) (edit; route list near `:111`)
  - [`client/README.md`](../client/README.md) (edit; `:33`, `:55`, `:59`)
- **Layer:** docs and messages.
- **Skills:** none.
- **Do:**
  - Remove `crumbWorkspace`, `noFiles` and `picker.close` from `context.json`. Do this only if `rg "crumbWorkspace|noFiles|picker\.close" client/src` finds no consumer; otherwise keep the key and say why.
  - Server module README:
    - add the four write routes;
    - add the version token, the 409 `version_conflict` details and `repo_not_cloned`;
    - add the writer guards (layout, tracked fail-closed, 64 KB, LF, atomic rename, per-repo lock, pruning);
    - add the EC-11 root exception and the NFR-9 log line;
    - add the upstream-overwrite limitation (NFR-2).
  - Root server README: add the routes to the module list.
  - Client README:
    - the page is no longer "read-only";
    - the picker previews in a drawer;
    - the unsaved-changes guard and its Back/Forward limitation.
- **Done when:**
  - Both full runs are green.
  - The it lane passes or is reported as skipped because Docker is absent.
  - `e2e/specs/14-project-context.flow.json` is unchanged and still matches: the h1 is still "Project Context".
- **Verify:** `node scripts/verify.mjs server --it` · `node scripts/verify.mjs client`

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server --file server/test/git-list-tracked.test.ts` | `listTracked` port (EC-10 input, Q5 fail-closed source) |
| server | `node scripts/verify.mjs server --file server/test/project-context-helpers.test.ts` | EC-2, EC-3, EC-5, AC-6 precedence; boundary inputs incl. root-path near-misses and 65,536/65,537 |
| server | `node scripts/verify.mjs server --file server/test/project-context-writes.test.ts --file server/test/project-context-files.test.ts` | EC-4 (junction below vs at root), AC-10 pruning, NFR-4 atomic/exclusive, version of full bytes |
| server | `node scripts/verify.mjs server --file server/test/project-context-service.test.ts` | AC-2, AC-3, AC-8, AC-10, EC-1, EC-2, EC-3, EC-5, EC-6, EC-10, EC-11, Q2, Q5, NFR-4 (hermetic, fake store) |
| server | `node scripts/verify.mjs server --file server/test/project-context.it.test.ts` | Postgres lane: routes, EC-1 404/409, schema 422s, AC-8 listing, EC-6, EC-10, EC-11 (501 files), EC-12, NFR-2, NFR-8, NFR-9 — **`*.it.test.ts`, needs Docker** |
| server | `node scripts/verify.mjs server --file server/test/project-context-isolation.test.ts` | NFR-3 (repo-intel walk, conventions, onboarding) |
| client | `node scripts/verify.mjs client --file client/src/providers/navigation-guard.test.tsx` | AC-9 leave guard (links, beforeunload, near-miss links) |
| client | `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx"` (+ `helpers.test.ts`, `SpecsToolbar.test.tsx`, `NameDialog.test.tsx`, `DocPane.test.tsx` in that folder) | AC-1, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-15, EC-1, EC-7, EC-8, EC-9, EC-11 pinned row, NFR-6, P1, P2, P5, P6 |
| client | `node scripts/verify.mjs client --file client/src/components/context-docs-picker/ContextDocsPicker.test.tsx --file client/src/components/context-docs-picker/helpers.test.ts` | AC-11, AC-12, AC-13, AC-14 (4,000 / 4,001), AC-15, EC-13, NFR-6 Escape + focus, NFR-10, P3, P4, P7 |
| client | `node scripts/verify.mjs client --file "client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx"` (+ its `helpers.test.ts`, the agent `ContextTab.test.tsx`) | AC-16, Q4 omission, AC-15 Refresh wiring |
| server | `node scripts/verify.mjs server --it` | Full run: lint · typecheck · arch · hermetic · integration lane — NFR-5 (no `reviewer-core` diff) is static: `git diff --stat main -- reviewer-core` is empty |
| client | `node scripts/verify.mjs client` | Full run: lint · typecheck · all component tests — NFR-7 static: no literal user-facing strings in new files |

## Risks & rollback
- **Tracks B and C share one client typecheck.** A half-written file in one track can turn the other's `--checks` red. That is why B and C verify with `--file` only, and the full client run is in step 13 alone.
  - Rollback: none needed. Re-run step 13 after both tracks report done.
- **Next `Link` interception depends on Next skipping a default-prevented click**, plus `stopPropagation` at document capture. jsdom cannot run a real App Router `Link`, so step 6 tests plain anchors.
  - Manual check after Integration: with a dirty draft, click a sidebar link → a confirm dialog appears, and Cancel stays on the page.
  - Rollback: revert step 6. The page-level guards (select, delete, reload or close) still work.
- **Back/Forward are not guarded.** This is a documented limitation (Q1 = A), so a Back press with unsaved edits loses them silently.
  - Rollback: n/a.
- **An attached `.devdigest/specs/` file past the 500 cap** shows as "missing" in the Context tabs and is left out of the total, yet a run injects it (`client/src/components/context-docs-picker/helpers.ts:221-224` vs `server/src/modules/project-context/service.ts:121-129`). This extends spec Q-1 (Rec 6). It is rare because `.devdigest/` sorts near the top.
  - Rollback: n/a.
- **Windows `rename` over a file another process holds open can fail with `EPERM`.** The page shows EC-9's error with Retry, and the disk keeps the old bytes, because the temp file is removed.
  - Rollback: n/a.
- **Upstream later commits a file at an authored path:** the next resync replaces it (NFR-2). This is a documented, undetected limitation, stated on the page by `localNote`.
- **Fail-closed tracking:** a clone whose HEAD is missing, or a git error, makes every root file read-only and blocks creates. That is intended (Q5), but it may surprise on a broken clone. The read-only reason text is the signal.
- **Rollback per track:** each track is one implementer run, ideally one commit. Revert A, B or C independently. Step 0 is additive, and reverting it alone breaks no caller once A, B and C are reverted.

## Out of scope
- Rename or move; detecting an upstream collision; Re-index, chunks, coverage ring, "Skills loaded", CI and MCP visibility; committing or pushing authored files (spec Non-goals).
- Guarding browser Back/Forward. Guarding `useShellContext.ts:52` (navigation after removing the active repo, which already asks its own `window.confirm`).
- Any change to `reviewer-core`, the prompt, `INJECTION_GUARD`, the DB schema or migrations.
- Offering a past-cap root file in the picker (spec Q-1).
- Editing `client/src/vendor/ui/**`. Escape, focus return and the textarea's accessible name are done in wrappers.
- No track edits a file owned by another track. A, B and C each touch only their *Owned files*.
- Writing or amending the spec. A gap goes back to `spec-creator` or the author as an Open question.
- Architectural review and security review: separate agents own those.
- Opening or pushing a PR: `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking:** the step-0 copy is the planner's draft (Q3 = A). The author approves it with this plan; any wording change is a step-0 edit only. Default: as written.
- **Non-blocking:** if `walkClone` turns out to include `.ts` files under dot-folders (step 5), NFR-3 still holds for `.md`, which the indexer never parses. The step records the finding instead of changing the indexer. Default: report, no indexer change.
