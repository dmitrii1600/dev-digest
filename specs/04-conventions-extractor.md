# Conventions extractor

**Status:** Implemented (2026-09-20). This is L02's second half (`specs/03-skills.md`
called it out of scope). Child specs:
[`../server/specs/03-conventions-module.md`](../server/specs/03-conventions-module.md)
and [`../client/specs/03-conventions-page.md`](../client/specs/03-conventions-page.md).
The criteria that are *not* about the extractor but still block the lab are in
[`05-skills-lab-criteria-gaps.md`](./05-skills-lab-criteria-gaps.md).

Decisions taken with the author on 2026-09-20 (recorded under *Open questions*):
extraction runs **synchronously**; accepted candidates become **one** skill
(`repo-conventions` by default); the agent(s) to bind are **picked in the modal**
(optional since 2026-09-20 — nothing preselected, an unbound skill is allowed);
an extracted skill's **rules are trusted, its evidence is wrapped**.

## Problem

An agent only knows the house rules somebody typed into a skill by hand. The
repo already *is* the rulebook — naming, layering, error handling, async style,
where tests live — but nothing reads it. This is the same move Claude Code's
`/insights` makes over a chat history: mine what already happened, propose the
rules it implies, let a human accept, reject or edit each one, and only then
turn the survivors into something an agent will follow.

The starter is, again, one wire short. `conventions` ships in `0000_init.sql`
(`rule`, `evidence_path`, `evidence_snippet`, `confidence`, `accepted`).
`ConventionCandidate` ships in `contracts/knowledge.ts`. `FeatureModelId`
already has `conventions` and **Settings → Feature Models already renders its
row** (criterion 53 is a registry entry, not new UI). `skills.source` has
`extracted` and `skills.evidence_files` exists for exactly this feature.
`repoIntel.getConventionSamples(repoId, n)` is implemented and has zero call
sites. `messages/en/conventions.json` is a partial copy deck; `activeKeyFor`
already maps `/conventions` to a nav key. `MockLLMProvider.structuredBySchema`
was written for "the conventions 2-step dialogue" — a design this spec
deliberately does not use (see *Sample selection*).

Missing: the module, the routes, the page, the nav entry, three columns, and the
seam that turns accepted candidates into a skill.

## Scope

In:

- `modules/conventions/` — extract (sync), list, accept / reject / edit, skill
  draft preview, skill creation + agent binding.
- Sample selection **in code only**: config files + `getConventionSamples(12)`.
- One structured model call through the `conventions` feature model
  (`resolveFeatureModel`), never a hardcoded model.
- Code-side evidence verification: file must be one we sampled, snippet must
  be found in it; the line is corrected to where it was actually found;
  ungrounded candidates are dropped and counted.
- Persistence that survives a restart: candidates, their status, and one row
  per scan. Rescan refreshes `pending` rows and keeps every decision.
- `/repos/:repoId/conventions` under **SKILLS LAB**: Run Scan / ReScan,
  candidate cards (rule · category · `file:line` · confidence), Accept / Reject /
  Edit (inline), Create skill (modal with editable metadata **and body**,
  agent multi-select).
- The created skill: `source: 'extracted'`, `evidence_files` filled, v1
  snapshot written, linked to the chosen agents, candidates stamped with the
  `skill_id` that absorbed them.
- Seed: three demo candidates + one finished scan for `acme/payments-api`, so
  the page is not empty on a fresh clone and `e2e/` has something to read.
- A cheaper registry default for the `conventions` feature model.

Out:

- **Splitting accepted candidates into several skills.** One skill; the
  category headings inside its body are the split. Listed under *Product
  improvements* as the obvious next step.
- **Async extraction through `JobRunner`.** A scan is one ~15–40 s request;
  the "Scanning…" state lives in component state, the result lives in the DB.
- **Any change to `assemblePrompt`, `INJECTION_GUARD` or `grounding.ts`.** The
  only engine-adjacent change is one line in `run-executor.buildSkillBlocks`
  (which body sources get the outer `<untrusted>` wrap) — that file is
  server-side, not `reviewer-core`.
- **The model choosing which files to read.** `structuredBySchema` stays as it
  is; the `ConventionFileSelection` step it anticipated is not built.
- **Restoring a rejected candidate.** Rejected rows are tombstones. The page
  shows how many are hidden; bringing one back is a later click.
- **Automating the "does the skill change the review" check.** Same reason as
  `docs/skills-control-experiment.md`: it needs a model. One more fixture is
  appended to that runbook.

## Contract

### Schema — one generated migration (`pnpm db:generate`, never hand-named)

`conventions` gains what a decision workflow needs and the starter left out:

| Column | Type | Why |
|---|---|---|
| `category` | `text NOT NULL DEFAULT 'other'` | criterion 40; groups the skill body; badge on the card |
| `status` | `text NOT NULL DEFAULT 'pending'` — `pending \| accepted \| rejected` (enum in Drizzle + Zod only, like `skills.source`) | criterion 48 needs *rejected* to be a state, not the absence of *accepted* |
| `evidence_line` | `integer` nullable | the line the snippet was **found** on, not the one the model claimed |
| `edited` | `boolean NOT NULL DEFAULT false` | "edited" badge; the original text is not kept |
| `skill_id` | `uuid` nullable, `REFERENCES skills(id) ON DELETE SET NULL` | "In skill" badge; the modal excludes candidates already absorbed |
| `scan_id` | `uuid` nullable, `REFERENCES convention_scans(id) ON DELETE SET NULL` | which scan produced the row |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | the table shipped with no timestamps |

`accepted boolean` is **dropped** in the same migration. Two columns describing
one state is how they drift; the table has always been empty, so there is no
data to carry. Indexes: `conventions_repo_idx (repo_id)` and
`conventions_ws_idx (workspace_id)` — both are unindexed FKs (see the 2026-09-18
note in `server/INSIGHTS.md`).

New table `convention_scans` — one row per extraction, the thing "last scan 1h
ago · 14 sample files · 3 dropped" and Run Scan vs ReScan are read from. A scan
that grounded zero candidates must still count as a scan:

```
id, workspace_id, repo_id, status ('running' | 'done' | 'failed'),
provider, model, sampled_files jsonb (string[]),
candidates_total, candidates_grounded, dropped_ungrounded, dropped_duplicate,
tokens_in, tokens_out, cost_usd (nullable — unknown ≠ free), error (nullable),
started_at, finished_at (nullable)
```

**Why a new table when spec 03 refused one.** Spec 03 refused tables that
`0000_init.sql` already provided. Nothing in the schema records a scan, and
without a record the page cannot tell "never scanned" from "scanned, everything
rejected", which is exactly the Run Scan / ReScan split criterion 45 asks for.

### Contracts (`server/src/vendor/shared`, mirrored into `client/src/vendor/shared` in the same change)

```ts
ConventionCategory = z.enum(['naming','structure','imports','typing','async',
                             'error_handling','testing','api','style','other'])
ConventionStatus   = z.enum(['pending','accepted','rejected'])

ConventionCandidate = {
  id, repo_id, category: ConventionCategory, rule: string,
  evidence_path: string, evidence_line: int.nullish(), evidence_snippet: string,
  confidence: 0..1, status: ConventionStatus, edited: boolean,
  skill_id: string.nullish(), created_at: string
}
ConventionScan = {
  id, repo_id, status, provider, model, sampled_files: string[],
  candidates_total, candidates_grounded, dropped_ungrounded, dropped_duplicate,
  tokens_in, tokens_out, cost_usd: nullable, error: nullish,
  started_at, finished_at: nullish
}
ConventionsPage      = { scan: ConventionScan.nullable(), candidates: ConventionCandidate[],
                         rejected_count: int }
ConventionSkillDraft = { name, description, type: SkillType, body,
                         evidence_files: string[], candidate_ids: string[] }
```

`ConventionCandidate` replaces the existing shape (drops `accepted`, adds the
rest). It has no consumer yet, so this is not a breaking change to anything.
The category is a closed enum on purpose: strict `json_schema` output needs it,
and the card needs a colour map (`CONVENTION_CATEGORY_COLOR` next to
`SKILL_TYPE_COLOR` in `client/src/lib/skill-tokens.ts` — one map, not a
fourth copy of a colour table).

### Routes — `modules/conventions/routes.ts`

```
GET    /repos/:id/conventions                 → ConventionsPage      pending + accepted, newest scan first
POST   /repos/:id/conventions/extract         → ConventionsPage      sync; 409 scan_running; 422 repo_not_cloned / repo_not_indexed
PATCH  /repos/:id/conventions/:candidateId    → ConventionCandidate  { status? | rule? | category? }
POST   /repos/:id/conventions/skill/preview   → ConventionSkillDraft { candidate_ids? }   writes nothing
POST   /repos/:id/conventions/skill           → { skill_id }  201   { name?, description?, type?, body?, enabled?,
                                                                      agent_ids: string[], candidate_ids? }
```

Create returns only the id: the client navigates to `/skills/:id`, and the
skills DTO mapper lives in another module folder that `no-cross-module-reach-in`
forbids importing. `resolveFeatureModel` moves to `modules/_shared/` for the
same rule — details in the server child spec.

Shapes and the per-route rules are in the server child spec.

### Sample selection — pure code, no model (criterion 39)

1. **Configs.** A fixed list looked up in the clone root **and one directory
   down** (this repo keeps `eslint.config.mjs` / `tsconfig.json` per package):
   `eslint.config.{js,mjs,cjs}`, `.eslintrc*`, `tsconfig.json`, `.prettierrc*`,
   `prettier.config.*`, `.editorconfig`, `package.json`. Each capped at
   `MAX_CONFIG_CHARS`. Configs are context for what a linter **already**
   enforces, so the model can leave those rules out — see the prompt.
2. **Code.** `repoIntel.getConventionSamples(repoId, 12)` — top-ranked files
   minus tests / configs / migrations, exactly as the facade already filters.
3. **Read** through one guarded helper: resolved path must stay inside
   `repos.clone_path`; missing or binary files are skipped; a file over
   `MAX_SAMPLE_LINES` is truncated with a `… (truncated)` marker.
4. **Number every line** (`23: const user = …`). This is what makes a citation
   checkable; without it the model guesses line numbers.
5. **Budget** with `container.tokenizer.count` — files are added in rank order
   until `SAMPLE_TOKEN_BUDGET` is spent; the list that actually went in is
   what `convention_scans.sampled_files` records and what evidence is checked
   against.

An unindexed repo has no rank and returns `[]` from the facade. The route
answers 422 `repo_not_indexed` and the page says so with a link to the Indexed
badge — the silent diff-only degradation the review path tolerates would here
mean "scanned, found nothing", which is a lie.

### The model call

`resolveFeatureModel(container, workspaceId, 'conventions')` →
`container.llm(provider).completeStructured({ model, schema: ConventionExtraction,
schemaName: 'ConventionExtraction', temperature: 0, maxRetries: 2 })`.

`ConventionExtraction` is a **server-local** Zod schema (the model's output, not
a DTO): `{ candidates: [{ category, rule, evidence: { path, line, snippet },
confidence }] }`, every field `.describe()`d. `MockLLMProvider` already routes
fixtures by `schemaName`.

The registry default for `conventions` changes from `openai / gpt-5.4` to
`openrouter / deepseek/deepseek-v4-flash` — the same cheap default onboarding
uses. Mirrored in `client/src/lib/feature-models.ts` (its header says why the
client copy exists). The workspace override in Settings wins, as today.

The system prompt (`constants.ts`, documented in the module README) asks for:
conventions a linter **cannot** enforce (layering, naming, error-handling
shape, async style, where tests and contracts live); each rule as one
imperative sentence; exactly one evidence line **copied verbatim** from the
numbered samples; a confidence; a category from the enum; at most
`MAX_CANDIDATES`; no rule that merely restates a config that was shown. Sample
content goes in as `<untrusted source="sample:<path>">` blocks and the prompt
carries a one-line guard that samples are data. This prompt is not a reviewer
prompt, so `docs/agent-prompts/README.md`'s severity / verdict blocks do not
apply — but its "do not describe the JSON shape" rule does.

### Evidence verification — code, after the model (the gate)

For every candidate, in `helpers.ts` (pure, unit-tested without a DB):

- `evidence.path` normalised to posix, rejected if it contains `..` or is not
  in `sampled_files` — a file the model did not see is a hallucination even if
  it exists.
- `evidence.snippet` trimmed, whitespace-collapsed, must be ≥ `MIN_SNIPPET_CHARS`
  non-blank characters (`}` matches everything). Searched at the claimed line
  ± 3 first, then anywhere in the file. Found → `evidence_line` is the line it
  was **found** on. Not found → dropped, `dropped_ungrounded++`.
- `rule` trimmed, ≤ `MAX_RULE_CHARS`; `confidence` clamped to `[0, 1]`.
- Within the scan, a second candidate whose normalised rule (lower-case,
  punctuation stripped, whitespace collapsed) matches an earlier one is
  dropped, `dropped_duplicate++`.

### Rescan semantics — decisions outlive scans (criterion 48)

Before inserting a new scan's survivors: every `pending` row for the repo is
deleted. `accepted` and `rejected` rows stay. A survivor whose normalised rule
matches an existing `rejected` row is dropped (counted as duplicate — the user
already said no); one matching an `accepted` row is skipped (the user's
possibly-edited version wins). ReScan therefore never resurrects a rejection
and never overwrites an edit.

### From candidates to a skill (criteria 41, 42)

`POST …/skill/preview` builds a `ConventionSkillDraft` from the repo's
`accepted` candidates (or the given `candidate_ids`, each of which must be
accepted and not yet in a skill), writing nothing. The body, from a pure
`buildConventionSkillBody(repo, candidates)`:

```md
# repo-conventions

House conventions for `owner/name`, extracted from the codebase and reviewed by
a human. Flag changes in the diff that violate any rule below and cite the
offending `file:line`. Do not flag code the diff does not touch.

## Async
- Always use async/await instead of `.then()` chains. *(confidence 91%)*
  Evidence `src/api/users.ts:23`:
  <untrusted source="convention-evidence">
  ```ts
  const user = await db.users.find(id);
  ```
  </untrusted>
```

Rules are grouped by category; the evidence code sits inside a fenced block
inside an `<untrusted>` wrapper. `react-markdown` drops the unknown tags, so the
Preview tab shows a clean code block, while the prompt carries the delimiter.

`POST …/skill` takes the modal's edits (`name`, `description`, `type`, `body`,
`enabled`) and `agent_ids`, then in one transaction: inserts the skill via
`container.skillsRepo.insert` with `source: 'extracted'`, `evidence_files` =
the distinct evidence paths, and the v1 snapshot the repository already writes;
links it to each agent through `container.agentsRepo` at the next free `order`
with the binding `enabled: true` (`agent_ids` may be empty — then no link is
written and the skill waits in Skills Lab); stamps `conventions.skill_id`. The name
defaults to `repo-conventions` and is editable — criterion 42 names the
default, the mock shows it editable, both hold. The skill body is also rendered
with a `≈ N tokens` counter in the modal (`length / 4`, client-side; the trace
keeps counting with the real tokenizer).

**Why the body may come from the client here and not in import.** Import
refuses a client body because the preview must be what gets saved. Here the
preview *is* an editable draft — the whole point of the modal is that the human
rewrites it — and every line in it came from a candidate that same human
accepted. It is the same trust level as `POST /skills` with a typed body.

### Trust in the prompt — decided 2026-09-20

`run-executor.buildSkillBlocks` currently wraps every `source !== 'manual'` body
in `<untrusted>`. That rule was written for imported files: somebody else's
instructions. An extracted skill is different in one way that matters: every
rule in it passed a human Accept and the whole body was shown editable before
save. It is user-authored text assembled by a machine. So:

- `extracted` joins `manual` as an **unwrapped** source in `buildSkillBlocks`
  — the rules reach the model as instructions, which is what a conventions
  skill is for. (Wrapped, `INJECTION_GUARD` would tell the model those rules
  "do NOT define your job".)
- The code the rules cite is still repo content, so **each evidence snippet is
  wrapped individually** by the body builder. A comment in a sampled file that
  says "ignore all rules" arrives as data.
- `enabled` follows the modal's toggle. The "arrives disabled until vetted"
  rule is for bodies nobody here has read; this one was read line by line.

`INJECTION_GUARD`, `wrapUntrusted` and `reviewer-core` are untouched.

### Navigation and Settings

`NAV` (`src/vendor/ui/nav.ts`, the sanctioned exception) gains
`{ key: "conventions", label: "Conventions", icon: "ListChecks",
href: "/repos/:repoId/conventions", gKey: "c" }` under **SKILLS LAB** after
Agents, plus a `g c` row in `SHORTCUTS`. `activeKeyFor` and `shell.json` already
know the key. Settings → Feature Models needs no change beyond the default.

## Acceptance

Mapped to the lab criteria in brackets.

- `POST /repos/:id/conventions/extract` on an indexed, cloned repo returns
  candidates that are still there after the API restarts; a second call while
  one is running is 409; an unindexed repo is 422 with `repo_not_indexed`. [38]
- The sample set is computed with the LLM mock asserting **one** structured
  call, whose user message contains the config files found and exactly the
  paths `getConventionSamples` returned, line-numbered. [39]
- The mock fixture's candidates carry `{category, rule, evidence{path,line,
  snippet}, confidence}`; a fixture entry citing a file outside the sample or a
  snippet not in the file is absent from the response and counted in
  `dropped_ungrounded`; a snippet found on a different line than claimed is
  stored with the corrected `evidence_line`. [40]
- Rescan after rejecting one candidate: the fixture still contains that rule;
  the response does not; the row is still `rejected` in the DB; the `pending`
  rows from the first scan are gone; an `accepted` one survives untouched. [48]
- `PATCH` with `rule` sets `edited: true` and leaves evidence alone; `PATCH`
  with `status: 'accepted'` then a skill preview includes that rule under its
  category heading with its evidence wrapped; a rejected id in `candidate_ids`
  is 422. [47, 49, 41]
- `POST …/skill` creates a skill with `source: 'extracted'`, `evidence_files`
  equal to the distinct evidence paths, `skills.version = 1`, one
  `skill_versions` row, one `agent_skills` row per `agent_id` with the next
  `order` and `enabled: true`; each used candidate has `skill_id` set; the
  skill appears in `GET /skills`. [42, 52]
- A review run for an agent carrying the extracted skill shows a **Skills**
  block in the trace whose text contains the rule **unwrapped** and the evidence
  **inside** `<untrusted source="convention-evidence">`; a `manual` skill is
  unwrapped; an `imported_file` skill is still wrapped whole. [19, 20 + trust]
- The sidebar shows **Conventions** under SKILLS LAB; `g c` reaches it. [44]
- On the page: no scan → **Run Scan** and the empty state; a finished scan →
  **ReScan** and "Detected from N sample files · last scan …"; every card shows
  rule, `file:line`, confidence %, and Accept / Reject / Edit; Edit is inline;
  **Create skill** appears once at least one candidate is accepted. [45, 46,
  47, 49, 50]
- The Create-skill modal says it is built from N accepted conventions of the
  repo, has Name / Description / Type / Enabled / Agents / Body, and Cancel /
  Create; Body is a textarea, not read-only. [41, 51]
- Settings → Models has the Conventions row with a searchable model picker;
  changing it changes the `model` the mock receives on the next extract. [53]
- Covered by `server/test/conventions-helpers.test.ts` (sampling, grounding,
  dedupe, body builder — hermetic), `server/test/conventions.it.test.ts`
  (routes end-to-end with `MockLLMProvider` + `structuredBySchema`, real
  Postgres, `.it.` mandatory), `server/test/prompt-skills.test.ts` (the wrap
  rule gains the `extracted` case), the three client component tests, and
  `e2e/specs/10-conventions.flow.json` reading the seeded scan. All package
  checks (`lint`, `typecheck`, `arch`, `test`, client `build`) stay green.

## Implementation order

Four PRs, each green on its own and each reviewable in one sitting. The first
two have no UI and can be merged before a pixel exists.

1. **Schema + contracts + registry default.** Drizzle edits, `pnpm db:generate`,
   `ConventionCandidate` / `ConventionScan` / `ConventionsPage` /
   `ConventionSkillDraft` in both shared copies, `ConventionCategory` +
   `ConventionStatus`, the cheaper `conventions` default mirrored in
   `client/src/lib/feature-models.ts`, `feature-models.ts` moved to
   `modules/_shared/`, `db/rows.ts`, seed. Tests: `contracts.test.ts`,
   `settings-models.it.test.ts` still green.
2. **Module without the skill step.** `helpers.ts` + `conventions-helpers.test.ts`
   first (pure, fast to iterate), then repository, service `extract` /
   `page` / `updateCandidate`, routes for GET / extract / PATCH, README,
   `conventions.it.test.ts` for those routes. `pnpm arch` must pass here — it
   is the first time a module reads `_shared/feature-models`.
3. **Skill step + trust rule.** `buildConventionSkillBody`, preview + create
   routes, the `TRUSTED_SKILL_SOURCES` line in `run-executor.ts`,
   `prompt-skills.test.ts`, README paragraph fix, runbook fixture. Verify with
   a real review run that the trace's Skills block carries the rules unwrapped
   and the evidence wrapped — this is the one step that needs a model key.
4. **Studio.** Hooks, the three components with tests, NAV + shortcut, copy
   deck, `10-conventions.flow.json`, `pnpm build`. Then `/pr-self-review`.

[`05-skills-lab-criteria-gaps.md`](./05-skills-lab-criteria-gaps.md) is
independent and can land before, between or after these.

## Product improvements — how to get more, and better, findings

The lab's extra question. Ordered by value per effort; the first three are the
ones worth building next, the rest are noted so they are not rediscovered.

1. **Measure a rule instead of trusting the model's confidence.** For each
   candidate, ask the model for a *positive* and a *negative* `ast-grep` (or
   ripgrep) pattern alongside the rule (`container.codeIndex.grep` and the
   ast-grep adapter already exist). Run both over the repo, store
   `adherence = pos / (pos + neg)` and the counter-example file:line list.
   The card then reads *"followed in 41 of 43 places"* and the two violators
   are shown — that is evidence a reviewer can act on, and rules under a
   threshold become *aspirational* rather than *house*. The model's
   self-reported confidence is as untrustworthy here as its `score` is in a
   review.
2. **Config-derived candidates with no model at all.** `prettier` (semi,
   quotes, width), `tsconfig` (`strict`, `noUncheckedIndexedAccess`,
   `verbatimModuleSyntax`), `eslint` rule names and `no-restricted-imports`
   groups are conventions with confidence 1.0 and evidence `file:line` for
   free. Emit them as a separate `lint-enforced` tier — useful for a human
   reading the page, but **default-unchecked** for the skill: an LLM reviewer
   should spend its attention on what the linter cannot see, which is the
   philosophy this repo's own `AGENTS.md` states about its lint config.
3. **Stratify the sample.** Top-12 by PageRank on a multi-package repo returns
   twelve files from the package with the most imports. Take the top-N per
   top-level directory (`server/`, `client/`, `reviewer-core/`) with a floor,
   and add one test file and one migration on purpose — "tests live next to
   the component and share its name" is a convention you only see by sampling
   a test.
4. **Declared vs observed.** Feed `README.md` / `AGENTS.md` / `CONTRIBUTING.md`
   as a separate *declared* section and ask the model to label each candidate
   `declared`, `observed` or `contradicted`. A contradiction ("the docs say X,
   the code does Y in 9 of 12 files") is the single most valuable finding a
   convention scan can produce.
5. **Rescan diff.** Show *new · unchanged · gone* against the previous scan
   instead of a flat list; a rule that shows up three scans in a row deserves
   a confidence bump; one that vanished after a refactor should say so.
6. **Split by category into several skills** (declined for this lesson): a
   `security` category → `security`-typed skill bound to the Security
   Reviewer, `testing` → Test Quality Reviewer. The body builder already
   groups by category; this is one loop and a per-category type map.
7. **Mine review history.** Accepted findings on past PRs are conventions the
   team enforces by hand; once memory (L05+) exists, feed the accepted
   findings' rationale as a third sample source.
8. **Let the user aim the scan** — a focus chip row (naming / structure /
   error handling / testing / all) that narrows the category list sent to the
   model; fewer categories → more depth per category for the same tokens.

## Open questions

- Sync or `JobRunner`? **Resolved 2026-09-20: sync.** One route, one `.it`
  test, no polling; the page owns the "Scanning…" state. Revisit if a real
  scan exceeds the CORS-side fetch patience (~60 s) on a large sample.
- One skill or many? **Resolved: one**, named `repo-conventions` by default and
  editable; category headings inside the body. Splitting is improvement 6.
- Which agent gets the skill? **Resolved: the user picks** in the modal
  (multi-select, General Reviewer preselected). Nothing is bound silently.
- Trusted or wrapped? **Resolved: rules trusted, evidence wrapped**, and
  `enabled` follows the modal. Rationale under *Trust in the prompt*.
- Criterion 21 says the **git-push auto-invocation of `pr-self-review` is
  off** and the skill is run by hand on a mixed `client/` + `server/` diff.
  This repo currently enables both the Claude Code `PreToolUse` gate and
  `.githooks/pre-push`. Keeping the `PreToolUse` half (it blocks `git push`
  from a Claude Code session, which is where the skill runs) and making the git
  hook opt-in would satisfy the reading; dropping the gate entirely would
  contradict `AGENTS.md`. **Unresolved — author's call**, tracked in spec 05.
