# Implementation Plan: Project Context — attach repo Markdown documents to agents and skills

**Plan ID:** 2026-09-29-project-context  ·  **Spec:** [specs/2026-09-29-project-context.md](specs/2026-09-29-project-context.md)  ·
**Execution mode:** multi-agent (step 0 shared → tracks A server ∥ B client → Integration)  ·  **Packages:** reviewer-core, server, client  ·
**Assumptions:** the spec's twelve non-blocking open questions are planned against their stated drafts (read-only page, no coverage ring, no chunking, no "Skills loaded" chips, SERIALIZES AS lists paths only, documents stay untrusted, total-only token figure, studio runs only, sidebar entry after Pull Requests, Repo skeleton stays before Project context, per-call token figure). Four more are listed under *Requirements review → Assumptions A1–A4*.

## Summary
Build a new server module `modules/project-context/` that lists the active repo's clone Markdown files, serves one document at a time, persists ordered (repo, path) attachments on agents and on skills, and resolves the documents that reach a run. The run executor reads them from the clone once, at run start, and passes them to `reviewer-core` as path-labelled untrusted blocks under the existing `## Project context` slot. It also fills `specs_read`. The client gets a Project Context page, a shared attach/reorder picker used by the Agent editor's and the Skill editor's new Context tabs, a sidebar entry, and the design's trace label. The module is named **`project-context`**, not `context`: `modules/_shared/context.ts` (request tenancy) and `db/schema/context.ts` (code chunks) already use `context`, and the kebab-case name matches `repo-intel` and `smart-diff` and the page title.

## Requirements review

**What I understood:** users attach ordered clone Markdown files to agents and skills per repo, see the token cost, and a studio run injects their full text, capped and untrusted, and lists them in the trace.
**Inputs read:** specs/2026-09-29-project-context.md · the four PNGs under specs/designs/project-context/ (03 and 04 viewed) · AGENTS.md, server/AGENTS.md, client/AGENTS.md, reviewer-core/AGENTS.md · INSIGHTS.md, server/INSIGHTS.md, client/INSIGHTS.md, reviewer-core/INSIGHTS.md.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "list every `.md` file in that repo's clone working tree, excluding `.git/` and `node_modules/` … sorted by path" | §AC-1 | clear |
| R2 | "one kind from its path: `specs/` → specs; `docs/` → docs; `INSIGHTS.md` or `insights/` → insights; otherwise other" | §AC-2 | clear |
| R3 | "show its content rendered as Markdown, with its path as the heading" | §AC-3 | clear |
| R4 | "sidebar shall show a "Project Context" entry in the WORKSPACE group" · verify: e2e | §AC-4 | ambiguous: the e2e lane is outside the spec's Packages line. See A3 |
| R5 | "show "Used by N agents" … directly or through an enabled skill link" | §AC-5 | ambiguous: disabled agents. See A4 |
| R6 | "checkbox, the path, a kind badge and a Preview action … filter box and an "N of M attached" count" | §AC-6 | clear |
| R7 | "persist or remove the (repo, path) attachment … count shall reflect the change without a page reload" | §AC-7 | clear |
| R8 | "reorders attached documents … persist the new order and reproduce it on the next load" | §AC-8 | clear |
| R9 | "show "≈ N tokens" … including the per-document cap … without a network round trip" | §AC-9 | clear |
| R10 | "Skill editor's Context tab … "Any agent using this skill inherits these documents." and a SERIALIZES AS box" | §AC-10 | clear |
| R11 | "agent for R, then … each skill that is enabled and enabled on that agent, in the agent's skill order … each distinct path once" | §AC-11 | clear |
| R12 | "each read document's full text, up to the per-document cap, as its own untrusted block … shall name the document's repo-relative path" | §AC-12 | clear. The tree labels blocks `spec-${i}` today ([reviewer-core/src/prompt.ts:106](reviewer-core/src/prompt.ts:106)), so the engine must change (step 1) |
| R13 | ""Specs read" row shall list the injected paths in injection order" | §AC-13 | clear |
| R14 | "label the slot "Project context — attached specs (untrusted)" … copying it shall put that same text on the clipboard" | §AC-14 | clear. Copy and fullscreen already exist ([PromptBlock.tsx:30](client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/PromptBlock/PromptBlock.tsx:30)) |
| R15 | "IF no document reaches a run … byte-identical to today's and omit the Project context row" | §AC-15 | clear |
| R16 | "activates refresh … re-read the clone listing" | §AC-16 | clear |
| R17 | "no clone yet … empty state saying the repo is not cloned, and attaching shall be unavailable" | §EC-1 | clear. Needs a response field beyond `SpecFile[]`. See Rec 1 |
| R18 | "no `.md` file … empty state that names the supported file type" | §EC-2 | clear |
| R19 | "more than 500 … list the first 500 by path and the page shall say "showing 500 of N"" | §EC-3 | clear (needs `total`, Rec 1) |
| R20 | "missing or unreadable when a run starts … skip it, name its path in the run log, leave it out of "Specs read"" | §EC-4 | clear |
| R21 | "exceeds 64 KB … first 64 KB followed by a visible truncation marker, and log the truncation" | §EC-5 | clear |
| R22 | "PR belongs to a repo other than an attachment's repo … shall not inject" | §EC-6 | clear |
| R23 | "attached path is no longer in the clone listing … "missing" row that can still be unchecked, and exclude it from the token estimate" | §EC-7 | ambiguous together with R24. See A1 |
| R24 | "attach request names a path that is not in the repo's current listing … reject it with 422 and persist nothing" | §EC-8 | ambiguous: a PUT that keeps an already-attached missing path would 422 and break EC-7. See A1 |
| R25 | "same path attached to the agent and to one of its skills … inject it once, at the agent's position" | §EC-9 | clear |
| R26 | "list or a document preview fails to load … error state with a retry action" | §EC-10 | clear |
| R27 | "filter text matches no document … "no documents match" line and keep the attached count unchanged" | §EC-11 | clear |
| R28 | "toggles the same checkbox twice in quick succession … persisted state shall equal the last visible state, with no duplicate" | §EC-12 | clear |
| R29 | "list response carries at most 500 entries and no document content … one document per request … at most 64 KB" | §NFR-1 | clear |
| R30 | "listing, previewing, attaching and the token estimate make no LLM call" | §NFR-2 | clear |
| R31 | "every new user-facing string comes from `messages/en/<namespace>.json`" | §NFR-3 | ambiguous: sidebar labels are literals in the app-owned `nav.ts` registry ([client/src/vendor/ui/nav.ts:24](client/src/vendor/ui/nav.ts:24), rendered at [NavItem.tsx:54](client/src/vendor/ui/shell/NavItem.tsx:54)). See A2 |
| R32 | "each checkbox's accessible name contains the document path … reordered with the keyboard alone … kind … badge text" | §NFR-4 | clear |
| R33 | "attaching and injection work when the repo is unindexed or repo-intel is off" | §NFR-5 | clear |
| R34 | "wrapped as untrusted data, a closing delimiter inside a document cannot end its block, and `INJECTION_GUARD` is unchanged" | §NFR-6 | clear |
| R35 | "traces persisted before this feature still render, and a changed contract is mirrored" | §NFR-7 | clear |
| R36 | "each run logs one line with the number of injected documents, their total tokens, and the paths that were skipped or truncated" | §NFR-8 | clear |
| R37 | "changing attachments while a run is in progress does not change that run's prompt. Documents are read once, at run start" | §NFR-9 | clear |
| R38 | Document content → prompt: "wrapped as untrusted, closing delimiter escaped, 64 KB cap" | §Untrusted inputs | clear |
| R39 | Document content in preview: "only through the existing Markdown renderer, never raw HTML" | §Untrusted inputs | clear (`Markdown` uses react-markdown with no rehype-raw, [Markdown.tsx:10](client/src/vendor/ui/primitives/Markdown.tsx:10)) |
| R40 | `path`: "string of 1–1024 chars, repo-relative, `.md`; must be in the repo's current listing; symlink targets stay under the clone" | §Untrusted inputs | clear |
| R41 | Attach body: "strict object; at most 500 unique paths; order is the array order" | §Untrusted inputs | clear |
| R42 | `repoId`, agent `:id`, skill `:id`: "resolves to a row in the caller's workspace" → "404" | §Untrusted inputs | clear |
| R43 | File and folder names: "Shown verbatim as text, never as markup". This includes the prompt label | §Untrusted inputs | clear. The label is sanitised in the engine (step 1) |

### Assumptions (non-blocking gaps, default taken)
- **A1 (R23/R24):** a `PUT` is validated against the listing **only for paths not already attached** to that owner for that repo. A path already persisted is kept even if it is missing now. That is how a user can reorder or toggle other rows while a "missing" row is still attached (EC-7), and it is not a new attach (EC-8).
- **A2 (R31):** the sidebar label follows the existing `nav.ts` literal pattern (every entry is a literal there). The command-palette label comes from the existing `shell.json` key `nav.context` ([client/messages/en/shell.json](client/messages/en/shell.json)). Every other new string goes through `messages/en`.
- **A3 (R4):** AC-4 is covered by a client unit test on the `NAV` registry plus `activeKeyFor`. A browser flow `e2e/specs/14-project-context.flow.json` is a follow-up, because `e2e/` is not in the spec's Packages line.
- **A4 (R5):** "Used by" counts every agent in the workspace, whether or not `agents.enabled` is set, because a disabled agent still receives the document when it runs. Skill links count only when `skills.enabled AND agent_skills.enabled`, the same rule as the prompt path ([server/src/modules/skills/repository.ts:207](server/src/modules/skills/repository.ts:207)).

### Recommendations
1. **Adopted: list response envelope `ContextFileList { cloned, total, files: SpecFile[] }`** instead of a bare `SpecFile[]`. Why: EC-1 needs "not cloned" and EC-3 needs N, and a bare array carries neither ([client/src/lib/hooks/core.ts:126](client/src/lib/hooks/core.ts:126) types it as `SpecFile[]` today, with zero callers). Plan change: step 0 contract; the hook in step 8 is replaced, not reused.
2. **Adopted: `ReviewInput.specs` / `PromptParts.specs` accept `string | { path, content }` entries.** An object entry is labelled by its sanitised path. A string keeps `spec-${i}`, so [server/test/prompt-skills.test.ts:22](server/test/prompt-skills.test.ts:22) and any CI-runner caller stay byte-identical (AC-15). Plan change: step 1.
3. **Adopted: one exported `wrapProjectDoc(path, content)` in reviewer-core**, used by `assemblePrompt` and by the server's per-document token count. Why: AC-9 wants tokens "as they would be injected"; two wrappers would drift. Plan change: steps 1 and 5.
4. **Adopted: serialise attachment writes on both ends.** The client uses a TanStack mutation `scope` per owner with an optimistic cache update. The server replaces the rows in one transaction that first takes `SELECT … FOR UPDATE` on the owner row. Why: EC-12; a plain delete+insert under two concurrent PUTs hits the PK and 500s. Plan change: steps 5 and 8.
5. **Not adopted: hoisting `readRepoFile` ([server/src/modules/intent/repository-plans.ts:32](server/src/modules/intent/repository-plans.ts:32)) into `modules/_shared/` for reuse.** It is a refactor of a shipped module with a different cap (`MAX_PLAN_CHARS`). The new module gets its own ring-3 reader with the same guard shape. Logged as a follow-up.

### Execution mode
Chosen by the planner, as the caller asked: **multi-agent**. `server/` and `client/` share no file once the contracts and the engine signature land in step 0.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | do-not-touch (grounding, `INJECTION_GUARD`, migrations, lock-files), naming table, verify script |
| [server/AGENTS.md](server/AGENTS.md) · [server/README.md](server/README.md) | module = `routes.ts` + one `modules/index.ts` entry; declarative validation; the `container.intent` facade precedent |
| [reviewer-core/AGENTS.md](reviewer-core/AGENTS.md) | purity contract; optional slots omitted when empty; untrusted text goes through `wrapUntrusted` |
| [client/AGENTS.md](client/AGENTS.md) | no `fetch` in components; `nav.ts` is app-owned despite living in `vendor/ui`; `@/` for cross-folder imports |
| [reviewer-core/src/prompt.ts:30-34,104-106,127](reviewer-core/src/prompt.ts:104) | the wrapper, the `spec-${i}` label, the `## Project context` slot position |
| [reviewer-core/src/review/run.ts:61,141](reviewer-core/src/review/run.ts:61) | `ReviewInput.specs` passes straight into `promptParts` (reused per chunk in map-reduce) |
| [server/src/modules/reviews/run-executor.ts:225,231,342,395](server/src/modules/reviews/run-executor.ts:225) | where skills resolve, where `reviewPullRequest` is called, `specs_read: []` |
| [server/src/platform/container.ts](server/src/platform/container.ts) | `intent` getter + `ContainerOverrides.intent`: the shape for `projectContext` |
| [server/src/modules/intent/types.ts](server/src/modules/intent/types.ts) · [intent/routes.ts](server/src/modules/intent/routes.ts) | port interface in `types.ts`; routes call `container.<port>` |
| [server/src/modules/intent/repository-plans.ts:32-62](server/src/modules/intent/repository-plans.ts:32) | the traversal + realpath symlink guard to copy |
| [server/src/modules/repo-intel/pipeline/walk.ts:55-120](server/src/modules/repo-intel/pipeline/walk.ts:55) | walker shape (skip symlinks, posix relpaths, sorted), but a different exclusion set, so it is not reused |
| [server/src/db/schema/agents.ts:65-85](server/src/db/schema/agents.ts:65) · [server/src/db/schema.ts](server/src/db/schema.ts) | binding-table precedent (no `workspace_id`, FK index on the non-leading key); barrel + `schema` object to extend |
| [server/eslint.config.mjs:114-127](server/eslint.config.mjs:114) | ring-2 globs cover `service.ts`/`helpers.ts`/`constants.ts`; `repository*.ts` is ring 3; `@devdigest/reviewer-core` is allowed in ring 2 |
| [server/src/vendor/shared/contracts/platform.ts:254-261](server/src/vendor/shared/contracts/platform.ts:254) · [trace.ts:40-56,109](server/src/vendor/shared/contracts/trace.ts:40) | `SpecFile` to extend; `PromptAssembly.specs`, `PromptTokens.specs`, `specs_read` already exist, so the trace contract does not change |
| [client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx](client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx) | drag + ArrowUp/ArrowDown reorder, filter and count precedent to copy |
| [client/src/app/agents/[id]/page.tsx:15](client/src/app/agents/[id]/page.tsx:15) · [AgentEditor/constants.ts](client/src/app/agents/[id]/_components/AgentEditor/constants.ts) · [skills/[id]/_components/SkillEditor/constants.ts](client/src/app/skills/[id]/_components/SkillEditor/constants.ts) | where tab keys are whitelisted |
| [client/src/providers/repo-context.tsx](client/src/providers/repo-context.tsx) | `useActiveRepo().repoId` is the active repo in the editors |
| [client/src/components/app-shell/helpers.ts:30](client/src/components/app-shell/helpers.ts:30) | `activeKeyFor` already maps `/context` → `"context"` |
| [client/messages/en/context.json](client/messages/en/context.json) · [runs.json:50](client/messages/en/runs.json:50) | prepared namespace (unused, stale copy about `.devdigest/specs/`); the trace label to change |

## Insights that bind this work
1. **Shared contracts are vendored twice and have drifted.** [INSIGHTS.md:262-266](INSIGHTS.md:262). Step 0 edits `server/src/vendor/shared/contracts/platform.ts` and mirrors the identical block into `client/src/vendor/shared/contracts/platform.ts` in the same step, and both packages typecheck in its verify.
2. **Wrapped text cannot instruct.** [INSIGHTS.md:301-312](INSIGHTS.md:301). Every document goes through `wrapProjectDoc` → `wrapUntrusted`. The documents inform findings and never define the job (Q-7 draft). `INJECTION_GUARD` is not edited, and no keyword scan is added.
3. **A clone reader lives in its own `repository-<what>.ts`; `helpers.ts` stays pure.** [server/INSIGHTS.md:173-181](server/INSIGHTS.md:173). All `node:fs` use goes into `modules/project-context/repository-files.ts` (ring 3 by filename). Kind derivation, injection ordering, dedupe and used-by counting are pure functions in `helpers.ts`, tested hermetically.

Also honoured:
- A service cannot name a port declared beside its adapter ([server/INSIGHTS.md:195-203](server/INSIGHTS.md:195)), so the service takes `countTokens: (s) => number`, not `Tokenizer`.
- An FK needs a deliberate index decision ([server/INSIGHTS.md:162-171](server/INSIGHTS.md:162)).
- `reviews`-style run tests are not hermetic unless `intent` is stubbed ([server/INSIGHTS.md:75-81](server/INSIGHTS.md:75)).
- The client `Checkbox` is `role="checkbox"` and asserts on `aria-checked` ([client/INSIGHTS.md:77-80](client/INSIGHTS.md:77)).
- Export query-key builders ([client/INSIGHTS.md:197-201](client/INSIGHTS.md:197)).
- `ErrorState` owns its retry label ([client/INSIGHTS.md:273-275](client/INSIGHTS.md:273)).

**"What Doesn't Work" check:**
- *Do not add a required field to a persisted trace* ([server/INSIGHTS.md:29-35](server/INSIGHTS.md:29)): `RunTrace` is not changed, and the new `SpecFile` fields are `.nullish()`.
- *Preloading a review catalogue* ([INSIGHTS.md](INSIGHTS.md) What Doesn't Work, 2026-09-29): the Skill contract names no `security` or `typescript-expert`.
- *`drizzle-kit generate` hangs on an add+drop in one table* ([server/INSIGHTS.md:274-280](server/INSIGHTS.md:274)): only new tables are added, so no rename prompt is triggered.

## Constraints
- **Onion rings (server):** `modules/project-context/constants.ts`, `helpers.ts` and `service.ts` are ring 2: no `drizzle-orm`, no `node:fs`, no runtime `zod`, no `fastify`, no `**/adapters/**`. `repository.ts` and `repository-files.ts` are ring 3. `routes.ts` is ring 4. `types.ts` holds the port, following the `intent/types.ts` precedent. `run-executor.ts` reaches the module **only** through `Container['projectContext']`, a type-only edge. `no-cross-module-reach-in` forbids importing `modules/project-context/*` from `modules/reviews/*`.
- **Contract once + mirror:** new and changed schemas go in `server/src/vendor/shared/contracts/platform.ts` and are mirrored byte-for-byte into `client/src/vendor/shared/contracts/platform.ts` (step 0 only; no track edits either copy).
- **`.js` on relative imports** in `server/` and `reviewer-core/`.
- **`*.it.test.ts`** for every server test that touches Postgres (`project-context.it.test.ts`). The filesystem-only tests keep plain `*.test.ts`.
- **Declarative validation:** zod `params`, `querystring`, `body` and `response` on every new route. No `.parse()` in a handler.
- **Migrations:** add the schema, then run `cd server && pnpm db:generate`. Keep the generated `NNNN_<random>.sql` and `meta/` files as produced. Never rename them and never edit an applied migration.
- **Do not touch:** `reviewer-core/src/grounding.ts`; the `INJECTION_GUARD` constant in `reviewer-core/src/prompt.ts` (step 1 edits other lines of that file only); lock-files (no new dependency is needed anywhere); `client/src/vendor/ui/**` except `nav.ts`; `client/src/vendor/shared/**` except the step-0 mirror.
- **Client:** no `fetch` in components; hooks in `client/src/lib/hooks/project-context.ts` over `src/lib/api.ts`; strings in `messages/en/*.json`; `_components/<Name>/<Name>.tsx` + `<Name>.test.tsx`; code shared by two routes goes in `src/components/<kebab>/`; `src/components` and `src/lib` never import `src/app`.
- **Secrets:** none involved.

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/platform.ts` (+ client mirror) | `zod` | wire contracts (`typescript-expert` is review-time, the gate's) |
| `reviewer-core/src/**` | none at write time | engine write-time set is empty; `typescript-expert`/`security` are applied by the gate |
| `server/src/db/schema/**` | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design` | ring 3 + table/constraint/index design |
| `server/src/modules/project-context/repository*.ts` | `onion-architecture`, `drizzle-orm-patterns` | ring 3 persistence + filesystem |
| `server/src/modules/project-context/{service,helpers,constants,types}.ts`, `server/src/modules/reviews/run-executor.ts` | `onion-architecture` | ring 2 |
| `server/src/modules/project-context/routes.ts`, `server/src/modules/index.ts`, `server/src/platform/container.ts` | `onion-architecture`, `fastify-best-practices` | ring 4 + HTTP surface (`security` is review-time) |
| `client/src/**/*.tsx`, `client/src/lib/hooks/*.ts`, `client/src/components/**` | `frontend-ui-architecture`, `react-best-practices` | placement + component/hook rules |
| `client/src/app/repos/[repoId]/context/page.tsx` and every `"use client"` file | `next-best-practices` | App Router convention file / client boundary |
| `client/**/*.test.tsx` | `react-testing-library` | component tests |
| `server/test/**`, `client/messages/**`, migrations | none | convention-only |

Derived from the write-time row of [.claude/skills/pr-self-review/routing.md](.claude/skills/pr-self-review/routing.md). Each implementer loads each skill once, at the first step that needs it. Track A: `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`, `fastify-best-practices`. Track B: `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`. Step 0: `zod`.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/index.ts`, `reviewer-core/test/prompt.test.ts` | 0–1 | `node scripts/verify.mjs server client --checks` · `node scripts/verify.mjs reviewer-core --file reviewer-core/test/prompt.test.ts` | — |
| A — server | `server/src/db/schema/project-context.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/**` (generated only), `server/src/modules/project-context/**`, `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/src/modules/reviews/run-executor.ts`, `server/test/project-context*.ts` | 2–7 | `node scripts/verify.mjs server --checks` · `--file server/test/project-context-*.test.ts` | step 1 |
| B — client | `client/src/lib/hooks/project-context.ts`, `client/src/lib/hooks/core.ts`, `client/src/components/context-docs-picker/**`, `client/src/app/repos/[repoId]/context/**`, `client/src/app/agents/[id]/page.tsx`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `…/AgentEditor/constants.ts`, `…/AgentEditor/_components/ContextTab/**`, `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx`, `…/SkillEditor/constants.ts`, `…/SkillEditor/_components/ContextTab/**`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/nav.test.ts`, `client/messages/en/{context,agents,skills,runs}.json`, `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx` | 8–13 | `node scripts/verify.mjs client --checks` · `--file <Name>.test.tsx` | step 1 |
| shared — integration | no new file; fixes found by the full run go back to the owning track's files | 14 | `node scripts/verify.mjs reviewer-core server client` + `node scripts/verify.mjs server --it` (the one full run) | A, B |

Each track is one `implementer` invocation. Tracks A and B are in different packages, so neither can turn the other's `typecheck` red.

## Steps

### 0. Contracts: extend `SpecFile`, add the list envelope and attachment shapes, mirror to the client
- **Files:** [`server/src/vendor/shared/contracts/platform.ts`](server/src/vendor/shared/contracts/platform.ts) (edit) · [`client/src/vendor/shared/contracts/platform.ts`](client/src/vendor/shared/contracts/platform.ts) (edit, identical block)
- **Track:** shared
- **Layer:** ring 1, the canonical contracts; the client copy is a mirror
- **Skills:** `zod`
- **Do:** under the existing `// ---- Project Context ----` block ([platform.ts:254](server/src/vendor/shared/contracts/platform.ts:254)):
  - `ContextDocKind = z.enum(['specs','docs','insights','other'])`.
  - Extend `SpecFile` with `kind: ContextDocKind.nullish()`, `tokens: z.number().int().nullish()` (tokens of the block as injected, capped) and `used_by: z.number().int().nullish()`. `path`, `content`, `size` and `updated_at` stay as they are.
  - `ContextFileList = z.object({ cloned: z.boolean(), total: z.number().int(), files: z.array(SpecFile) })`. `total` is the uncapped count, and `files` holds at most 500 entries with no `content`.
  - `ContextPath = z.string().min(1).max(1024).refine(p => p.toLowerCase().endsWith('.md'))`. Add `ContextFileQuery = z.object({ path: ContextPath })` and `ContextRepoQuery = z.object({ repoId: z.string().uuid() })`.
  - `ContextAttachmentsInput = z.object({ paths: z.array(ContextPath).max(500) }).strict()` with a refine that rejects duplicates. Add `ContextAttachments = z.object({ repo_id: z.string(), paths: z.array(z.string()) })`.
  - Export the inferred types. Do not touch `IndexStatus`.
- **Done when:** both copies contain the identical block; `diff` of the two Project Context sections is empty; both packages typecheck.
- **Verify:** `node scripts/verify.mjs server client --checks`

### 1. Engine: path-labelled project documents in `## Project context`
- **Files:** [`reviewer-core/src/prompt.ts`](reviewer-core/src/prompt.ts) (edit; **not** the `INJECTION_GUARD` constant) · [`reviewer-core/src/review/run.ts`](reviewer-core/src/review/run.ts) (edit, type only) · [`reviewer-core/src/index.ts`](reviewer-core/src/index.ts) (edit, export) · [`reviewer-core/test/prompt.test.ts`](reviewer-core/test/prompt.test.ts) (edit)
- **Track:** shared
- **Layer:** pure engine; no I/O added
- **Skills:** none at write time
- **Do:**
  - Add an exported `ProjectDoc` type `{ path: string; content: string }` and an exported `wrapProjectDoc(path, content)`. It returns `wrapUntrusted('doc:' + safeLabel(path), content)`, where `safeLabel` replaces each of `"`, `<`, `>`, `\r`, `\n` with `_`, so a crafted file or folder name cannot close the opening tag. `wrapUntrusted` itself is unchanged.
  - `PromptParts.specs` and `ReviewInput.specs` become `ReadonlyArray<string | ProjectDoc>`. In `assemblePrompt`, a string entry keeps `wrapUntrusted(\`spec-${i}\`, s)`; a `ProjectDoc` entry uses `wrapProjectDoc`. Blocks are joined with `\n\n` exactly as today. The slot position and heading (`## Project context`, after `## Repo skeleton`) are unchanged.
  - Export `wrapProjectDoc` and `ProjectDoc` from `src/index.ts`.
  - Tests:
    - (a) `specs` omitted, and `specs: []`, both give a user message byte-identical to a call without the key, with `assembly.specs === null` (AC-15).
    - (b) two `ProjectDoc`s render in array order, each as `<untrusted source="doc:<path>">`.
    - (c) a document containing `</untrusted>` is escaped and stays inside its block (NFR-6).
    - (d) a path containing `"><` yields a label with no raw `"`, `<` or `>`.
    - (e) string entries still produce `spec-0` (back-compat).
    - (f) the system message still ends with the unchanged guard text.
- **Done when:** the six cases pass. `server/test/prompt-skills.test.ts` (string specs) still passes unchanged. `git diff reviewer-core/src/prompt.ts` shows no line inside the `INJECTION_GUARD` literal.
- **Verify:** `node scripts/verify.mjs reviewer-core --file reviewer-core/test/prompt.test.ts` · then `node scripts/verify.mjs reviewer-core server --checks`

### 2. Schema + generated migration for attachments
- **Files:** `server/src/db/schema/project-context.ts` (new) · [`server/src/db/schema.ts`](server/src/db/schema.ts) (edit: `export *` + import + two entries in `schema`) · `server/src/db/migrations/NNNN_*.sql` + `meta/*` (new, **generated** by `cd server && pnpm db:generate`)
- **Track:** A
- **Layer:** ring 3 (db)
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`
- **Do:**
  - `agent_context_docs`: `agent_id` uuid FK → `agents.id` on delete cascade; `repo_id` uuid FK → `repos.id` on delete cascade; `path` text not null; `order` integer not null; `created_at` via `now()`. PK `(agent_id, repo_id, path)`; index on `repo_id` (the cascade from `repos` and the used-by query).
  - `skill_context_docs`: the same, with `skill_id` FK → `skills.id` cascade.
  - No `workspace_id` column. This follows the `agent_skills` binding precedent ([agents.ts:65](server/src/db/schema/agents.ts:65)); tenancy is enforced by checking the owner and the repo against the workspace in the service.
- **Done when:** exactly one new migration with only `CREATE TABLE` and `CREATE INDEX` statements plus FKs; no existing migration file changed (`git status server/src/db/migrations` shows only additions).
- **Verify:** `node scripts/verify.mjs server --checks`

### 3. Pure rules: constants and helpers
- **Files:** `server/src/modules/project-context/constants.ts` (new) · `server/src/modules/project-context/helpers.ts` (new) · `server/test/project-context-helpers.test.ts` (new)
- **Track:** A
- **Layer:** ring 2
- **Skills:** `onion-architecture`
- **Do:**
  - Constants: `MAX_CONTEXT_FILES = 500`, `MAX_DOC_BYTES = 64 * 1024`, `CONTEXT_EXCLUDED_DIRS = ['.git', 'node_modules']`, `TRUNCATION_MARKER = '\n\n… [truncated at 64 KB]'`.
  - Helpers:
    - `kindForPath(path)`, per AC-2. A segment equal to `specs` → `specs`; a segment `docs` → `docs`; basename `INSIGHTS.md` or a segment `insights` → `insights`; else `other`. Evaluated in that order.
    - `orderForInjection(agentPaths, skillPathLists)`: agent paths first, then each skill's list in the given order, keeping the first occurrence of each path (AC-11, EC-9).
    - `countUsedBy(pairs: {agentId, path}[])` → `Map<path, number>` of distinct agents (AC-5).
    - `newPaths(requested, persisted)`: the paths that need the listing check (A1).
- **Done when:** the unit test covers every AC-2 branch (including `docs/specs/x.md`, where the first matching rule wins as documented), ordering and dedupe with a duplicate across agent and skill, distinct-agent counting, and `newPaths`.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context-helpers.test.ts`

### 4. Clone reader: listing and capped document read
- **Files:** `server/src/modules/project-context/repository-files.ts` (new) · `server/test/project-context-files.test.ts` (new, filesystem only, hermetic)
- **Track:** A
- **Layer:** ring 3 (filesystem), by the `repository*.ts` filename
- **Skills:** `onion-architecture`
- **Do:**
  - `listMarkdown(clonePath: string | null)` returns `{ cloned: false, total: 0, files: [] }` when the path is null or the root is missing. Otherwise it walks the tree without following symlinks (the [walk.ts:89](server/src/modules/repo-intel/pipeline/walk.ts:89) rule), skips `CONTEXT_EXCLUDED_DIRS`, and keeps files whose lowercase name ends in `.md`. It returns posix relpaths sorted, with `size` and `mtime`, capped at `MAX_CONTEXT_FILES`, and `total` set to the uncapped count.
  - `readDoc(clonePath, relPath)` returns `{ text, truncated } | null`. It uses the guard shape of [repository-plans.ts:32-62](server/src/modules/intent/repository-plans.ts:32): reject absolute paths and `..`; `realpath` both the root and the target and refuse an escape; require a regular file; treat a NUL byte in the first 1 KB as binary → null. It reads the bytes; if they are longer than `MAX_DOC_BYTES`, it decodes the first 64 KB (trimming a split UTF-8 tail) and appends `TRUNCATION_MARKER`. It never throws.
  - Tests on a `mkdtemp` dir:
    - `.git/` and `node_modules/` are excluded;
    - a nested `docs/a.md` is found;
    - sort order;
    - 501 files → 500 listed with `total: 501`;
    - a null clone → `cloned: false`;
    - `readDoc` rejects `../x.md` and an absolute path;
    - a >64 KB file is cut with the marker;
    - a missing file → null.
    - Where the OS allows symlink creation (skip the case if `symlink` throws EPERM on Windows), a symlink to an outside file is neither listed nor readable.
- **Done when:** all listed cases pass on Windows and Linux.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context-files.test.ts`

### 5. Persistence, port, service and container wiring
- **Files:** `server/src/modules/project-context/repository.ts` (new) · `server/src/modules/project-context/types.ts` (new) · `server/src/modules/project-context/service.ts` (new) · [`server/src/platform/container.ts`](server/src/platform/container.ts) (edit)
- **Track:** A
- **Layer:** ring 3 (repository) · port (types) · ring 2 (service) · ring 4 (container, the composition root)
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices` (container is `platform/**`)
- **Do:**
  - Repository (workspace-scoped reads):
    - `getRepo(ws, repoId)` → `{ id, clonePath }`;
    - `agentExists(ws, id)` and `skillExists(ws, id)`;
    - `agentPaths(agentId, repoId)` and `skillPaths(skillId, repoId)`, ordered by `order`;
    - `replaceAgentPaths(agentId, repoId, paths)` and `replaceSkillPaths(...)`: one transaction that selects the owner row `FOR UPDATE`, deletes (owner, repo), then inserts with `order = index` (Rec 4);
    - `pathsForRun(agentId, repoId)` → `{ agentPaths, skills: { skillId, paths }[] }`, with skills ordered by `agent_skills.order` and filtered on `skills.enabled AND agent_skills.enabled`;
    - `usedByPairs(ws, repoId)` → the direct `(agent_id, path)` pairs ∪ the pairs through enabled skill links.
  - `types.ts`: `ProjectContextPort`, with `list`, `file`, `getAgent`, `putAgent`, `getSkill`, `putSkill` and `resolveForRun({ repoId, clonePath, agentId })`. `resolveForRun` returns `{ docs: { path, content }[]; skipped: string[]; truncated: string[]; tokens: number }`. Add a `ProjectContextDeps` type for the injected `repo`, `listMarkdown`, `readDoc` and `countTokens`.
  - Service `ProjectContextService implements ProjectContextPort`:
    - `list` → `ContextFileList`. It fills `kind` via `kindForPath`, `used_by` via `countUsedBy` and `tokens` via `countTokens(wrapProjectDoc(path, cappedText))`, using `wrapProjectDoc` from `@devdigest/reviewer-core`. It reads each listed file once through `readDoc`, a local disk read with no LLM (NFR-2), and never returns `content`.
    - `file` → `SpecFile` with `content` = the capped text. It 422s (`ValidationError`, `details: { field: 'path' }`) when the path is not in the listing.
    - `get*` / `put*` → `ContextAttachments`. They 404 (`NotFoundError`) for an unknown or foreign owner or repo. `put*` checks only `newPaths` against the current listing (A1), 422s naming `paths` on a miss and persists nothing.
    - `resolveForRun` reads each path in `orderForInjection` order once, at call time. `null` goes to `skipped`; a capped document goes to `truncated`. `tokens` is the sum of the wrapped blocks. It returns an empty result when `clonePath` is null.
  - Container: add `projectContext?: ProjectContextPort` to `ContainerOverrides` and a lazy `get projectContext()` that builds the service with `new ProjectContextRepository(this.db)`, `listMarkdown`, `readDoc` and `countTokens: (s) => this.tokenizer.count(s)`. This mirrors the `intent` getter.
- **Done when:** lint + typecheck + arch are green; `pnpm arch` reports no `no-cross-module-reach-in` edge; the service file imports nothing from `drizzle-orm`, `node:fs` or `**/adapters/**`.
- **Verify:** `node scripts/verify.mjs server --checks`

### 6. Routes + registration + route-level integration test
- **Files:** `server/src/modules/project-context/routes.ts` (new) · [`server/src/modules/index.ts`](server/src/modules/index.ts) (edit: one import, one `projectContext` entry) · `server/test/project-context.it.test.ts` (new)
- **Track:** A
- **Layer:** ring 4
- **Skills:** `onion-architecture`, `fastify-best-practices`
- **Do:**
  - Routes, each declaring `params` / `querystring` / `body` / `response: { 200: … }` from step 0 and `IdParams` from `modules/_shared/schemas.ts`, and each calling `container.projectContext.*` after `getContext`:
    - `GET /repos/:id/context` → `ContextFileList`
    - `GET /repos/:id/context/file?path=` → `SpecFile`
    - `GET|PUT /agents/:id/context?repoId=` → `ContextAttachments`
    - `GET|PUT /skills/:id/context?repoId=` → `ContextAttachments`
  - The integration test uses `startPg` + `seed`, a `mkdtemp` clone with `specs/a.md`, `docs/b.md`, `INSIGHTS.md` and `node_modules/x.md`, and a repo row pointing at it. The `d = hasDocker ? describe : describe.skip` precedent is at [conventions.it.test.ts:26](server/test/conventions.it.test.ts:26). It asserts:
    - AC-1 (paths, sort, exclusions) and AC-2 kinds on the wire;
    - EC-1 (repo with `clonePath: null` → `cloned: false`);
    - EC-3 (501 files → 500 + `total: 501`);
    - AC-7 / AC-8 (PUT then GET returns the same order);
    - EC-8 (`../x.md`, `a.txt` and an unlisted `z.md` each 422, and a follow-up GET is unchanged);
    - A1 (delete an attached file, then a PUT that keeps it and adds another listed file → 200);
    - EC-12 (two concurrent PUTs `[a]` and `[]` via `Promise.all` → 200s, and the final row set equals one of the two bodies with no duplicate rows);
    - AC-5 (`used_by` counts direct plus enabled-skill agents once each, and a disabled skill link does not count);
    - 404 for a random uuid owner or repo;
    - NFR-1 (list entries have no `content`);
    - NFR-2 (the injected `MockLLMProvider.calls` stays empty after list, file and PUT).
- **Done when:** the file passes under Docker; the hermetic lane is unaffected.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context.it.test.ts` (self-skips without Docker; the real run is in step 14's `--it`)

### 7. Run-time injection in the executor
- **Files:** [`server/src/modules/reviews/run-executor.ts`](server/src/modules/reviews/run-executor.ts) (edit) · `server/test/project-context.it.test.ts` (edit: add a run `describe`)
- **Track:** A
- **Layer:** ring 2
- **Skills:** `onion-architecture`
- **Do:**
  - In `runOneAgent`, after `buildSkillBlocks` ([:225](server/src/modules/reviews/run-executor.ts:225)) and before `reviewPullRequest` ([:231](server/src/modules/reviews/run-executor.ts:231)), call a private `buildProjectDocs(repo, agent.id, runLog)`. It calls `this.container.projectContext.resolveForRun({ repoId: pull.repoId, clonePath: repo.clonePath, agentId })` once, wrapped in `.catch` → empty (the enrichment idiom, so it can never fail the run).
  - Log one `info` line per skipped path (EC-4) and per truncated path (EC-5), plus the one summary line: `project context: N document(s) (T tokens); skipped: …; truncated: …` (NFR-8).
  - Pass `specs: docs` only when `docs.length > 0` (AC-15). Set `specs_read: docs.map(d => d.path)` at [:342](server/src/modules/reviews/run-executor.ts:342) (AC-13). The failure-path trace at `:539` keeps `[]`.
  - Integration run cases use `MockLLMProvider` for `openai` and `openrouter`, and stub `intent` via `ContainerOverrides` (`ensure` → `null`), per [server/INSIGHTS.md:75](server/INSIGHTS.md:75). Cases:
    - AC-11 / EC-9: an agent with `[b]`, a linked enabled skill with `[a, b]` and a disabled-link skill with `[c]` → `specs_read = [b, a]`, and `prompt_assembly.specs` contains `<untrusted source="doc:docs/b.md">` before `doc:specs/a.md` and no `c`.
    - AC-12: the full text is inside the block.
    - EC-4: a deleted attached file → absent from `specs_read`, its path appears in `trace.log`, and the run is `done`.
    - EC-5: a 70 KB file → the block ends with the marker and the log names it.
    - EC-6: attachments for repo B with a PR in repo A → `specs` null and `specs_read` `[]`.
    - AC-15: no attachments → `prompt_assembly.specs` null.
    - NFR-5: `agent.repoIntel = false` → docs still injected.
    - NFR-9: patch `container.projectContext` with `Object.create` (the [server/INSIGHTS.md:17-25](server/INSIGHTS.md:17) technique) to count `resolveForRun` calls → exactly 1 per agent run in a map-reduce run over two files.
- **Done when:** all run cases pass under Docker; `prompt_tokens.specs > 0` when docs were injected.
- **Verify:** `node scripts/verify.mjs server --file server/test/project-context.it.test.ts` · `node scripts/verify.mjs server --checks`

### 8. Client data layer + the `context` namespace
- **Files:** `client/src/lib/hooks/project-context.ts` (new) · [`client/src/lib/hooks/core.ts`](client/src/lib/hooks/core.ts) (edit: remove the zero-caller `useContextFiles` at `:123-129`, and drop the now-unused `SpecFile` import; leave `useReindexContext` untouched) · [`client/messages/en/context.json`](client/messages/en/context.json) (edit: replace the unused keys with this feature's copy)
- **Track:** B
- **Layer:** `src/lib/hooks` (API layer), not re-exported from the `hooks/index.ts` barrel (import the domain file directly, [client/INSIGHTS.md:145-151](client/INSIGHTS.md:145))
- **Skills:** `frontend-ui-architecture`, `react-best-practices`
- **Do:**
  - Exported key builders: `contextFilesKey(repoId) = ["context", repoId]`, `contextFileKey(repoId, path)`, `agentContextKey(agentId, repoId)` and `skillContextKey(skillId, repoId)`.
  - Hooks over `api`: `useContextFiles(repoId)` → `ContextFileList`; `useContextFile(repoId, path)` (enabled when `path`); `useAgentContext`, `useSkillContext` (enabled when `repoId`).
  - `useSetAgentContext(agentId, repoId)` and `useSetSkillContext(...)`: `useMutation` with `scope: { id: \`context:agent:${agentId}:${repoId}\` }` so PUTs run serially (EC-12). `onMutate` writes the new `paths` into the cache (optimistic; AC-7 count and AC-9 estimate update with no round trip), `onError` restores the snapshot, and `onSettled` invalidates the owner key and `contextFilesKey(repoId)` (so `used_by` refreshes).
  - `context.json` keys cover:
    - page title, refresh, "showing {shown} of {total}", "{count} files";
    - "Used by {count, plural, …} agents";
    - empty states for not cloned (EC-1) and no `.md` files naming the type (EC-2);
    - load errors (list / preview; no `retry` key, per [client/INSIGHTS.md:273](client/INSIGHTS.md:273));
    - picker title, "{attached} of {total} attached", filter placeholder, "no documents match", order hint, "≈ {tokens} tokens", the untrusted-injection note, Preview, missing badge, and the drag-handle label with `{path}`;
    - the kind labels `specs` / `docs` / `insights` / `other`;
    - skill tab: "Any agent using this skill inherits these documents." and "SERIALIZES AS".
- **Done when:** client typecheck is green and no file other than this one exports `useContextFiles`.
- **Verify:** `node scripts/verify.mjs client --checks`

### 9. Shared picker component (used by both editors)
- **Files:** `client/src/components/context-docs-picker/ContextDocsPicker.tsx` (new) · `…/DocPreviewModal.tsx` (new) · `…/helpers.ts` (new) · `…/styles.ts` (new) · `…/index.ts` (new) · `…/ContextDocsPicker.test.tsx` (new) · `…/helpers.test.ts` (new)
- **Track:** B
- **Layer:** `src/components/` (promoted: two routes, `/agents/[id]` and `/skills/[id]`, consume it). It may import `src/lib` and `@devdigest/ui`, and never `src/app`.
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (`"use client"`), `react-testing-library`
- **Do:**
  - Props: `{ repoId, list: ContextFileList | undefined, listState, attached: string[], onChange(paths: string[]), footer?: ReactNode }`. It holds no mutation; the tabs own the hooks.
  - Helpers (pure):
    - `mergeDocRows(files, attached)`: attached first in order, including attached paths absent from `files` as `missing: true` (EC-7); then unattached rows by path.
    - `filterDocs(rows, q)`: a path substring match; never changes the order.
    - `moveRow`: a local copy of the SkillsTab helper. Do not import across features.
    - `estimateTokens(rows)`: the sum of `tokens` over attached, non-missing rows (AC-9, EC-7).
  - Rows:
    - drag handle (a `<button>` with an ArrowUp/ArrowDown reorder that is active only on attached rows, NFR-4, following [SkillsTab.tsx:103-117](client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:103));
    - `Checkbox` with `label` = the mono path. The `<label>` wrapper gives the checkbox button its accessible name, which contains the path (NFR-4);
    - a kind `Badge` with text;
    - a "missing" badge where it applies;
    - a Preview button that opens `DocPreviewModal`. The modal uses `useContextFile` and renders `<Markdown>` with the path as heading, and shows `ErrorState` with `onRetry` on failure (EC-10).
  - Header: `"{n} of {m} attached"`, where n counts attached rows and m the listed files. It is unchanged by the filter (EC-11). The filter `TextInput` and a "no documents match" line when the filter empties the list.
  - Footer: `"≈ N tokens"` only while at least one row is attached.
  - Empty states: not cloned (EC-1), with no checkboxes rendered; no `.md` files (EC-2).
  - Tests (fireEvent; `@testing-library/user-event` is not installed, [client/INSIGHTS.md:226](client/INSIGHTS.md:226)):
    - AC-6 rows and controls;
    - checking calls `onChange` with the path appended;
    - ArrowDown on an attached handle calls `onChange` with the swapped order;
    - the token sum changes on check with no fetch (AC-9);
    - a missing row is shown, uncheckable and excluded from the sum (EC-7);
    - a filter with no match shows the line and the count is unchanged (EC-11);
    - EC-1 / EC-2 empty states;
    - `getByRole('checkbox', { name: /specs\/a\.md/ })` resolves (NFR-4);
    - kind badge text present;
    - Preview opens the rendered doc, and a preview error shows the retry (EC-10).
- **Done when:** both test files pass.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/context-docs-picker/ContextDocsPicker.test.tsx` · `node scripts/verify.mjs client --file client/src/components/context-docs-picker/helpers.test.ts`

### 10. Agent editor Context tab
- **Files:** `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx` (new) · `…/ContextTab/index.ts` (new) · `…/ContextTab/ContextTab.test.tsx` (new) · [`…/AgentEditor/constants.ts`](client/src/app/agents/[id]/_components/AgentEditor/constants.ts) (edit: add `{ key: "context", labelKey: "editor.tabs.context", icon: "FileText" }`) · [`…/AgentEditor/AgentEditor.tsx`](client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx) (edit: render `ContextTab` for `tab === "context"`) · [`client/src/app/agents/[id]/page.tsx`](client/src/app/agents/[id]/page.tsx) (edit: `VALID_TABS` at `:15` gains `"context"`) · [`client/messages/en/agents.json`](client/messages/en/agents.json) (edit: `editor.tabs.context` = "Context")
- **Track:** B
- **Layer:** feature-local `_components`
- **Skills:** loaded already
- **Do:** `ContextTab({ agentId })` reads `useActiveRepo().repoId`, `useContextFiles(repoId)`, `useAgentContext(agentId, repoId)` and `useSetAgentContext`. It renders `ContextDocsPicker` with `onChange={(paths) => set.mutate({ paths })}` and the untrusted-injection note in the footer. With no active repo, it shows the not-cloned-style empty state.
- **Done when:** the test (hooks mocked with `vi.mock("@/lib/hooks/project-context", …)`) shows that checking a row calls the mutation with `{ paths: [...] }` (AC-7), and the tab label renders in `AgentEditor.test.tsx` without edits to that test.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx"`

### 11. Skill editor Context tab
- **Files:** `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx` (new) · `…/ContextTab/index.ts` (new) · `…/ContextTab/ContextTab.test.tsx` (new) · [`…/SkillEditor/constants.ts`](client/src/app/skills/[id]/_components/SkillEditor/constants.ts) (edit: `VALID_TABS` and `TABS` gain `context`) · [`…/SkillEditor/SkillEditor.tsx`](client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx) (edit) · [`client/messages/en/skills.json`](client/messages/en/skills.json) (edit: `editor.tabs.context`, under the `editor.tabs` block at `:38`)
- **Track:** B
- **Layer:** feature-local `_components`
- **Skills:** loaded already
- **Do:** the same wiring over `useSkillContext` / `useSetSkillContext`. Above the picker, add the inherit note from `context.json`. Below it, a SERIALIZES AS box that lists the attached paths in order, one per line, in mono, with no heading (Q-6 draft).
- **Done when:** the test asserts the inherit sentence (AC-10), the SERIALIZES AS box with paths in attached order, and that toggling calls the skill mutation.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx"`

### 12. Project Context page + sidebar entry
- **Files:** `client/src/app/repos/[repoId]/context/page.tsx` (new, thin `"use client"` entry like [conventions/page.tsx](client/src/app/repos/[repoId]/conventions/page.tsx)) · `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx` (new) · `…/ProjectContextView/{styles.ts,helpers.ts,index.ts}` (new) · `…/ProjectContextView/ProjectContextView.test.tsx` (new) · [`client/src/vendor/ui/nav.ts`](client/src/vendor/ui/nav.ts) (edit, app-owned exception: WORKSPACE gains `{ key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context" }` after `pulls`) · `client/src/components/app-shell/nav.test.ts` (new)
- **Track:** B
- **Layer:** route segment + feature-local view
- **Skills:** loaded already
- **Do:**
  - The view is inside `AppShell` and uses `RepoNotFound` / `useRepoNotFound` like `ConventionsView`.
  - Left column: the file list (path, kind badge), the Refresh button (AC-16: `refetch` of `useContextFiles`), "showing 500 of N" when `total > files.length` (EC-3), and a footer "{count} files" (Q-4 draft).
  - Right pane: the selected path as heading, "Used by N agents" (AC-5) and `<Markdown>` content from `useContextFile` (AC-3).
  - No Edit toggle, no new/folder/upload icons and no coverage ring (non-goals).
  - EC-1 / EC-2 empty states; `ErrorState` with `onRetry` for list and preview failures (EC-10).
  - `nav.test.ts` asserts that the WORKSPACE group contains `context` right after `pulls`, with href `/repos/:repoId/context`, and that `activeKeyFor("/repos/x/context") === "context"` (AC-4).
- **Done when:** the view test covers AC-3 (select → heading + rendered Markdown), AC-5 text, AC-16 (Refresh calls `refetch`), EC-1, EC-2, EC-3 and EC-10; `nav.test.ts` passes.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx"` · `node scripts/verify.mjs client --file client/src/components/app-shell/nav.test.ts`

### 13. Trace label for the slot
- **Files:** [`client/messages/en/runs.json`](client/messages/en/runs.json) (edit `trace.prompt.specs` at `:50` → "Project context — attached specs (untrusted)") · [`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx) (edit)
- **Track:** B
- **Layer:** messages + test only; `TraceBody.tsx` and `PromptBlock.tsx` are not edited
- **Skills:** loaded already
- **Do:** add cases:
  - a trace with `prompt_assembly.specs` set shows the new label; expanding shows the full text; the copy button calls `navigator.clipboard.writeText` with exactly that text (AC-14);
  - a trace with `specs: null` and `specs_read: []` renders without the row (AC-15, NFR-7: a pre-feature trace still renders);
  - `specs_read` paths render in order in the Specs read row (AC-13 display).
- **Done when:** the updated test file passes.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.test.tsx"`

### 14. Integration (track shared)
- **Files:** none new. A failure found here is fixed in the owning track's files and re-verified.
- **Do:**
  - Run the full checks in every touched package, plus the integration lane with Docker up.
  - Confirm the step-0 mirror has not drifted: the `// ---- Project Context ----` blocks of the two `platform.ts` copies are identical.
  - Confirm `git diff --stat` touches no lock-file, no applied migration and not `reviewer-core/src/grounding.ts`.
- **Done when:** all commands below are green. End to end: a run on a PR whose agent has attachments shows the documents under "Project context — attached specs (untrusted)" and their paths in Specs read (proved by step 7's integration assertions plus step 13's rendering test).
- **Verify:** `node scripts/verify.mjs reviewer-core server client` · `node scripts/verify.mjs server --it`

## Test plan
| Package | Command | Covers |
|---|---|---|
| reviewer-core | `node scripts/verify.mjs reviewer-core` | AC-12 labels, AC-15 byte-identity, NFR-6 escape + label sanitising, guard unchanged |
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic: AC-2, AC-11/EC-9 ordering, AC-5 counting, reader guards, EC-5 cap (`project-context-helpers.test.ts`, `project-context-files.test.ts`) |
| server | `node scripts/verify.mjs server --it` | `project-context.it.test.ts`: AC-1, AC-5, AC-7, AC-8, AC-11, AC-12, AC-13, AC-15, EC-1, EC-3, EC-4, EC-5, EC-6, EC-8, EC-9, EC-12, NFR-1, NFR-2, NFR-5, NFR-8, NFR-9, A1 |
| client | `node scripts/verify.mjs client` | lint · typecheck · AC-3, AC-4 (unit, A3), AC-5 display, AC-6, AC-7, AC-9, AC-10, AC-13 display, AC-14, AC-16, EC-1, EC-2, EC-3 message, EC-7, EC-10, EC-11, NFR-4, NFR-7 |
| static | review of `messages/en/*.json` usage + step-0 mirror diff | NFR-3, NFR-7 |

## Risks & rollback
- **Listing cost.** `GET /repos/:id/context` reads and tokenises up to 500 files × 64 KB to fill `tokens`. On a docs-heavy clone that is a slow request, and it shows up as a slow page and tab load. Mitigation, if measured slow: memoise per `(realpath, mtimeMs, size)` inside the service. That is a follow-up, not in this plan · rollback: revert step 5's `tokens` fill (the field is nullish, and the client then shows no estimate).
- **Engine type widening.** `specs` now accepts objects. A CI-runner caller that passes strings is unaffected by design, and step 1's test (e) pins that · rollback: revert step 1; the server then passes nothing (step 7 reverted with it).
- **Serialisation.** `FOR UPDATE` on the agent or skill row briefly blocks a concurrent agent edit. That is harmless at studio scale · rollback: drop the lock; the client-side mutation `scope` still serialises one tab's writes.
- **Migration.** Two new tables only · rollback: generate a follow-up drop migration with `pnpm db:generate`, never by deleting the applied one.
- **`.it` verify self-skips without Docker.** Steps 6 and 7 read green on a machine without Docker. Step 14's `--it` run with Docker up is the real gate for those criteria.
- **Two server test files in one package track.** They share one `typecheck` but only track A edits server files, so this is not a cross-track hazard.

## Out of scope
- Editing, creating, uploading or moving clone files; the coverage ring; chunking/embeddings and `getSpecChunks`; "Skills loaded" chips; the PR-head version of documents; the CI runner and MCP tools (spec Non-goals, Q-1 to Q-5, Q-9).
- Hoisting `readRepoFile` into `modules/_shared/` (Rec 5); the listing memo (Risks); an `e2e/specs/14-project-context.flow.json` browser flow (A3). All are follow-ups.
- `useReindexContext` in `client/src/lib/hooks/core.ts` (calls a non-existent route; untouched).
- Module README / `server/README.md` API map. Pass `--docs` to `/run-plan` for `doc-writer`.
- No track edits a file owned by another track, and neither A nor B edits the step-0 files.
- Writing or amending the spec. A gap in it goes back to `spec-creator` or to the person who owns the decision, as an Open question.
- Architectural review and security review. Separate agents own those.
- Opening or pushing a PR. `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking:** A1: may a PUT keep an already-attached path that has gone missing (EC-7) while EC-8 rejects unlisted paths? Default taken: yes, the listing check applies only to newly added paths. Author decides.
- **Non-blocking:** A2: the sidebar label is a literal in `nav.ts` like every other entry, not a `messages/en` string. Default taken: follow the registry pattern. Author decides.
- **Non-blocking:** A3: AC-4's `verify: e2e` lane sits in a package outside the spec's Packages line. Default taken: a client unit test now, and the browser flow as a follow-up. Author decides.
- **Non-blocking:** A4: does "Used by N agents" include agents with `enabled = false`? Default taken: yes. Author decides.
- **Non-blocking:** Q-1 to Q-12 of the spec are planned against their stated drafts, as instructed. They are not re-asked.
