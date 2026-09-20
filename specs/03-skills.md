# Skills in the product

**Status:** Implemented. This is the agreed shape of lesson L02's first half.
Child specs:
[`../server/specs/02-skills-module.md`](../server/specs/02-skills-module.md) and
[`../client/specs/02-skills-lab.md`](../client/specs/02-skills-lab.md). The
Conventions extractor (L02's second half) is out of scope here — it is
specified in [`04-conventions-extractor.md`](./04-conventions-extractor.md).

## Problem

An agent is a system prompt plus a model. A rule that three reviewers should all
apply — the house test-quality bar, the API-contract convention — has to be
copied by hand into three `system_prompt` values and re-copied on every edit.
Nothing can be written once, nothing can be brought in from outside, and nothing
in the run trace says *which* rule was in the prompt.

The starter is already built for the answer and deliberately stops one wire
short. `skills`, `skill_versions` and `agent_skills` ship in `0000_init.sql`.
`Skill`, `SkillType`, `SkillSource` and `AgentSkillLink` ship in
`contracts/knowledge.ts`. `AgentsRepository` implements `linkedSkills` /
`linkSkill` / `unlinkSkill` / `setSkills` with **zero call sites**.
`reviewer-core` accepts `PromptParts.skills` and renders a `## Skills / rules`
section. `PromptAssembly.skills` exists and `TraceBody` already renders a Skills
prompt block. `messages/en/skills.json` is a complete, unused copy deck.

`run-executor.ts` never passes `skills` to `reviewPullRequest`, so the section is
always omitted and every one of those pieces sits dark.

This is the first half of L02 (`README.md` — "Skills in the product · Conventions
extractor"). The extractor is the second half.

> Not to be confused with `.claude/skills/**` and the root `skills-lock.json`,
> which are Claude Code authoring skills — a different thing that shares the word.

## Scope

In:

- A `skills` module: CRUD, immutable body versions, restore, per-skill usage
  stats, and import from a `.md` file or a `.zip` archive.
- Agent binding: attach, detach, enable per binding, reorder. Order is the order
  of the blocks in the assembled prompt.
- Resolving an agent's enabled skills to bodies at review time and passing them
  through the prompt slot that already exists.
- Delimiter-wrapping the body of any skill whose `source` is not `manual`.
- A Skills Lab page and a Skills tab in the agent editor.
- Two new seeded agents — Test Quality Reviewer, API Contract Reviewer — with
  skills bound, at least one of them arriving through the import path.
- **Added 2026-09-20:** import from a URL (`POST /skills/import/url(/preview)`)
  through a guarded `UrlFetcher` port, and a heuristic **injection scan** of
  every `imported_*` body that blocks enabling until the body is edited clean.

Out:

- **New tables.** All three ship in `0000_init.sql`. One generated migration adds
  two columns and one index to them; nothing is created.
- **Changes to `assemblePrompt`.** The slot, the section heading, the ordering
  and the omit-when-empty behaviour are already correct. Feeding a slot is not
  changing the engine.
- **Changes to the run-trace drawer.** `TraceBody` renders
  `prompt_assembly.skills` the moment the server sends one.
- **The Conventions extractor** — `source: 'extracted'`, `evidence_files`, and
  `repoIntel.getConventionSamples`. Same lesson, separate feature.
- **The community catalog.** Its strings were dropped from `skills.json`
  on 2026-09-20; it is a later lesson. (URL import moved to *In* the same day.)
- **An Evals tab**, on a skill or on an agent. Eval is L06.
- **Per-agent performance.** L08. One exception is called out in the client spec.
- **Automating the control experiment.** It needs a real model call; `e2e/` is
  model-free by design. It ships as a runbook.

## Contract

**Schema** — one generated migration (`pnpm db:generate`, never hand-named):

- `agent_skills.enabled boolean NOT NULL DEFAULT true`.
- `skill_versions.note text` — nullable; the author's one-line "what changed".
- `skills_ws_idx` on `skills.workspace_id`, the index `agents` already got in
  `0011`.

**Why a per-binding `enabled`.** Disabled and unlinked are different states. The
agent editor turns a skill off without losing its position in the order; without
the column that would mean unlinking and silently renumbering every sibling.

`skills.source` gains `imported_file`. The column is plain `text` with no CHECK
constraint — the enum lives only in the Drizzle type and the Zod contract — so
this is a code-only change. `imported_url` would be a lie for an upload.

**Contracts** (`server/src/vendor/shared`, mirrored into
`client/src/vendor/shared` in the same change — the client copy is already behind
and loses `AgentVersionConfig` and `AgentVersion`):

- `SkillVersion` — `{ skill_id, version, body, note: nullish, created_at }`.
- `AgentSkillLink` gains `enabled: boolean`.
- `SkillImportEntry` / `SkillImportPreview` — what an upload parsed to, including
  every archive member that was discarded and why.
- `SkillStats` — `{ agents, runs_30d, findings_30d, accepted, dismissed,
  accept_rate: nullable, by_category[] }`.
- `RunTrace.prompt_tokens: PromptTokens.nullish()` — per-slot token counts.
  `.nullish()` because persisted traces predate the field.

**Routes** — a new `modules/skills/` plugin, plus two missing halves of the
existing agent-link API. Shapes in
[`../server/specs/02-skills-module.md`](../server/specs/02-skills-module.md).

**The prompt.** `blocksForAgent(agentId)` returns rows where `skills.enabled AND
agent_skills.enabled`, ordered by `agent_skills.order`. Bodies are spread into
`reviewPullRequest` with the same omit-when-empty idiom as `callers` and
`repoMap`, so an agent with no skills assembles a byte-identical prompt.

**Why the server wraps untrusted bodies, not the engine.** `prompt.ts:88` joins
skill bodies raw and says community skills "should be sanitized upstream", while
`prompt.ts:6` declares all external content untrusted and `preview.untrustedNotice`
promises the user the body is stored delimiter-wrapped. That gap closes here, on
the server, because the server is where provenance lives: `reviewer-core` receives
resolved strings and teaching it about `SkillSource` would push a database concept
into a pure package. `wrapUntrusted` is already exported. `INJECTION_GUARD` is not
touched — it already covers everything inside `<untrusted>…</untrusted>`.

**Why an imported skill lands disabled.** It is someone else's instructions
arriving inside our agent's prompt. `enabled: false` on insert for any
`source !== 'manual'`, which is what the copy deck already promises:
*"Disabled until you vet + enable it."*

**A skill body is prompt text and obeys prompt rules.** It is appended to the
user message, so `docs/agent-prompts/README.md` binds it: no description of the
JSON output shape (enforced out of band by `response_format: json_schema`), and
no second severity scale.

**Import is two steps and the second one re-parses.** `POST /skills/import/preview`
writes nothing. `POST /skills/import` re-runs the same deterministic parse over
the same bytes and accepts only `name` / `description` / `type` from the client —
never a body. A caller cannot preview one thing and save another. Extraction is
in memory; nothing is written to disk and nothing is executed.

**URL import is the same two steps with a fetch in front (2026-09-20).**
`POST /skills/import/url/preview { url }` and `POST /skills/import/url { url,
name?, description?, type? }` both fetch through `container.urlFetcher` — a
port in `@devdigest/shared`, never a bare `fetch` in a service — and hand the
bytes to the same `parseImport`, stamped `imported_url`. Commit re-fetches
rather than trusting the preview. The adapter (`adapters/url-fetcher/`) owns
the safety rules: http(s) only, no `localhost`/`.local`/`.internal`, no
loopback / private / link-local / unique-local / CGNAT address (literal **or**
resolved — every DNS answer is checked), at most three redirects each re-run
through the guard, a 10 s timeout, `content-length` checked before reading and
the body streamed and aborted past the 1 MiB import cap. `text/html` is refused
with a message that says to link the raw file. Known gap, accepted: DNS is
resolved before `fetch` resolves it again, so a rebinding host has a window;
pinning would need a custom dispatcher.

**The injection scan is a vetting gate, not the prompt defence.** Every
`imported_url` / `imported_file` body is run through `modules/skills/injection-scan.ts`
— seven high-signal line patterns (instruction override, role/system markers,
system-prompt exfiltration, data exfiltration via links/`curl`, zero-width and
bidi characters, a forged `<untrusted>` delimiter, "do not tell the user") —
**on every read**: the `Skill` and `SkillImportPreview` DTOs carry
`security: { status: clean | flagged | not_scanned, findings: [{ rule, line,
excerpt }] }`, never persisted, so editing the line clears the flag with no
state to keep in sync. `manual` and `extracted` bodies are `not_scanned`: the
user wrote or accepted them. The gate: `PUT /skills/:id` that would leave a
scanned skill enabled with a flagged body is a 422 carrying the findings
(`restore` onto a flagged snapshot likewise); import still lands (disabled,
as always) so the user can read and fix it. Prompt-time wrapping and
`INJECTION_GUARD` are untouched — a flagged-then-fixed imported skill is
still `<untrusted>`-wrapped when it runs. Keyword scanning is deliberately
**not** how the prompt is protected (`reviewer-core/src/prompt.ts`); this scan
only decides what the user is told and what may be switched on.

## Acceptance

- An agent with no skills linked produces a prompt byte-identical to today's. The
  three starter agents are unaffected until someone attaches something.
- Attaching two skills puts both bodies in the `## Skills / rules` section, in
  `agent_skills.order`, between `## PR description` and `## Relevant memory`.
- Disabling one binding removes exactly that block; disabling the skill globally
  removes it for every agent. Neither is the same as unlinking, and the order of
  the rest is unchanged.
- The run trace shows a **Skills (dynamic)** block with its token count, and the
  run log carries `skills: N skill(s) attached`. With nothing attached, no block.
- A skill whose `source` is not `manual` appears inside `<untrusted>` delimiters
  in the assembled prompt. A `manual` one does not.
- Saving a changed body creates a new immutable version; renaming one or toggling
  `enabled` does not. Restore appends the old body as a new version — history is
  never rewritten.
- Reordering an agent's skills preserves every per-binding `enabled` flag.
- Importing a `.zip` shows a preview naming every discarded member with a reason
  before anything is written, and nothing in the archive is executed. An archive
  with a traversal path, a symlink, too many entries, an oversized member or a
  compression bomb is rejected with a stated reason.
- An imported skill is stored disabled and shows the "needs vetting" badge.
- `POST /skills/import/url` with `http://127.0.0.1:3001/health`, a `10.x`
  host, a link-local address or a redirect into one is a 422 and nothing is
  fetched past the guard; a raw `.md` URL previews and lands `imported_url`,
  disabled.
- A body containing `Ignore all previous instructions` previews as `flagged`
  with rule `instruction_override` and its line; enabling it is a 422 whose
  `details.findings` names the line; saving a clean body and enabling
  succeeds. A `manual` skill with the same text is `not_scanned` and enables.
- Stats never claim per-skill attribution: every number counts the runs of the
  agents the skill is attached to, and the UI says so.
- Covered by `server/test/skills.it.test.ts`, `server/test/agent-skills.it.test.ts`
  (real Postgres, `.it.` suffix mandatory), `server/test/skills-import.test.ts`,
  `server/test/skills-injection-scan.test.ts`, `server/test/url-fetcher.test.ts`,
  `server/test/skills-service.test.ts` (the enable gate and URL import on an
  in-memory repository — the service takes `container.skillsRepo`, which is
  what makes that possible), `server/test/prompt-skills.test.ts`, the client
  component tests, and
  `e2e/specs/09-skills.flow.json`. `skills-resolve.test.ts` was planned as a
  standalone hermetic file but folded into `skills.it.test.ts` instead — there
  is no precedent anywhere in this codebase for hermetically faking a chained
  Drizzle query builder, and every other repository-layer test that touches a
  real query goes through testcontainers.

## Open questions

- Stats attribute findings to the agents a skill is *currently* attached to, so a
  detach rewrites history. `agent_versions.config.skills` plus the agent version
  recorded in `run_traces.trace.config.version` would give exact per-run
  attribution. Worth the jsonb query, or is the agent-level number with a stated
  caveat honest enough until L08 builds the performance dashboard?

  **Resolved: the agent-level number, with the caveat.** `SkillsRepository.statsFor`
  joins `agent_skills → agent_runs`/`findings` on the CURRENT link set and the
  UI states the caveat explicitly. The jsonb-history version is deferred to L08.
- The mock's sidebar has nine nav items across three groups, most of them future
  lessons. This lesson ships `SKILLS LAB` with Skills and Agents only. Do the
  remaining items appear disabled to preview the shape, or stay absent?

  **Resolved: stay absent.** `NAV` in `src/vendor/ui/nav.ts` lists only entries
  with a real page behind them — a disabled placeholder link is still a link to
  a 404 when clicked, and the mock's other two groups (WORKSPACE beyond Pull
  Requests, GLOBAL) arrive with their own lessons.
