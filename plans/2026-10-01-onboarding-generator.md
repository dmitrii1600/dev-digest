# Implementation Plan: Onboarding Generator — a five-part tour of an unfamiliar repository

**Plan ID:** 2026-10-01-onboarding-generator  ·  **Spec:** [specs/2026-10-01-onboarding-generator.md](specs/2026-10-01-onboarding-generator.md) (Status: approved, Q-1 to Q-15 resolved; AC-16 as amended on 2026-10-01, see D1)  ·
**Execution mode:** multi-agent (step 0 shared → tracks A server ∥ B client → Integration)  ·  **Packages:** server, client (+ one e2e flow in Integration)  ·
**Decisions:** D1–D4, decided by the user on 2026-10-01 (see *Requirements review → Decisions*): D1 path grounding = "the prompt carried it"; D2 tour page at `/repos/:repoId/tour`; D3 in-memory per-repo lock; D4 `maxRetries: 0` plus a 120 s service timer.
**Assumptions:** A5–A8 under *Requirements review → Assumptions*. These are the author's call, with defaults taken.

## Summary
Build a new server module `modules/onboarding/` with `GET /repos/:id/onboarding` (the stored tour, plus `generating` and `stale` flags) and `POST /repos/:id/onboarding/generate` (one structured LLM call, then a code-side grounding gate, then a replace of the one stored row). Code picks the reading-path and critical-path files from the repo-intel facade, ordered by rank and then by path. The model only writes prose, an optional diagram, a reason per listed file, run commands and first tasks. Every path the model returns is checked against the set of files the prompt carried (AC-16 as amended). The existing `onboarding` table is reused as it is, so there is no migration, and the loose `Onboarding` contract is reshaped and mirrored to the client. The client gets an Onboarding Tour page at **`/repos/:repoId/tour`**. It has a five-section accordion, an "On this page" list, Regenerate, Share link, copyable commands and GitHub Open links, plus a sidebar entry. `/onboarding` stays the Add repository screen. Two small read-side fixes in repo-intel make AC-6, AC-8 and NFR-2 deterministic: a path tiebreak, and `rank` on `FileRankRow`. They do not touch ranking or indexing.

## Requirements review

**What I understood:** for the active repo, one click builds and stores a five-section tour. Code picks the files from the index and the model writes only the prose around them. The page renders the tour with copy, Open and Share actions and shows generation, error and stale states.
**Inputs read:** specs/2026-10-01-onboarding-generator.md · specs/designs/onboarding-tour/01, 05, 06 (viewed) · AGENTS.md, server/AGENTS.md, client/AGENTS.md · INSIGHTS.md, server/INSIGHTS.md, client/INSIGHTS.md · .claude/skills/pr-self-review/routing.md · server/src/modules/repo-intel/README.md · server/src/modules/conventions/README.md · plans/2026-09-29-project-context.md (format) · the user's decisions on A1–A4, relayed by the coordinator on 2026-10-01.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "sidebar shall show an "Onboarding Tour" entry in the WORKSPACE group, between Pull Requests and Project Context" · verify: e2e | §AC-1 | contradicts tree: `activeKeyFor` maps **any** path containing `/onboarding` (including the Add repository screen) to `onboarding-tour` ([client/src/components/app-shell/helpers.ts:29](client/src/components/app-shell/helpers.ts:29)), and `nav.test.ts` pins `context` right after `pulls` ([client/src/components/app-shell/nav.test.ts:9](client/src/components/app-shell/nav.test.ts:9)). Resolved by D2 in step 7 |
| R2 | "title "Onboarding for <repo name>", a subtitle with the number of files indexed … and the time since … five sections in this order, all expanded on every visit" | §AC-2 | clear |
| R3 | "activates a section header … expand or collapse that section and leave the other sections" | §AC-3 | clear |
| R4 | "activates an entry in the "On this page" list … expand that section and scroll it into view" | §AC-4 | clear |
| R5 | "exactly one LLM call to the model chosen for "Onboarding Tour" … replace the repo's stored tour … recording the provider and model" | §AC-5 | contradicts tree: `completeStructured` reprompts up to 2 times by default ([server/src/adapters/llm/openai.ts:90](server/src/adapters/llm/openai.ts:90), [reviewer-core/src/llm/openrouter.ts:61](reviewer-core/src/llm/openrouter.ts:61)). Resolved by D4 |
| R6 | "at most 8 indexed source files, excluding tests, configs, declaration files and migrations, in descending index rank, with equal ranks ordered by path ascending" | §AC-6 | contradicts tree: no tiebreak in `getRankedPaths` ([server/src/modules/repo-intel/repository.ts:457](server/src/modules/repo-intel/repository.ts:457)), and the 10× over-fetch `LIMIT` makes the cut-off set unstable on ties too. Rec 1 |
| R7 | "take which files appear … and their order, from the index alone … use only the one-line reason" | §AC-7 | clear |
| R8 | "at most 6 distinct files that lie on the index's dependency chains … in descending rank … path, reason, Open" | §AC-8 | contradicts tree: chains come back as paths only, with no rank ([server/src/modules/repo-intel/types.ts:165-171](server/src/modules/repo-intel/types.ts:165)). `getFileRank` returns only `percentile` ([types.ts:119-122](server/src/modules/repo-intel/types.ts:119)). The chain step picks the next hop with no tiebreak ([service.ts:689](server/src/modules/repo-intel/service.ts:689)). Rec 1 |
| R9 | "model's prose rendered as Markdown and, when the model returned a diagram that parses, that diagram rendered as a graph" | §AC-9 | clear (`MermaidDiagram` validates and renders nothing on invalid input, [client/src/components/mermaid-diagram/MermaidDiagram.tsx:7-22](client/src/components/mermaid-diagram/MermaidDiagram.tsx:7)) |
| R10 | "at most 10 commands as a numbered list, each with a copy action" | §AC-10 | clear |
| R11 | "put exactly the displayed command line on the clipboard and show a confirmation" | §AC-11 | clear |
| R12 | "1 to 5 starter tasks. Each task shall be one line with at least one link to a file" | §AC-12 | ambiguous: the task shape and the link target are undefined (DR-6). See A5 |
| R13 | "open that file on GitHub, at the repo's default branch, in a new tab" | §AC-13 | clear. The helper is in another route segment ([client/src/app/repos/[repoId]/pulls/[number]/github-urls.ts:24-37](client/src/app/repos/[repoId]/pulls/[number]/github-urls.ts:24)), so it gets a feature-local equivalent. Rec 5 |
| R14 | "copy the Onboarding Tour page's studio URL to the clipboard and show a confirmation" | §AC-14 | clear: the URL is `<origin>/repos/<repoId>/tour` (D2) |
| R15 | "WHILE a generation is running … disable Regenerate, show that generation is in progress, and keep showing the previously stored tour" | §AC-15 | clear |
| R16 | AC-16 **as amended 2026-10-01**: a model-returned file path, link or command is kept only if its source path is a file the prompt carried; everything else is removed before storing | §AC-16 (amended) | clear (D1). The pre-amendment text required index membership too, which contradicted [server/src/modules/repo-intel/pipeline/walk.ts:7](server/src/modules/repo-intel/pipeline/walk.ts:7), since the index holds JS/TS sources only |
| R17 | "subtitle shall show "AI-generated · <provider>/<model>" … recorded with that tour … shall not change when the Settings choice changes" | §AC-17 | clear |
| R18 | "no stored tour … empty state that names the five sections and offers Generate" | §EC-1 | clear (the current copy names other sections, [client/messages/en/onboarding.json:10](client/messages/en/onboarding.json:10), so it is rewritten) |
| R19 | "no clone … 422 `repo_not_cloned`" | §EC-2 | clear |
| R20 | "no ranked files … or repo-intel is switched off … 422 `repo_not_indexed` and make no LLM call … name the reason" | §EC-3 | clear (reason from flag + index state, server/INSIGHTS.md:235-241) |
| R21 | "fails, does not finish within 120 seconds, or returns output that does not match … store nothing, keep the previous tour … Retry" | §EC-4 | contradicts tree: `OpenRouterProvider` ignores `req.timeoutMs` and uses a 90 s client timeout ([reviewer-core/src/llm/openrouter.ts:54](reviewer-core/src/llm/openrouter.ts:54)). Resolved by D4 (service timer) |
| R22 | "no API key … make no LLM call, and the page shall name the provider and link to Settings → API Keys" | §EC-5 | ambiguous: no error code is named; `container.llm` throws a 500 `ConfigError` ([server/src/platform/container.ts:252](server/src/platform/container.ts:252)). See A6 |
| R23 | "while another generation for the same repo is running … 409 `generation_running` and start no second LLM call" | §EC-6 | clear (D3) |
| R24 | "no diagram or a diagram that does not parse … prose alone, with no empty diagram area" | §EC-7 | clear |
| R25 | "section has no items after the path check … stay in the list and show a one-line message" | §EC-8 | clear |
| R26 | "index was rebuilt at a different commit … notice beside Regenerate" | §EC-9 | clear (`IndexState.lastIndexedSha`, [types.ts:43](server/src/modules/repo-intel/types.ts:43)) |
| R27 | "clipboard is unavailable or permission is denied … failure message and the text shall remain selectable" | §EC-10 | clear |
| R28 | "path or a reason is longer than its row … wrap without horizontal scrolling … actions stay visible" | §EC-11 | clear (`Badge` is nowrap and must not hold LLM text, client/INSIGHTS.md:60-67) |
| R29 | "user leaves the page while a generation runs … finish the generation … show the new tour on the next visit" | §EC-12 | clear |
| R30 | "a generation makes exactly one LLM call. Opening the page, toggling … make none" | §NFR-1 | clear (D4) |
| R31 | "two generations on the same index produce the same reading-path and critical-path files in the same order" | §NFR-2 | contradicts tree, same evidence as R6/R8. Rec 1 |
| R32 | "model input is at most 60,000 tokens … lowest-ranked excerpts are dropped first … stored tour is at most 256 KB … reason or task at most 200 characters" | §NFR-3 | clear |
| R33 | "stored tour stays viewable when the repo later becomes unindexed, repo-intel is switched off, or the provider key is removed" | §NFR-4 | clear |
| R34 | "clone content reaches the prompt only wrapped as untrusted, and `INJECTION_GUARD` is unchanged. `.env` files other than … are never read" | §NFR-5 | clear |
| R35 | "every new user-facing string comes from `messages/en/<namespace>.json`, and the empty-state copy names the five designed sections" | §NFR-6 | ambiguous: sidebar labels are literals in the app-owned `nav.ts` ([client/src/vendor/ui/nav.ts:24-25](client/src/vendor/ui/nav.ts:24)). The command palette already reads `shell.json` `nav.onboarding-tour` ([client/messages/en/shell.json:19](client/messages/en/shell.json:19)). Same default as the project-context plan's A2 |
| R36 | "section header is a button whose accessible name is the section title and which exposes its expanded state … copy action's accessible name contains its command" | §NFR-7 | clear (client/INSIGHTS.md:69-73) |
| R37 | "at most one generation runs per repo. A generation still running after 10 minutes counts as failed" | §NFR-8 | clear (D3) |
| R38 | "logs one line with the repo id, provider and model, input and output tokens, cost (unknown stays null, never 0), duration, and the number of items removed per section" | §NFR-9 | clear |
| R39 | "contract change is mirrored … the Add repository screen at `/onboarding` and its browser flow keep working" · verify: e2e | §NFR-10 | clear ([e2e/specs/06-onboarding.flow.json](e2e/specs/06-onboarding.flow.json); D2 keeps `/onboarding` untouched) |
| R40 | "each repo keeps one stored tour. Regenerate replaces it, and deleting the repo deletes it" | §NFR-11 | clear (PK `repo_id` + cascade, [server/src/db/schema/context.ts:120-126](server/src/db/schema/context.ts:120)) |
| R41 | File contents → prompt: "wrapped as untrusted; secret `.env` files never read; 60,000-token cap" | §Untrusted inputs | clear |
| R42 | Prose, reasons, tasks: "only through the existing Markdown renderer; reason and task at most 200 characters" → "truncated with an ellipsis" | §Untrusted inputs | clear (`Markdown` has no rehype-raw, [client/src/vendor/ui/primitives/Markdown.tsx:1-6](client/src/vendor/ui/primitives/Markdown.tsx:1)) |
| R43 | File paths and links: must be a file the prompt carried (per amended AC-16) → "removed before storing … counted in the log line" | §Untrusted inputs (+ AC-16 amended) | clear (D1) |
| R44 | Run commands: "one line, at most 300 characters, citing its source file; rendered as plain text; never executes it" | §Untrusted inputs | clear |
| R45 | Diagram: "Parsed with strict security before rendering; at most 4,000 characters" → "omitted" | §Untrusted inputs | clear (`securityLevel: "strict"`, [MermaidDiagram.tsx:34](client/src/components/mermaid-diagram/MermaidDiagram.tsx:34)) |
| R46 | Repo `:id`: "resolves to a repo in the caller's workspace" → "404" | §Untrusted inputs | clear |
| R47 | Generate body: "strict, empty object" → "422 naming the field" | §Untrusted inputs | clear (a body is required on this stack; send `{}`, server/INSIGHTS.md:289-294) |

### Decisions (decided by the user, 2026-10-01)
- **D1 (was A1; R16/R43): what "grounded" means for a path.** The prompt carries a set **G** of paths: the 8 reading-path files and the ≤6 critical-path files, which come from the index, plus every run-source file and excerpt that was actually read from the clone at generation time. A model-returned path or command `source_path` survives only if it is **in G**. Because G ⊆ (index ∪ files read from the clone), nothing outside the repo survives. A `package.json`- or `README.md`-sourced command is kept. `spec-creator` is rewriting AC-16 in the spec to say exactly this. The plan cites **AC-16 as amended**.
- **D2 (was A2; R1/R14): the tour page lives at `/repos/:repoId/tour`** (`client/src/app/repos/[repoId]/tour/…`).
  - Only `/repos/<id>/tour` activates the `onboarding-tour` sidebar key.
  - `/onboarding` stays the Add repository screen and activates no sidebar entry.
  - Share link copies `window.location.origin + "/repos/<id>/tour"`.
  - The server API routes stay `GET /repos/:id/onboarding` and `POST /repos/:id/onboarding/generate`, as in the spec's module-interaction table.
- **D3 (was A3; R23/R37): the generation lock is an in-process `Map<repoId, startedAtMs>` in `OnboardingService`.**
  - The API is single-instance by design ([server/src/app.ts:78](server/src/app.ts:78)), and [server/src/modules/blast/service.ts:57](server/src/modules/blast/service.ts:57) already keeps per-repo state the same way.
  - An entry older than 10 minutes is ignored (NFR-8). There is no migration.
  - `GET` reports `generating` from the same map, which gives AC-15 and EC-12 after a page revisit.
- **D4 (was A4; R5/R21/R30): "exactly one LLM call"** means one `completeStructured` call with `maxRetries: 0`, so there is no reprompt on a schema mismatch (EC-4). The service enforces 120 s with its own timer. Transport-level retries inside a provider SDK (OpenRouter client `maxRetries: 2`, [reviewer-core/src/llm/openrouter.ts:55](reviewer-core/src/llm/openrouter.ts:55)) are not changed. They are logged as a follow-up under *Out of scope*.

### Assumptions (non-blocking, author's call, default taken)
- **A5 (R12): First tasks shape** is `{ text, paths[] }`. `text` is one line of ≤200 chars. `paths` keeps at least one path from G after grounding (D1); a task left with zero paths is removed. Each path renders as a link to the file on GitHub at the default branch, the same target as Open.
- **A6 (R22): error codes** the client branches on, besides the spec's three:
  - `provider_key_missing` (422, `details: { provider }`), raised before any LLM call when `container.llm(provider)` throws `ConfigError`;
  - `generation_failed` (502, `details: { reason: 'timeout' | 'invalid_output' | 'llm_error' }`);
  - `repo_not_indexed`, which carries `details: { reason: 'flag_off' | 'never_indexed' | 'index_failed' | 'no_ranked_files' }`.
- **A7: a reading-path or critical-path file the model gave no reason for** stays in the list with `reason: null`, because membership is the index's (AC-7). The page shows a muted "No reason given" line.
- **A8: where model text is capped.**
  - Architecture prose: 12,000 chars, truncated with `…`.
  - Reasons and tasks: 200 chars, truncated with `…`.
  - A command over 300 chars, or one containing a newline, is removed.
  - A diagram over 4,000 chars, or empty after trimming, becomes `null`.
  - The serialized tour must be ≤256 KB, or the generation fails as `invalid_output` and stores nothing. With the caps above this is a guard that should never trip.

### Recommendations
1. **Adopted: two read-side determinism fixes in repo-intel, plus `rank` on `FileRankRow`.**
   - `getRankedPaths` orders by `rank DESC, file_path ASC` ([repository.ts:457](server/src/modules/repo-intel/repository.ts:457)).
   - The `getCriticalPaths` next-hop sort breaks ties by path ([service.ts:689](server/src/modules/repo-intel/service.ts:689)).
   - `getFileRankFor` also selects `rank` ([repository.ts:440-446](server/src/modules/repo-intel/repository.ts:440)), and `FileRankRow` gains `rank: number`.

   Why: AC-6, AC-8 and NFR-2 cannot be met from the onboarding module alone. Ties at the SQL `LIMIT` cut-off change *which* files appear, not only their order. This is a read path; ranking and indexing (the spec's non-goal) are untouched. The only `getFileRank` consumer reads `percentile` only ([server/src/modules/reviews/run-executor.ts:530](server/src/modules/reviews/run-executor.ts:530)), and no test builds a `FileRankRow` literal. Plan change: step 1.
2. **Adopted: the system prompt becomes `ONBOARDING_SYSTEM_PROMPT` in `modules/onboarding/constants.ts`, and the stale `server/src/prompts/onboarding.system.md` is deleted.** Why:
   - the stale file asks for other sections and a `{{language}}` (DR-4, Q-12);
   - nothing loads it (the only mention is a doc comment, [server/src/platform/prompts.ts:23](server/src/platform/prompts.ts:23));
   - `tsc` would not copy it to `dist` ([prompts.ts:12-14](server/src/platform/prompts.ts:12));
   - conventions keeps its prompt as a ring-2 constant ([server/src/modules/conventions/constants.ts](server/src/modules/conventions/constants.ts)).

   This honours server/INSIGHTS.md:66-73. Plan change: steps 2 and 5.
3. **Adopted: the service takes ports, not the `Container`, and is built in `routes.ts` with lazy ports** (the blast precedent, [server/src/modules/blast/routes.ts:28-53](server/src/modules/blast/routes.ts:28)). Why:
   - this follows onion rule 9;
   - a test that patches `container.repoIntel` after `buildApp()` is honoured (server/INSIGHTS.md:17-25);
   - no `container.ts` edit is needed.

   Plan change: steps 4 and 5.
4. **Adopted: `GET` returns an envelope `OnboardingPage { repo, tour, generating, stale }`** instead of a bare `Onboarding`. Why:
   - EC-1 needs "no tour";
   - AC-15 and EC-12 need `generating`;
   - EC-9 needs `stale`;
   - AC-2 and AC-13 need the repo name and default branch.

   Plan change: step 0.
5. **Not adopted: promoting `github-urls.ts` out of `pulls/[number]/` into `src/lib/`.** It has four importers in the PR page tree, so moving it is a refactor of shipped code. The tour builds its default-branch blob URL in its own `helpers.ts`, because a feature→feature import would be a CRITICAL. Logged as a follow-up.
6. **Adopted: a browser flow `e2e/specs/15-onboarding-tour.flow.json`** in the Integration step. AC-1 and NFR-10 are `verify: e2e`, and `14-project-context.flow.json` is the read-only precedent. Plan change: step 11.
7. **Not adopted: a DB-backed generation lock.** Superseded by the user's decision D3.

### Execution mode
Chosen by the planner, as the caller asked: **multi-agent**. Once step 0 lands the reshaped contract in both vendored copies, the server module (track A) and the client page (track B) share no file. They live in different packages, so neither can turn the other's `typecheck` red.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) · [server/AGENTS.md](server/AGENTS.md) · [client/AGENTS.md](client/AGENTS.md) | do-not-touch, naming table, verify script; module = `routes.ts` + one `modules/index.ts` entry; `nav.ts` is app-owned |
| [server/src/db/schema/context.ts:120-126](server/src/db/schema/context.ts:120) | `onboarding(repo_id PK → repos cascade, json NOT NULL, generated_at)`: one row per repo, reused unchanged |
| [server/src/vendor/shared/contracts/knowledge.ts:28-47](server/src/vendor/shared/contracts/knowledge.ts:28) | loose contract to reshape; `Provider` enum lives in the same file |
| [server/test/contracts.test.ts:134-147](server/test/contracts.test.ts:134) | the only other consumer of `Onboarding.parse`; must change in step 0 (server/INSIGHTS.md:37-40) |
| [server/src/modules/repo-intel/service.ts:639-702](server/src/modules/repo-intel/service.ts:639) · [repository.ts:440-458](server/src/modules/repo-intel/repository.ts:440) · [types.ts:119-171](server/src/modules/repo-intel/types.ts:119) | facade reads, junk filter ([service.ts:713-733](server/src/modules/repo-intel/service.ts:713)), missing tiebreaks, chains without ranks |
| [server/src/modules/repo-intel/service.ts:189-205](server/src/modules/repo-intel/service.ts:189) | `getIndexState` always answers (degraded `no_data`, `lastIndexedSha: ''`) |
| [server/src/modules/conventions/service.ts:71-107](server/src/modules/conventions/service.ts:71) · [conventions/README.md](server/src/modules/conventions/README.md) | 404 → 409 → 422 ordering, `completeStructured` call shape, error codes the client branches on |
| [server/src/modules/conventions/helpers.ts:1,73-76](server/src/modules/conventions/helpers.ts:73) | `wrapUntrusted` from `@devdigest/reviewer-core` in a ring-2 helper |
| [server/src/modules/blast/routes.ts:28-53](server/src/modules/blast/routes.ts:28) · [blast/service.ts:57](server/src/modules/blast/service.ts:57) | service with injected lazy ports + logger; in-process per-repo map |
| [server/src/platform/container.ts:231-263](server/src/platform/container.ts:231) · [platform/errors.ts](server/src/platform/errors.ts) | `llm(provider)` throws `ConfigError` on a missing key; `AppError(code, msg, status, details)` |
| [server/src/modules/_shared/feature-models.ts:56-62](server/src/modules/_shared/feature-models.ts:56) | `resolveFeatureModel(container, ws, 'onboarding')` |
| [server/eslint.config.mjs:114-127](server/eslint.config.mjs:114) | ring-2 globs (`service/helpers/constants.ts`), ring-3 `repository*.ts`, ring-4 `routes.ts` |
| [server/src/adapters/mocks.ts:61-110](server/src/adapters/mocks.ts:61) | `MockLLMProvider.calls`, `structuredBySchema[schemaName]`; `MockSecretsProvider` |
| [client/src/vendor/ui/nav.ts:21-28](client/src/vendor/ui/nav.ts:21) · [app-shell/helpers.ts:26-40](client/src/components/app-shell/helpers.ts:26) · [nav.test.ts](client/src/components/app-shell/nav.test.ts) | nav registry, active-key mapping, the test that pins the WORKSPACE order |
| [client/src/app/repos/[repoId]/context/page.tsx](client/src/app/repos/[repoId]/context/page.tsx) · [ProjectContextView.test.tsx:1-25](client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx:1) | async server-component page; test harness (`NextIntlClientProvider`, mocked `AppShell`, `useRepoNotFound`, hooks) |
| [client/src/lib/hooks/conventions.ts:17-35](client/src/lib/hooks/conventions.ts:17) · [ConventionsView/helpers.ts:11-25](client/src/app/repos/[repoId]/conventions/_components/ConventionsView/helpers.ts:11) | exported key + query + synchronous POST mutation; `timeAgo` and error-code→copy mapping |
| [client/src/components/mermaid-diagram/MermaidDiagram.tsx](client/src/components/mermaid-diagram/MermaidDiagram.tsx) · [Markdown.tsx](client/src/vendor/ui/primitives/Markdown.tsx) | diagram validation and Markdown rendering already exist |
| [client/messages/en/onboarding.json](client/messages/en/onboarding.json) · [shell.json:19](client/messages/en/shell.json:19) | prepared namespace with stale copy; `nav.onboarding-tour` label exists |
| [e2e/specs/14-project-context.flow.json](e2e/specs/14-project-context.flow.json) · [06-onboarding.flow.json](e2e/specs/06-onboarding.flow.json) | read-only flow precedent; the Add repository flow that must keep passing |

## Insights that bind this work
1. **Shared contracts are vendored twice and have drifted.** [INSIGHTS.md:273-278](INSIGHTS.md:273). Step 0 edits the `// ---- Onboarding ----` block of `server/src/vendor/shared/contracts/knowledge.ts` and copies it byte for byte into `client/src/vendor/shared/contracts/knowledge.ts` in the same step. Both packages typecheck in its verify. No track edits either copy afterwards.
2. **Do not build from a starter's leftover hooks.** [server/INSIGHTS.md:66-73](server/INSIGHTS.md:66). Four leftovers are treated as non-requirements and replaced:
   - the scaffolded prompt;
   - the empty-state copy;
   - the free-form `sections[]` contract;
   - the `/onboarding → onboarding-tour` active-key mapping.

   The tour gets its own `/repos/:repoId/tour` segment (D2), and the spec's ACs are the requirements (Rec 2, steps 0, 5, 6, 7).
3. **The facade knows whether rows exist, not why.** [server/INSIGHTS.md:235-241](server/INSIGHTS.md:235). `repo_not_indexed.details.reason` is derived in a pure helper from `repoIntelEnabled` plus `getIndexState`. It is never read off an empty array (step 2).

Also honoured:
- A clone reader lives in `repository-<what>.ts` and `helpers.ts` stays pure ([server/INSIGHTS.md:181-189](server/INSIGHTS.md:181)).
- Tokenise untrusted text only through the tokenizer adapter ([server/INSIGHTS.md:339-346](server/INSIGHTS.md:339)).
- `response: { 200 }` turns mapper bugs into a 500 ([server/INSIGHTS.md:248-252](server/INSIGHTS.md:248)). The `.it` test `safeParse`s every response.
- Unknown cost stays `null` ([INSIGHTS.md:266-271](INSIGHTS.md:266)).
- Patch one facade method with `Object.create` ([server/INSIGHTS.md:17-25](server/INSIGHTS.md:17)).
- A collapsible header keeps its title as its accessible name ([client/INSIGHTS.md:69-73](client/INSIGHTS.md:69)).
- LLM text never goes in a `Badge` ([client/INSIGHTS.md:60-67](client/INSIGHTS.md:60)).
- Export the query-key builder ([client/INSIGHTS.md:197-201](client/INSIGHTS.md:197)).
- A route page that forwards a param stays a server component ([client/INSIGHTS.md:224-231](client/INSIGHTS.md:224)).
- `ErrorState` owns its retry label ([client/INSIGHTS.md:282-284](client/INSIGHTS.md:282)).
- Tests use `fireEvent`, because `user-event` is not installed ([client/INSIGHTS.md:235-237](client/INSIGHTS.md:235)).

**"What Doesn't Work" check:**
- *"Zero call sites" from a `src/`-only grep* ([server/INSIGHTS.md:37-40](server/INSIGHTS.md:37)): `test/` was grepped. `contracts.test.ts` is updated in step 0. No `getFileRank` mock would break.
- *`drizzle-kit generate` hangs on add+drop* ([server/INSIGHTS.md:282-288](server/INSIGHTS.md:282)): not reached, because there is no migration.
- *Preloading a review catalogue* ([INSIGHTS.md:72-77](INSIGHTS.md:72)): no `security` and no `typescript-expert` in the Skill contract.
- *`.it` run flakiness on this Windows host* ([server/INSIGHTS.md:378-385](server/INSIGHTS.md:378)): `onboarding.it.test.ts` drives no review run.

## Constraints
- **Onion rings (server):**
  - `modules/onboarding/constants.ts`, `helpers.ts` and `service.ts` are ring 2. They may not import `drizzle-orm`, `node:fs`, a bare `zod`, `fastify`, `**/adapters/**` or `platform/container`.
  - `repository.ts` and `repository-files.ts` are ring 3. `routes.ts` is ring 4.
  - The service may `import type { RepoIntel }` from `../repo-intel/types.js` (blast precedent, [blast/service.ts:2](server/src/modules/blast/service.ts:2)).
  - It may import `AppError`/`ConfigError` from `../../platform/errors.js` and schema *values* (`OnboardingDraft`) from `@devdigest/shared`.
- **Contract once + mirror:** the `// ---- Onboarding ----` block in `server/src/vendor/shared/contracts/knowledge.ts` is canonical. `client/src/vendor/shared/contracts/knowledge.ts` gets the identical block in step 0.
- **`.js` on relative imports** in `server/`.
- **Tests:** the Postgres test is `server/test/onboarding.it.test.ts`. The filesystem-only and pure tests keep plain `*.test.ts`.
- **Declarative validation:**
  - `params: IdParams`, `body: OnboardingGenerateBody` (`z.object({}).strict()`) and `response: { 200: OnboardingPage }`;
  - no `.parse()` in a handler;
  - the client always POSTs `{}`.
- **Routes (D2):** the server API path segment is `onboarding` (`/repos/:id/onboarding`, `/repos/:id/onboarding/generate`). The client page segment is `tour` (`client/src/app/repos/[repoId]/tour/`). Do not create `client/src/app/repos/[repoId]/onboarding/`, and do not touch `client/src/app/onboarding/**` (Add repository).
- **No migration.** `server/src/db/migrations/**` is not touched.
- **Do not touch:**
  - `reviewer-core/**`;
  - every lock-file;
  - `client/src/vendor/ui/**` except `nav.ts`;
  - `client/src/vendor/shared/**` except the step-0 mirror;
  - `repo-intel` ranking and indexing (`pipeline/**`, `INDEXER_VERSION`).
- **Client:**
  - no `fetch` in components; the hooks live in `client/src/lib/hooks/onboarding.ts` over `src/lib/api.ts`;
  - every string comes from `messages/en/onboarding.json`, except the `nav.ts` literal (R35);
  - `_components/<Name>/<Name>.tsx` + `<Name>.test.tsx`;
  - cross-folder imports use `@/`;
  - nothing under `src/app/repos/[repoId]/tour/**` imports another route segment.
- **Secrets:** the API key is only probed through `container.llm(provider)`. It is never logged and never in a response.

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/knowledge.ts` (+ client mirror) | `zod` | wire contracts and the model-output schema (`typescript-expert` is review-time, the gate's) |
| `server/src/modules/repo-intel/repository.ts`, `server/src/modules/onboarding/repository*.ts` | `onion-architecture`, `drizzle-orm-patterns` | ring 3 persistence + filesystem |
| `server/src/modules/repo-intel/{service,types}.ts`, `server/src/modules/onboarding/{service,helpers,constants}.ts` | `onion-architecture` | ring 2 |
| `server/src/modules/onboarding/routes.ts`, `server/src/modules/index.ts` | `onion-architecture`, `fastify-best-practices` | ring 4 + HTTP surface (`security` is review-time) |
| `client/src/lib/hooks/onboarding.ts`, `client/src/app/repos/[repoId]/tour/**/*.{ts,tsx}`, `client/src/components/app-shell/helpers.ts` | `frontend-ui-architecture`, `react-best-practices` | placement + component and hook rules |
| `client/src/app/repos/[repoId]/tour/page.tsx` and every `"use client"` file | `next-best-practices` | App Router convention file / client boundary |
| `client/**/*.test.ts(x)` | `react-testing-library` | component tests |
| `server/test/**`, `client/messages/**`, `client/src/vendor/ui/nav.ts`, `e2e/specs/**` | none | convention-only |

Derived from the write-time row of [.claude/skills/pr-self-review/routing.md](.claude/skills/pr-self-review/routing.md). Each implementer loads each skill once, at the first step that needs it.
- Step 0: `zod`.
- Track A: `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices`.
- Track B: `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/knowledge.ts`, `server/test/contracts.test.ts` | 0 | `node scripts/verify.mjs server client --checks` · `node scripts/verify.mjs server --file server/test/contracts.test.ts` | — |
| A — server | `server/src/modules/repo-intel/{repository,service,types}.ts`, `server/src/modules/onboarding/**`, `server/src/modules/index.ts`, `server/src/prompts/onboarding.system.md` (delete), `server/test/onboarding*.ts`, `server/test/repo-intel-critical-paths.test.ts` | 1–5 | `node scripts/verify.mjs server --checks` · `--file server/test/<file>` | step 0 |
| B — client | `client/src/lib/hooks/onboarding.ts`, `client/messages/en/onboarding.json`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/helpers.ts`, `client/src/components/app-shell/nav.test.ts`, `client/src/app/repos/[repoId]/tour/**` | 6–10 | `node scripts/verify.mjs client --checks` · `--file <test>` | step 0 |
| shared — integration | `e2e/specs/15-onboarding-tour.flow.json`, `e2e/README.md` (coverage row) | 11 | `node scripts/verify.mjs server client` · `node scripts/verify.mjs server --it` · `./scripts/e2e.sh` (the one full run) | A, B |

Each track is one `implementer` invocation. Tracks A and B are in different packages.

## Steps

### 0. Contracts: reshape `Onboarding`, add the page envelope, the generate body and the model-output schema; mirror to the client
- **Files:** [`server/src/vendor/shared/contracts/knowledge.ts`](server/src/vendor/shared/contracts/knowledge.ts) (edit, lines 28-47) · [`client/src/vendor/shared/contracts/knowledge.ts`](client/src/vendor/shared/contracts/knowledge.ts) (edit, identical block) · [`server/test/contracts.test.ts`](server/test/contracts.test.ts) (edit, `:134-147` Onboarding case)
- **Track:** shared
- **Layer:** ring 1, the canonical contracts; the client copy is a mirror
- **Skills:** `zod`
- **Do:** replace `OnboardingLink`, `OnboardingSection` and the old `Onboarding` with the shapes below. Keep `Provider` where it is, and export the inferred types.
  - `OnboardingSectionId = z.enum(['architecture','critical_paths','run_locally','reading_path','first_tasks'])` sets the display order.
  - `OnboardingFile = z.object({ path: z.string(), reason: z.string().nullable() })`.
  - `OnboardingCommand = z.object({ line: z.string(), source_path: z.string() })`.
  - `OnboardingTask = z.object({ text: z.string(), paths: z.array(z.string()).min(1) })`.
  - `Onboarding`:
    ```ts
    z.object({
      repo_id: z.string(),
      generated_at: z.string(),
      index_sha: z.string(),
      files_indexed: z.number().int(),
      provider: Provider,
      model: z.string(),
      architecture: z.object({ prose: z.string(), diagram: z.string().nullable() }),
      critical_paths: z.array(OnboardingFile).max(6),
      run_locally: z.array(OnboardingCommand).max(10),
      reading_path: z.array(OnboardingFile).max(8),
      first_tasks: z.array(OnboardingTask).max(5),
    })
    ```
  - `OnboardingPage = z.object({ repo: z.object({ name, full_name, default_branch }), tour: Onboarding.nullable(), generating: z.boolean(), stale: z.boolean() })` (Rec 4).
  - `OnboardingGenerateBody = z.object({}).strict()`.
  - `OnboardingDraft` is the model output. It uses no `.max()` and no `.optional()`, because the providers send strict `json_schema`; caps are applied in code.
    ```ts
    z.object({
      architecture: z.string(),
      diagram: z.string().nullable(),
      file_reasons: z.array(z.object({ path: z.string(), reason: z.string() })),
      commands: z.array(z.object({ line: z.string(), source_path: z.string() })),
      first_tasks: z.array(z.object({ text: z.string(), paths: z.array(z.string()) })),
    })
    ```
    Each field gets a `.describe()` in the `ConventionExtraction` style ([knowledge.ts:297-314](server/src/vendor/shared/contracts/knowledge.ts:297)).
  - `contracts.test.ts`: the `Onboarding.parse` case uses the new shape. A second case asserts that 9 `reading_path` entries throw.
- **Done when:** the two `// ---- Onboarding ----` blocks are byte-identical; `grep -rn "OnboardingSection\|OnboardingLink" server/src client/src server/test` is empty; both packages typecheck; the contracts test passes.
- **Verify:** `node scripts/verify.mjs server client --checks` · `node scripts/verify.mjs server --file server/test/contracts.test.ts`

### 1. repo-intel read-side determinism + `rank` on `FileRankRow`
- **Files:** [`server/src/modules/repo-intel/repository.ts`](server/src/modules/repo-intel/repository.ts) (edit `:440-446`, `:449-458`) · [`server/src/modules/repo-intel/types.ts`](server/src/modules/repo-intel/types.ts) (edit `:119-122`) · [`server/src/modules/repo-intel/service.ts`](server/src/modules/repo-intel/service.ts) (edit `:689` only) · `server/test/repo-intel-critical-paths.test.ts` (new, hermetic)
- **Track:** A
- **Layer:** ring 3 (repository) · ring 2 (service) · facade type
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`
- **Do:**
  - `getRankedPaths`: `.orderBy(desc(t.fileRank.rank), asc(t.fileRank.filePath))`.
  - `FileRankRow` gains `rank: number`, and `getFileRankFor` selects `rank: t.fileRank.rank`.
  - The `getCriticalPaths` next-hop sort becomes `(rankOf(b) − rankOf(a)) || a.localeCompare(b)`.
  - Nothing else in repo-intel changes: no `INDEXER_VERSION` bump and no pipeline edit.
  - Test, built like [repo-intel-facade-degraded.test.ts:18-38](server/test/repo-intel-facade-degraded.test.ts:18) with a patched `repo` and `repoIntelEnabled: true`:
    - (a) two equal-rank import targets → the chain takes the lexically smaller path, whatever order `getEdges` returns them in (both orders tested);
    - (b) two calls give identical results (NFR-2).
- **Done when:** the new test passes; `repo-intel-facade-degraded.test.ts` still passes; typecheck is green.
- **Verify:** `node scripts/verify.mjs server --file server/test/repo-intel-critical-paths.test.ts` · `node scripts/verify.mjs server --checks`

### 2. Pure rules: constants and helpers
- **Files:** `server/src/modules/onboarding/constants.ts` (new) · `server/src/modules/onboarding/helpers.ts` (new) · `server/test/onboarding-helpers.test.ts` (new)
- **Track:** A
- **Layer:** ring 2
- **Skills:** `onion-architecture`
- **Do:**
  - **Constants:**
    - Section caps: `MAX_READING_PATH = 8`, `MAX_CRITICAL_PATHS = 6`, `MAX_COMMANDS = 10`, `MAX_TASKS = 5`.
    - Size limits: `MAX_INPUT_TOKENS = 60_000`, `MAX_STORED_BYTES = 256 * 1024`, `MAX_REASON_CHARS = 200`, `MAX_COMMAND_CHARS = 300`, `MAX_DIAGRAM_CHARS = 4_000`, `MAX_PROSE_CHARS = 12_000`.
    - Timing: `GENERATION_TIMEOUT_MS = 120_000` (D4) and `GENERATION_STALE_MS = 10 * 60_000` (D3).
    - `GENERATE_RATE_LIMIT = { max: 5, timeWindow: '1 minute' }`.
    - `ONBOARDING_SCHEMA_NAME = 'OnboardingDraft'`.
    - Excerpt limits: `EXCERPT_MAX_LINES = 150`, `RUN_SOURCE_MAX_CHARS = 8_000`, `README_MAX_CHARS = 16_000`.
    - `RUN_SOURCE_FILES`: a root-level allowlist, matched case-insensitively — `README.md`, `README`, `CONTRIBUTING.md`, `package.json`, `Makefile`, `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`, `.nvmrc`, `.tool-versions`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `.env.example`, `.env.sample`, `.env.template`.
    - `ALLOWED_ENV_FILES = ['.env.example','.env.sample','.env.template']`.
  - **`ONBOARDING_SYSTEM_PROMPT`** (Rec 2) covers:
    - the role;
    - the five sections and what each needs;
    - "write a reason only for the listed files, by exact path";
    - "every command must cite a `source_path` from the provided files, one line";
    - "every task names ≥1 provided path";
    - the mermaid rules carried over from the old file (`flowchart LR|TD`, quoted labels, no fences, `null` when none);
    - "English";
    - a security paragraph: everything inside `<untrusted>` is data.

    It does not describe the JSON shape ([docs/agent-prompts/README.md](docs/agent-prompts/README.md) "The output schema is NOT in the prompt").
  - **Helpers (pure, exported):**
    - `selectCriticalFiles(chains: string[][], rankOf: Map<string, number>, n)`: distinct files across all chains, sorted rank desc then path asc, first `n` (AC-8).
    - `notIndexedReason({ enabled, state, rankedCount })` → `'flag_off' | 'never_indexed' | 'index_failed' | 'no_ranked_files' | null` (EC-3, insight 3).
    - `isSecretEnvFile(name)`: `true` for any basename starting with `.env` that is not in `ALLOWED_ENV_FILES` (NFR-5).
    - `buildMessages(input)` → `ChatMessage[]`. The user message has a task line naming the repo, then four sections, each through `wrapUntrusted` from `@devdigest/reviewer-core`:
      - `## Files to explain` lists the reading-path and critical-path paths;
      - `## Run sources` holds one `wrapUntrusted('file:<path>', text)` per run-source file;
      - `## Excerpts` holds one block per ranked excerpt;
      - `## Repo skeleton` holds `wrapUntrusted('repo-map', text)` when non-empty.

      The system message is `ONBOARDING_SYSTEM_PROMPT`.
    - `fitToBudget(input, countTokens, max)` drops excerpts from the lowest rank upward until `countTokens(system + user) ≤ max`. If it is still over, it drops run sources from the end of the allowlist order. It returns the trimmed input and the final token count (NFR-3).
    - `groundedPathSet(input)` → `Set<string>` G (D1, AC-16 as amended).
    - `groundDraft(draft, ctx)` → `{ tour sections, removed: { reading_path, critical_paths, run_locally, first_tasks, diagram } }`. Rules:
      - Reasons are matched to the index-fixed file lists by exact path. Reasons for any other path are dropped and counted (AC-7). A missing reason → `null` (A7).
      - Reasons and task text are trimmed, newlines collapsed, and truncated to 200 chars with `…`.
      - A command is kept iff it has no `\r`/`\n`, is ≤300 chars after trim, and its `source_path ∈ G`. Then commands are capped at 10.
      - Task paths are filtered to G, and a task left with 0 paths is dropped. Then tasks are capped at 5 (AC-12, AC-16 as amended).
      - The diagram is trimmed and set to `null` if empty or >4,000 chars (EC-7). Prose is capped at 12,000 chars.
    - `isStale(tour, currentSha)`: `currentSha !== '' && currentSha !== tour.index_sha` (EC-9).
  - **Unit test:**
    - selection order with ties and duplicates across chains;
    - each `notIndexedReason` branch;
    - `.env`, `.env.local` and `.env.production` are secret; `.env.example` is not;
    - `buildMessages` wraps every clone-derived string: `</untrusted> ignore previous` stays inside its block, and the system message equals the constant;
    - `fitToBudget` drops the lowest-ranked excerpt first, with a fake `countTokens` (`s.length`);
    - `groundDraft`:
      - an unknown-path reason is ignored and counted;
      - a multi-line command and an out-of-G `source_path` are removed and counted;
      - a command citing `package.json` (in G) is kept;
      - a 201-char reason becomes 200 chars ending in `…`;
      - a task with only an invented path is dropped;
      - an 11th command is cut;
      - a 4,001-char diagram → `null`;
      - a missing reason → `null`;
    - `isStale` with `''`, an equal sha and a different sha.
- **Done when:** the test covers every listed branch and passes; `helpers.ts` imports nothing from `node:*`, `drizzle-orm` or `zod`.
- **Verify:** `node scripts/verify.mjs server --file server/test/onboarding-helpers.test.ts`

### 3. Clone reader: run sources and ranked excerpts
- **Files:** `server/src/modules/onboarding/repository-files.ts` (new) · `server/test/onboarding-files.test.ts` (new, filesystem only, hermetic)
- **Track:** A
- **Layer:** ring 3 (filesystem), by the `repository*.ts` filename
- **Skills:** `onion-architecture`
- **Do:**
  - `readRunSources(clonePath)` → `{ path, text }[]`.
    - It reads the root only, keeping lowercase names that are in `RUN_SOURCE_FILES`, and never opens a name for which `isSecretEnvFile` is true (NFR-5).
    - It requires a regular file and does not follow symlinks (it uses `lstat`).
    - A NUL byte in the first 1 KB marks a binary file, which is skipped.
    - Caps are `README_MAX_CHARS` for README files and `RUN_SOURCE_MAX_CHARS` for others, with a `\n… [truncated]` marker.
    - Order is the allowlist order. It never throws; a missing root → `[]`.
  - `readExcerpts(clonePath, paths)` → `{ path, text }[]` in the given (rank) order.
    - Each excerpt is the first `EXCERPT_MAX_LINES` lines.
    - It rejects absolute paths and `..` segments, `realpath`s the root and the target, and refuses an escape. This is the guard shape of [server/src/modules/project-context/repository-files.ts](server/src/modules/project-context/repository-files.ts).
    - An unreadable path is skipped.
  - Tests on a `mkdtemp` dir:
    - `README.md`, `package.json` and `.env.example` are read;
    - `.env` and `.env.local` holding `SECRET=x` are never returned, and no returned text contains `SECRET=x`;
    - a nested `sub/package.json` is ignored;
    - a 20 KB README is cut with the marker;
    - `readExcerpts` keeps the order, cuts at 150 lines, skips `../x.ts`, an absolute path and a missing file;
    - a non-existent root → `[]`;
    - where `symlink` is permitted (skip on EPERM on Windows), a symlinked `README.md` pointing outside the clone is not read.
- **Done when:** all cases pass on Windows and Linux.
- **Verify:** `node scripts/verify.mjs server --file server/test/onboarding-files.test.ts`

### 4. Persistence + service (lock, ordering, one call, grounding, log)
- **Files:** `server/src/modules/onboarding/repository.ts` (new) · `server/src/modules/onboarding/service.ts` (new) · `server/test/onboarding-service.test.ts` (new, hermetic, fakes only)
- **Track:** A
- **Layer:** ring 3 (repository) · ring 2 (service)
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`
- **Do:**
  - **Repository:**
    - `getRepo(workspaceId, repoId)` → `{ id, name, fullName, defaultBranch, clonePath } | null`, workspace-scoped.
    - `getTour(repoId)` → `Onboarding | null`. It `Onboarding.safeParse`s `onboarding.json`; a row that does not parse (legacy shape) → `null`.
    - `saveTour(repoId, tour)` does `insert … onConflictDoUpdate({ target: repoId, set: { json, generatedAt } })` (NFR-11).
  - **Service `OnboardingService`.** Its constructor takes a deps object, never the `Container` (Rec 3):
    - `repo: Pick<OnboardingRepository, 'getRepo' | 'getTour' | 'saveTour'>`
    - `index: Pick<RepoIntel, 'getIndexState' | 'getTopFilesByRank' | 'getCriticalPaths' | 'getFileRank' | 'getRepoMap'>`
    - `files: { readRunSources, readExcerpts }`
    - `resolveModel(ws) → Promise<FeatureModelChoice>`
    - `llm(provider) → Promise<LLMProvider>`
    - `countTokens(s) → number`
    - `log: { info(obj, msg): void; warn(obj, msg): void }`
    - `repoIntelEnabled: boolean`
    - `timeoutMs`, `staleMs`, and `now?: () => number`

    It holds `private running = new Map<string, number>()` (D3).
  - **`page(ws, repoId)`** → `OnboardingPage | null`. It reads `getRepo`, `getTour` and `getIndexState`.
    - `generating` is true when the map holds an entry younger than `staleMs`.
    - `stale` is `tour ? isStale(tour, state.lastIndexedSha) : false`.
    - It makes no LLM call (NFR-1), and it works when the flag is off, the index is gone or the key is missing (NFR-4).
  - **`generate(ws, repoId)`** → `OnboardingPage | null`, in this order:
    1. An unknown repo → `null` (the route turns it into a 404).
    2. A live map entry → `AppError('generation_running', …, 409)` (EC-6). Otherwise set `running[repoId] = now()`. Everything below runs in `try { … } finally { running.delete(repoId) }`.
    3. `clonePath` null → `AppError('repo_not_cloned', …, 422)` (EC-2).
    4. `readingPath = index.getTopFilesByRank(repoId, 8)` and `state = index.getIndexState(repoId)`. If `notIndexedReason(...)` is non-null → `AppError('repo_not_indexed', …, 422, { reason })` (EC-3). No LLM call happens.
    5. `chains = index.getCriticalPaths(repoId)` and `ranks = index.getFileRank(repoId, distinct chain files)`. Then `criticalPaths = selectCriticalFiles(chains, rankOf, 6)` (AC-8).
    6. `{ provider, model } = resolveModel(ws)`, then `llm = await deps.llm(provider)`. A `ConfigError` → `AppError('provider_key_missing', …, 422, { provider })` (EC-5, A6), still before any call.
    7. Read `runSources`, the excerpts for `readingPath ∪ criticalPaths` sorted by rank, and `repoMap = index.getRepoMap(repoId)`. Then apply `fitToBudget(…, countTokens, 60_000)`.
    8. Make one call: `llm.completeStructured({ model, schema: OnboardingDraft, schemaName: 'OnboardingDraft', messages, temperature: 0, maxRetries: 0, timeoutMs })`, raced against a `timeoutMs` timer (D4). Failures map to `AppError('generation_failed', …, 502, { reason })` (EC-4):
       - timer wins → `{ reason: 'timeout' }`;
       - schema mismatch (a typed `StructuredOutputError`) → `{ reason: 'invalid_output' }`. *Amended 2026-10-01, decided by the user:* output from OpenRouter that is not JSON fails in reviewer-core's `parseWithRepair` before any schema check, so it maps to `llm_error`. This gap is accepted; tagging it would need a `reviewer-core` change, which this plan does not touch;
       - any other throw → `{ reason: 'llm_error' }`.
    9. Build the tour from `groundDraft` (AC-16 as amended): `generated_at = new Date(now()).toISOString()`, `index_sha = state.lastIndexedSha`, `files_indexed = state.filesIndexed`, plus `provider` and `model` (AC-5, AC-17).
    10. If `Buffer.byteLength(JSON.stringify(tour)) > MAX_STORED_BYTES` → `invalid_output`. Otherwise `saveTour` and return `page()`. On any failure nothing is saved, so the previous row survives (EC-4).
    11. Log exactly one line per generation that reached step 8: `{ repoId, provider, model, tokensIn, tokensOut, costUsd (null stays null), durationMs, removed, outcome }`, message `'onboarding generation'` (NFR-9).
  - **Hermetic test** with in-memory fakes and a `MockLLMProvider` (`structuredBySchema.OnboardingDraft`):
    - AC-5 / NFR-1: exactly one `completeStructured` call in `llm.calls`, with `maxRetries: 0`;
    - AC-7: the files are the fake index's, in its order;
    - EC-3 for `flag_off` and `no_ranked_files`, with zero `llm.calls`;
    - EC-5: `deps.llm` throws `ConfigError` → 422 `provider_key_missing` with `details.provider === 'openrouter'`, and `saveTour` is never called;
    - EC-6: a second `generate` while the first awaits a deferred LLM promise → 409, and `calls.length === 1`;
    - NFR-8: with `now` advanced by 10 min + 1 ms, a stale entry no longer blocks;
    - EC-4: a timeout (`timeoutMs: 20`, LLM never resolves), invalid output (a ZodError-shaped throw) and a generic throw each give 502 with the right reason, and `saveTour` is never called;
    - the lock is released after every failure;
    - NFR-9: the captured log line has all fields, and `costUsd: null` stays `null`;
    - NFR-3: a fake `countTokens` forces a drop, so the lowest-ranked excerpt is absent from the user message.
- **Done when:** the test passes; the service file imports nothing from `drizzle-orm`, `node:fs`, `zod`, `fastify`, `**/adapters/**` or `platform/container`.
- **Verify:** `node scripts/verify.mjs server --file server/test/onboarding-service.test.ts` · `node scripts/verify.mjs server --checks`

### 5. Routes, registration, prompt-file removal, integration test
- **Files:** `server/src/modules/onboarding/routes.ts` (new) · [`server/src/modules/index.ts`](server/src/modules/index.ts) (edit: one import, one `onboarding` entry) · [`server/src/prompts/onboarding.system.md`](server/src/prompts/onboarding.system.md) (delete, Rec 2) · `server/test/onboarding.it.test.ts` (new)
- **Track:** A
- **Layer:** ring 4
- **Skills:** `onion-architecture`, `fastify-best-practices`
- **Do:**
  - **`routes.ts`** builds `OnboardingService` once, with lazy ports as in [blast/routes.ts:31-53](server/src/modules/blast/routes.ts:31):
    - `index` methods call `container.repoIntel.*` per call;
    - `llm: (p) => container.llm(p)`;
    - `resolveModel: (ws) => resolveFeatureModel(container, ws, 'onboarding')`;
    - `countTokens: (s) => container.tokenizer.count(s)`;
    - `files: { readRunSources, readExcerpts }`;
    - `log: app.log`;
    - `repoIntelEnabled: container.config.repoIntelEnabled`;
    - the timeout and stale constants.

    Routes. The API path segment stays `onboarding` (D2); the client page path is unrelated.
    - `GET /repos/:id/onboarding` — `schema: { params: IdParams, response: { 200: OnboardingPage } }`. `null` → `NotFoundError('Repo not found')`.
    - `POST /repos/:id/onboarding/generate` — `schema: { params: IdParams, body: OnboardingGenerateBody, response: { 200: OnboardingPage } }`, `config: { rateLimit: GENERATE_RATE_LIMIT }`.

    Both call `getContext` first. A header comment lists the routes and the error codes (A6).
  - Delete `server/src/prompts/onboarding.system.md`. Leave `platform/prompts.ts` untouched.
  - **Integration test** setup:
    - `startPg` + `seed`, with `hasDocker ? describe : describe.skip` ([conventions.it.test.ts:26-30](server/test/conventions.it.test.ts:26));
    - a `mkdtemp` clone with `README.md`, `package.json` (with `"dev"`), `.env` (`SECRET=x`) and the ranked `.ts` files, and a repo row pointing at it;
    - index rows inserted directly: `file_rank` (including **two files of equal rank** and a `foo.test.ts` with the top rank), `file_edges`, then `repo_index_state` at `INDEXER_VERSION` with `lastIndexedSha: 'sha1'` and `filesIndexed: 42`, written last (server/INSIGHTS.md:268-275);
    - `MockLLMProvider` for `openai` and `openrouter`;
    - every response body `safeParse`d against `OnboardingPage`.

    Cases:
    - **EC-1:** GET before generation → `tour: null`, `generating: false`.
    - **AC-5 / AC-17 / NFR-1:** POST `{}` → 200. The row stores the Settings provider/model, and `llm.calls.length === 1`. After changing the Settings override, GET still shows the old provider/model.
    - **AC-6:** `reading_path` excludes `foo.test.ts`, orders the equal-rank pair by path, and has at most 8 entries.
    - **NFR-2:** a second POST gives identical `reading_path` and `critical_paths`.
    - **AC-8:** distinct chain files, at most 6, in rank order.
    - **AC-16 (amended, D1):** a draft citing `src/invented.ts` in a reason, a task and a command → none survive. A command citing `package.json` survives.
    - **NFR-5:** the captured request contains no `SECRET=x`, and all clone text sits inside `<untrusted`.
    - **EC-2:** `clonePath: null` → 422 `repo_not_cloned`.
    - **EC-3:** no `file_rank` rows → 422 `repo_not_indexed` with `details.reason`. A second app with `REPO_INTEL_ENABLED=false` → `reason: 'flag_off'`. Zero LLM calls in both.
    - **EC-5:** `secrets: new MockSecretsProvider({})` with no `llm` override → 422 `provider_key_missing` with `details.provider`. Zero calls, and the earlier tour is unchanged.
    - **EC-4:** a throwing mock → 502 `generation_failed`, and the previous tour is unchanged.
    - **EC-6 / AC-15 / EC-12:**
      1. A mock resolving after a deferred promise.
      2. Fire POST A without awaiting it.
      3. GET → `generating: true`, and the previous tour is still present.
      4. POST B → 409 `generation_running`.
      5. Release the deferred and await A.
      6. GET → the new tour, `generating: false`, and calls grew by exactly 1.
    - **EC-9:** `last_indexed_sha` updated to `'sha2'` → `stale: true`.
    - **NFR-4:** with the flag off, no secrets and the index rows deleted, GET still returns the stored tour.
    - **NFR-11:** `DELETE /repos/:id` → the `onboarding` row is gone.
    - **Identity:** a random uuid → 404 on GET and POST. A non-uuid → 422. A body `{ "x": 1 }` → 422.
- **Done when:** the `.it` file passes under Docker; `pnpm arch` reports no `no-cross-module-reach-in` edge; `git status server/src/db/migrations` is clean.
- **Verify:** `node scripts/verify.mjs server --file server/test/onboarding.it.test.ts` (self-skips without Docker; the real run is step 11's `--it`) · `node scripts/verify.mjs server --checks`

### 6. Client data layer + the `onboarding` namespace
- **Files:** `client/src/lib/hooks/onboarding.ts` (new) · [`client/messages/en/onboarding.json`](client/messages/en/onboarding.json) (edit: replace the stale keys)
- **Track:** B
- **Layer:** `src/lib/hooks` (API layer), imported directly, not through the `hooks/index.ts` barrel ([client/INSIGHTS.md:145-151](client/INSIGHTS.md:145))
- **Skills:** `frontend-ui-architecture`, `react-best-practices`
- **Do:**
  - **Hooks.** They call the **server API path** `/repos/${repoId}/onboarding`, not the page path:
    - `onboardingKey(repoId) = ["onboarding", repoId] as const` (exported).
    - `useOnboarding(repoId)`: `useQuery` → `api.get<OnboardingPage>(\`/repos/${repoId}/onboarding\`)`, with `refetchInterval: (q) => q.state.data?.generating ? 3000 : false` (EC-12).
    - `useGenerateOnboarding(repoId)`: `useMutation` → `api.post<OnboardingPage>(\`/repos/${repoId}/onboarding/generate\`, {})`, with `onSuccess: setQueryData(onboardingKey)` and `onError: invalidateQueries(onboardingKey)`.
  - **`onboarding.json` keys:**
    - `title` ("Onboarding Tour", the crumb) and `heading` ("Onboarding for {name}");
    - `subtitle` ("Generated from index of {count, plural, one {# file} other {# files}} · last refreshed {ago}") and `ago.{now,minutes,hours,days}`;
    - `aiGenerated` ("AI-generated · {provider}/{model}");
    - `onThisPage`;
    - `sections.{architecture,critical_paths,run_locally,reading_path,first_tasks}` with the exact AC-2 titles;
    - `regenerate`, `generating` and `stale` ("This tour predates the current index");
    - `shareLink`, `linkCopied` and `copyFailed`;
    - `copyCommand` ("Copy {command}") and `commandCopied`;
    - `open` and `openFile` ("Open {path} on GitHub");
    - `noReason`;
    - `sectionEmpty.{…}` (EC-8);
    - `empty.title`, `empty.body` (names the five sections, NFR-6) and `empty.cta`;
    - `errors.{repo_not_cloned, repo_not_indexed.{flag_off,never_indexed,index_failed,no_ranked_files}, generation_running, provider_key_missing, apiKeysLink, generation_failed.{timeout,invalid_output,llm_error}, unknown}`;
    - `loadError.title`.

    There is no `retry` key ([client/INSIGHTS.md:282-284](client/INSIGHTS.md:282)).
- **Done when:** client typecheck is green; `grep -n "key modules\|conventions & gotchas" client/messages/en/onboarding.json` is empty.
- **Verify:** `node scripts/verify.mjs client --checks`

### 7. Sidebar entry + active-key mapping (D2)
- **Files:** [`client/src/vendor/ui/nav.ts`](client/src/vendor/ui/nav.ts) (edit, app-owned exception, [client/AGENTS.md:49-52](client/AGENTS.md:49)) · [`client/src/components/app-shell/helpers.ts`](client/src/components/app-shell/helpers.ts) (edit `:29`) · [`client/src/components/app-shell/nav.test.ts`](client/src/components/app-shell/nav.test.ts) (edit)
- **Track:** B
- **Layer:** shell registry + shared helper
- **Skills:** loaded already
- **Do:**
  - In WORKSPACE, between `pulls` and `context`, add `{ key: "onboarding-tour", label: "Onboarding Tour", icon: "Workflow", href: "/repos/:repoId/tour" }`. The key matches `shell.json` `nav.onboarding-tour`.
  - In `activeKeyFor`, replace `if (pathname.includes("/onboarding")) return "onboarding-tour";` with `if (/^\/repos\/[^/]+\/tour(\/|$)/.test(pathname)) return "onboarding-tour";`. `/onboarding` (Add repository) then matches no rule and returns `""`.
  - `nav.test.ts`:
    - the WORKSPACE order is `pulls`, `onboarding-tour`, `context`, and `onboarding-tour` has `href: "/repos/:repoId/tour"` (AC-1 at unit level);
    - `activeKeyFor("/repos/x/tour") === "onboarding-tour"`;
    - `activeKeyFor("/onboarding") === ""`;
    - `activeKeyFor("/repos/x/context") === "context"` (kept).
- **Done when:** the test passes; `grep -n '"/onboarding"' client/src/components/app-shell/helpers.ts` is empty.
- **Verify:** `node scripts/verify.mjs client --file client/src/components/app-shell/nav.test.ts`

### 8. Building blocks: helpers, copy hook, accordion section, "On this page"
- **Files** (all new), under `client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/`:
  - `constants.ts`
  - `helpers.ts` + `helpers.test.ts`
  - `hooks/useCopyToClipboard.ts`
  - `_components/TourSection/TourSection.tsx` + `TourSection.test.tsx`
  - `_components/OnThisPage/OnThisPage.tsx` + `OnThisPage.test.tsx`
- **Track:** B
- **Layer:** feature-local, under the `tour` route segment
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (`"use client"`), `react-testing-library`
- **Do:**
  - `constants.ts`: `SECTIONS`, the ordered `{ id: OnboardingSectionId, icon }` list:
    - `architecture` → `Boxes`
    - `critical_paths` → `Activity`
    - `run_locally` → `Command`
    - `reading_path` → `ListChecks`
    - `first_tasks` → `Target`

    Also `ERROR_COPY` maps an error code (+ reason) to an i18n key.
  - `helpers.ts`:
    - `timeAgo(iso, now)`, a local copy of the shape at [ConventionsView/helpers.ts:11-19](client/src/app/repos/[repoId]/conventions/_components/ConventionsView/helpers.ts:11);
    - `githubFileUrl(fullName, branch, path)` → `https://github.com/{fullName}/blob/{encodeURIComponent(branch)}/{segment-encoded path}` (Rec 5);
    - `errorCopyKey(code, details)`;
    - `tourUrl(origin, repoId)` → `${origin}/repos/${repoId}/tour` (D2).
  - `useCopyToClipboard()` → `copy(text): Promise<boolean>`. It uses `navigator.clipboard?.writeText` and returns `false` on a missing clipboard or a rejected call. It toasts `linkCopied`/`commandCopied` or `copyFailed` via `useToast` from `@/providers/toast` (AC-11, AC-14, EC-10).
  - `TourSection({ id, title, icon, expanded, onToggle, children })`:
    - The header is a `<button type="button" aria-expanded aria-controls={bodyId}>` whose text is the title; the Expand/Collapse hint goes in `title`, never in `aria-label` (NFR-7).
    - The body has `id={bodyId}` and `role="region"` and is rendered only when expanded.
    - The root carries `id={"tour-" + id}`.
  - `OnThisPage({ onSelect })` is a `<nav>` of `<button>`s, one per section in order.
  - Tests (fireEvent; mock `@/providers/toast`):
    - `helpers.test.ts`:
      - `githubFileUrl("acme/api", "main", "src/a b.ts")`;
      - every `timeAgo` unit;
      - `errorCopyKey("repo_not_indexed", { reason: "flag_off" })`;
      - `tourUrl("http://x", "r1") === "http://x/repos/r1/tour"`.
    - `TourSection`:
      - `getByRole("button", { name: "Critical paths" })` toggles `aria-expanded` `"true"`→`"false"` (AC-3);
      - its name does not contain "Collapse".
    - `OnThisPage`: clicking "How to run locally" calls `onSelect("run_locally")` (AC-4).
- **Done when:** the three test files pass.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/helpers.test.ts"` · `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/_components/TourSection/TourSection.test.tsx"` · `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/_components/OnThisPage/OnThisPage.test.tsx"`

### 9. Section bodies
- **Files** (all new), under `client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/_components/`, each with `<Name>.tsx` + `<Name>.test.tsx`:
  - `ArchitectureOverview`
  - `CriticalPaths`
  - `RunCommands`
  - `ReadingPath`
  - `FirstTasks`
- **Track:** B
- **Layer:** feature-local
- **Skills:** loaded already
- **Do.** Every body renders its `sectionEmpty.<id>` line when its list is empty (EC-8). LLM text is never in a `Badge`. Text spans get `overflowWrap: "anywhere"`, `minWidth: 0` and `whiteSpace: "normal"`, and action buttons get `flexShrink: 0` (EC-11).
  - `ArchitectureOverview({ prose, diagram })` renders `<Markdown>{prose}</Markdown>`. Below it, `diagram && <MermaidDiagram chart={diagram} />` from `@/components/mermaid-diagram`; with no diagram, no wrapper is rendered (AC-9, EC-7).
  - `CriticalPaths({ files, fullName, branch })`: one row per file with a `File` icon, the mono path, `— reason` (or `noReason`), and an Open `<a href={githubFileUrl(...)} target="_blank" rel="noopener noreferrer" aria-label={t("openFile", { path })}>` (AC-8, AC-13).
  - `RunCommands({ commands })`: an `<ol>`. Each item has its number, a `<code>` with `userSelect: "text"`, and a copy `<button aria-label={t("copyCommand", { command: line })}>` → `copy(line)` (AC-10, AC-11, EC-10, NFR-7).
  - `ReadingPath({ files, fullName, branch })`: an `<ol>` with the position number, the mono path as a GitHub link, and the reason line (AC-6 display).
  - `FirstTasks({ tasks, fullName, branch })`: one line per task, and each path is a mono GitHub link (AC-12).
  - Tests (mock `@/components/mermaid-diagram` with a stub that renders `data-testid="diagram"`; mock `@/providers/toast`):
    - Architecture: bold → `<strong>`; `<script>` shows as text; diagram → stub; `null` → no stub and no empty container (AC-9, EC-7).
    - CriticalPaths: the Open link has the default-branch blob URL, `target="_blank"` and `noopener`; a 300-char path row has `overflow-wrap: anywhere` and the Open link is still present (AC-13, EC-11); `[]` → empty line (EC-8).
    - RunCommands:
      - 3 commands → 3 numbered items;
      - `getByRole("button", { name: /Copy pnpm dev # http/ })` writes exactly `"pnpm dev # http://localhost:3000"` and toasts success (AC-11);
      - a rejected `writeText` → the failure toast, and the text is still present (EC-10);
      - no `navigator.clipboard` → the failure toast.
    - ReadingPath: positions 1, 2, 3 in input order; `reason: null` → `noReason`.
    - FirstTasks: the paths are GitHub links, and the task text renders.
- **Done when:** the five test files pass.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/_components/<Name>/<Name>.test.tsx"`, once per component

### 10. The view and the route
- **Files:**
  - `client/src/app/repos/[repoId]/tour/page.tsx` (new; an async server component copied from [context/page.tsx](client/src/app/repos/[repoId]/context/page.tsx), exporting `OnboardingTourPage`)
  - `client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/OnboardingTourView.tsx` (new, `"use client"`)
  - `…/OnboardingTourView/styles.ts` (new)
  - `…/OnboardingTourView/index.ts` (new)
  - `…/OnboardingTourView/OnboardingTourView.test.tsx` (new)
- **Track:** B
- **Layer:** route segment + feature view
- **Skills:** loaded already
- **Do:**
  - **Shell.** `OnboardingTourView({ repoId })` sits inside `AppShell` with a crumb `[repo full name, t("title")]`. It uses `RepoNotFound`/`useRepoNotFound` like [ProjectContextView.tsx:15-29](client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx:15).
  - **State** comes from `useOnboarding(repoId)` and `useGenerateOnboarding(repoId)`. `busy = gen.isPending || !!page?.generating`.
  - **Header:**
    - the title `heading` with the repo name in an accent mono span;
    - the subtitle `subtitle` (`files_indexed`, `timeAgo(generated_at)`) + ` · ` + `aiGenerated` (`provider`, `model`) (AC-2, AC-17);
    - a Regenerate `Button` (`RefreshCw`, `disabled={busy}`, `generating` label while busy);
    - a Share link `Button` (`Link`) → `copy(tourUrl(window.location.origin, repoId))` (AC-14, AC-15);
    - the stale notice beside Regenerate when `page.stale` (EC-9).
  - **Layout:** a left `OnThisPage` and five `TourSection`s in `SECTIONS` order. `expanded` is a `Record<id, boolean>`, initialised all `true` on mount and never persisted (AC-2). `onToggle` flips one id (AC-3). `onSelect(id)` sets it `true`, then calls `document.getElementById("tour-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" })` (AC-4).
  - **Other states:**
    - loading → `Skeleton`;
    - load error → `ErrorState title={t("loadError.title")} onRetry={refetch}`;
    - `tour === null` and not busy → `EmptyState` (`empty.*`) with a Generate `Button` (EC-1);
    - `tour === null` and busy → a disabled "Generating…" button.
  - **Generate error.** `gen.error instanceof ApiError` → an inline block above the sections showing the copy for `errorCopyKey(code, details)`:
    - `provider_key_missing` names `details.provider` and has a `next/link` to `/settings/api-keys`;
    - a Retry `Button` → `gen.mutate()`.

    The stored tour stays rendered underneath (EC-2, EC-3, EC-4, EC-5).
  - **Tests** follow the [ProjectContextView.test.tsx](client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.test.tsx) harness. Mock `@/components/app-shell`, `@/providers/repo-context`, `@/providers/toast`, `@/lib/hooks/onboarding` and `@/components/mermaid-diagram`, and stub `Element.prototype.scrollIntoView`. Cases:
    - **AC-2:** "Onboarding for payments-api"; the subtitle has "42 files" and "AI-generated · openrouter/deepseek/deepseek-v4-flash"; five section buttons in order, all `aria-expanded="true"`.
    - **AC-3:** collapsing one leaves the other four expanded.
    - **AC-4:** On this page re-expands Architecture and calls `scrollIntoView`.
    - **AC-14:** Share link writes `http://localhost:3000/repos/r1/tour` (jsdom origin).
    - **AC-15:** `generating: true` → Regenerate disabled with "Generating…", and the old tour is still rendered.
    - **EC-1:** `tour: null` → the empty state names all five sections, and Generate calls `mutate`.
    - **EC-4:** a timeout error shows the timeout copy and a Retry that calls `mutate`.
    - **EC-5:** the text contains "openrouter" and a link `href="/settings/api-keys"`.
    - **EC-3:** the `flag_off` copy renders.
    - **EC-9:** the stale notice renders.
    - **NFR-1:** toggling and Share link never call `mutate`.
- **Done when:** the view test passes; `client/src/app/repos/[repoId]/onboarding/` does not exist; `git diff --stat client/src/app/onboarding` is empty.
- **Verify:** `node scripts/verify.mjs client --file "client/src/app/repos/[repoId]/tour/_components/OnboardingTourView/OnboardingTourView.test.tsx"` · `node scripts/verify.mjs client --checks`

### 11. Integration (track shared)
- **Files:** `e2e/specs/15-onboarding-tour.flow.json` (new) · [`e2e/README.md`](e2e/README.md) (edit: one coverage row after `14-project-context`)
- **Do:**
  - **The flow** is a read-only copy of [14-project-context.flow.json](e2e/specs/14-project-context.flow.json):
    1. open `{BASE}/`;
    2. wait for the URL `/pulls`;
    3. wait for `networkidle`;
    4. wait for the text "Onboarding Tour";
    5. `find text "Onboarding Tour" click`;
    6. wait for the URL `/tour`;
    7. wait for `networkidle`;
    8. wait for the text "Onboarding Tour" (the crumb title).

    The seeded repo has no stored tour, so the page is in its EC-1 empty state. The flow **never** clicks Generate, so no model call is made. Its `description` says this and cites AC-1.
  - The README row reads: `15-onboarding-tour` | sidebar WORKSPACE → Onboarding Tour → `/repos/:repoId/tour` route and crumb title (no stored tour in the seed, so the empty state; no Generate click).
  - Run the full checks in both touched packages, the integration lane with Docker up, and the hermetic e2e. `06-onboarding.flow.json` (Add repository at `/onboarding`) must still pass (NFR-10, D2).
  - Confirm the step-0 mirror has not drifted.
  - Confirm `git diff --stat` touches no lock-file, nothing under `server/src/db/migrations/`, `reviewer-core/`, `server/src/modules/repo-intel/pipeline/` or `client/src/app/onboarding/`.
  - A failure found here is fixed in the owning track's files and re-verified.
- **Done when:** all commands below are green. End to end, the sidebar opens `/repos/:id/tour`, which reads `GET /repos/:id/onboarding`. The integration test proves the generate → store → read path with one call, grounding, the lock and stale; the view test proves the rendering.
- **Verify:** `node scripts/verify.mjs server client` · `node scripts/verify.mjs server --it` · `./scripts/e2e.sh`

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic: `contracts.test.ts`, `repo-intel-critical-paths.test.ts` (NFR-2 chains), `onboarding-helpers.test.ts` (AC-7, AC-8 selection, AC-16 amended, EC-3 reasons, EC-7 diagram cap, EC-9, NFR-3 budget, NFR-5 env rule, A8 caps), `onboarding-files.test.ts` (NFR-5 reader, traversal guard), `onboarding-service.test.ts` (AC-5, AC-7, EC-3, EC-4, EC-5, EC-6, NFR-1, NFR-8, NFR-9) |
| server | `node scripts/verify.mjs server --it` | `onboarding.it.test.ts`: AC-5, AC-6, AC-8, AC-16 (amended), AC-17, EC-1 (API), EC-2, EC-3, EC-4, EC-5, EC-6, EC-9, EC-12, NFR-1, NFR-2, NFR-4, NFR-5, NFR-11, identity/body 404/422 |
| client | `node scripts/verify.mjs client` | lint · typecheck · AC-1 (unit: `/repos/:repoId/tour` entry + active key), AC-2, AC-3, AC-4, AC-6 display, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-17 display, EC-1, EC-3/EC-4/EC-5 display, EC-7, EC-8, EC-9 display, EC-10, EC-11, NFR-1, NFR-7 |
| e2e | `./scripts/e2e.sh` | AC-1 (`15-onboarding-tour` → `/tour`), NFR-10 (`06-onboarding` at `/onboarding` still green) |
| static | review of `messages/en/onboarding.json` usage + the step-0 mirror diff | NFR-6, NFR-10 |

## Risks & rollback
- **The in-process lock is per API process (D3).** Two API processes on one DB could run two generations for a repo. The app documents a single instance ([server/src/app.ts:78](server/src/app.ts:78)) · rollback: none needed. A DB lock is a follow-up if multi-instance ever lands.
- **The 120 s race does not cancel the HTTP request (D4).** A timed-out call can still finish and bill, and its result is discarded. The log line records `outcome: 'timeout'` · rollback: n/a. An abortable provider port is a reviewer-core follow-up.
- **The page segment and the API segment differ** (`/tour` vs `/onboarding`, D2). An implementer copying one into the other is the likely slip. Step 6's hooks call `/repos/${repoId}/onboarding`; steps 7, 8, 10 and 11 use `/tour`. The step 10 *Done when* checks that no `repos/[repoId]/onboarding` page folder exists.
- **The repo-intel tiebreak changes conventions sampling order** on equal-rank files, which is harmless · rollback: revert step 1's `orderBy` line. AC-6 and NFR-2 then fail again.
- **Deleting `server/src/prompts/onboarding.system.md`** · rollback: `git checkout` the file. Nothing reads it.
- **PR size.** About 45 files is over the gate's `pr-size` WARNING threshold of 40. It is a warning only.
- **`.it` verify self-skips without Docker.** Step 11's `--it` with Docker up is the real gate.
- **A legacy row in `onboarding.json`** reads as "no tour" through step 4's `safeParse`, rather than crashing.

## Out of scope
- Spec non-goals: publishing or exporting the tour, `sync_to_folder`, an in-app source viewer, an MCP tool, non-English tours, automatic regeneration, the mockup host chrome and the other sidebar items.
- Changing repo-intel ranking or indexing. Step 1 is read-side only.
- **Follow-up (D4):** provider-SDK transport retries (OpenRouter client `maxRetries: 2`, [reviewer-core/src/llm/openrouter.ts:55](reviewer-core/src/llm/openrouter.ts:55)) and an abortable LLM call. Both are logged, not changed here.
- Any change to `client/src/app/onboarding/**` (Add repository) beyond its sidebar key no longer matching (D2).
- Promoting `github-urls.ts` to shared code (Rec 5), and a shared `timeAgo`. Both are follow-ups.
- Module README / `server/README.md` route map / `client/README.md`. Pass `--docs` to `/run-plan` for `doc-writer`.
- Seeding a demo tour.
- No track edits a file owned by another track, and neither A nor B edits the step-0 files.
- Writing or amending the spec. The AC-16 rewrite is `spec-creator`'s, in parallel; this plan only cites it.
- Architectural review and security review. Separate agents own those.
- Opening or pushing a PR. `/pr-self-review` and the gate own that.

## Open questions
- **Decided (user, 2026-10-01):**
  - D1: a path is kept if the prompt carried it (AC-16 as amended);
  - D2: the tour page is at `/repos/:repoId/tour`, `/onboarding` stays Add repository, and the API routes stay `/repos/:id/onboarding[/generate]`;
  - D3: an in-memory per-repo lock with a 10-minute stale rule and no migration;
  - D4: `maxRetries: 0` plus a 120 s service timer, with SDK retries as a follow-up.
- **Non-blocking:** the amended AC-16 text is being written by `spec-creator` in parallel. If the spec file still shows the old wording when the build starts, D1 above is authoritative, and `plan-verifier` should check against the amended text. Coordinator decides.
- **Non-blocking:** A5–A8 (task shape, the extra error codes, `reason: null` fallback, the caps) are planned as stated. Author decides.
