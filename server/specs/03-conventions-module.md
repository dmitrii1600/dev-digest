# Conventions module (API)

**Status:** Implemented (2026-09-20). The cross-package spec is
[`../../specs/04-conventions-extractor.md`](../../specs/04-conventions-extractor.md);
this one covers only `@devdigest/api`.

## Problem

A table, a contract, a feature-model id and a facade method exist for a feature
no route serves. `conventions` cannot hold a rejection, a category or the line
the evidence was actually found on; nothing records that a scan happened; and
`repoIntel.getConventionSamples` has never been called.

## Scope

In:

- `modules/conventions/` — `routes.ts`, `service.ts`, `repository.ts`,
  `helpers.ts`, `constants.ts`, `README.md`; one import and one entry in
  `modules/index.ts`.
- One generated migration: `conventions` gains six columns and loses one;
  `convention_scans` is created; two indexes.
- `ConventionExtraction` — the model's output schema. As built it lives in
  `vendor/shared/contracts/knowledge.ts` (both copies): ring-2 files may not
  import `zod` at runtime, and the `Review` contract sets the precedent for a
  model-output schema living with the contracts.
- One line in `modules/reviews/run-executor.ts` (`buildSkillBlocks`): the set
  of unwrapped sources becomes `manual | extracted`.
- The `conventions` registry default in `vendor/shared/contracts/platform.ts`.
- Seed: three candidates and one `done` scan for `acme/payments-api`, plus a
  `seed-conventions.ts` beside `seed-prompts.ts` so `seed.ts` stops growing.

Out:

- Any change to `reviewer-core`. `wrapUntrusted` is imported, not modified.
- A new adapter. Files are read with `node:fs/promises` inside the service the
  same way `repo-intel/service.ts` does (`readClone`); that is an established
  ring-2 exception for the clone directory, not a new port.
- `JobRunner`. Sync by decision.

## Contract

### Rings (onion — the lint zones are filename-driven)

| File | Ring | May import |
|---|---|---|
| `constants.ts` | 2 | nothing from the app |
| `helpers.ts` | 2 | `@devdigest/shared`, `reviewer-core` (`wrapUntrusted`), `constants` — **no** db, no container, **no `node:fs`** (ring-2 lint) |
| `repository-samples.ts` | 3 | `node:fs` — the clone reader (`findConfigFiles`, `readSample`, `collectSamples`); named `repository*.ts` so the lint zones put the filesystem where it belongs |
| `repository.ts` | 3 | `db/schema`, drizzle |
| `service.ts` | 2 | `Container` (type + runtime for `repoIntel`, `llm`, `tokenizer`, `skillsRepo`, `agentsRepo`, `db`), `repository`, `helpers`, `_shared/feature-models` (`resolveFeatureModel`, moved there — see below) |
| `routes.ts` | 4 | `service`, `_shared/context`, `_shared/schemas`, `platform/errors` |

`resolveFeatureModel` lives in `modules/settings/feature-models.ts`, and
`no-cross-module-reach-in` (`.dependency-cruiser.cjs`) forbids importing it from
another module folder — only `modules/_shared/**` is exempt, and the rule's own
comment says the fix for a cross-cutting helper is to move it there. So:
**move `feature-models.ts` to `modules/_shared/feature-models.ts`**, update the
two importers (`settings/routes.ts`, `test/settings-models.it.test.ts`) and
conventions imports it from `_shared`. This also fixes the 2026-09-18 insight
that the file's unconventional name left it outside every lint zone — it now
sits where `context.ts`, the other DB-reading shared helper, already lives. Do
not re-implement the lookup and do not widen the rule.

The same rule means the conventions service cannot import `toSkillDto` from
`modules/skills/helpers.ts`. It does not need to: `POST …/skill` returns
`{ skill_id }`, which is all the client uses (it navigates there; it already
knows the name it typed). Skill data is read back through the skills routes.

### Routes — `withTypeProvider<ZodTypeProvider>()`, `getContext` first, bodies local, DTOs shared

```
GET    /repos/:id/conventions                 → ConventionsPage
POST   /repos/:id/conventions/extract         → ConventionsPage   rateLimit 5/min; 409 | 422 (see below)
PATCH  /repos/:id/conventions/:candidateId    → ConventionCandidate
POST   /repos/:id/conventions/skill/preview   → ConventionSkillDraft
POST   /repos/:id/conventions/skill           → { skill_id }  201
```

Params: `RepoCandidateParams = { id: uuid, candidateId: uuid }` — copy the
`VersionParams` pattern, so a malformed id is 422, not 404. Every handler
resolves the repo through the module's own `repository.ts`
(`getRepo(workspaceId, repoId) → { id, fullName, clonePath } | undefined`, the
same shape `repo-intel/repository.ts`'s `getRepoBasics` reads — there is no
`reposRepo` on the container and the repos module may not be imported) and
throws `NotFoundError` when the repo is missing or in another workspace.

```ts
PatchCandidateBody = z.object({
  status:   ConventionStatus.optional(),
  rule:     z.string().min(1).max(MAX_RULE_CHARS).optional(),
  category: ConventionCategory.optional(),
}).refine(b => Object.keys(b).length > 0)

SkillPreviewBody = z.object({ candidate_ids: z.array(z.string().uuid()).optional() })

CreateSkillBody = z.object({
  candidate_ids: z.array(z.string().uuid()).optional(),   // default: every accepted, unabsorbed
  name:        z.string().min(1).optional(),              // default 'repo-conventions'
  description: z.string().optional(),
  type:        SkillType.optional(),                      // default 'convention'
  body:        z.string().min(1).optional(),              // default: the draft
  enabled:     z.boolean().optional(),                    // default true
  agent_ids:   z.array(z.string().uuid()),                // may be empty (2026-09-20) — bind later from the agent editor
})
```

**Extract error cases**, each an `AppError` with a stable `code` the client
branches on:

| Condition | Status | `code` |
|---|---|---|
| a `convention_scans` row for this repo is `running` | 409 | `scan_running` |
| `repos.clone_path` is null | 422 | `repo_not_cloned` |
| `getConventionSamples` returns `[]` | 422 | `repo_not_indexed` |
| provider throws | the scan row is written `failed` with `error`; rethrow → 502 via the error handler | — |

A `running` row older than `SCAN_STALE_MS` (10 min) is treated as `failed`
before the check, so a crash mid-scan does not lock the repo forever. This is
the one place sync execution needs bookkeeping.

### Service — `ConventionsService`

`extract(workspaceId, repoId)`:

1. Repo + clone path; stale-scan sweep; 409 / 422 checks above.
2. `insert scan { status: 'running', provider, model }` where `{provider,
   model} = resolveFeatureModel(container, workspaceId, 'conventions')`.
3. `collectSamples(clonePath, rankedPaths, tokenizer)` (helper) →
   `{ configs: Sample[], code: Sample[], sampledFiles: string[] }`.
4. `buildExtractionMessages(repoFullName, samples)` (helper) → `ChatMessage[]`.
5. `container.llm(provider).completeStructured({ model, schema:
   ConventionExtraction, schemaName: 'ConventionExtraction', messages,
   temperature: 0, maxRetries: 2 })`.
6. `groundCandidates(result.data.candidates, samples)` (helper) →
   `{ kept, droppedUngrounded, droppedDuplicate }`.
7. `repo.replacePending(repoId, scanId, kept, existingDecisions)` — in one
   transaction: delete `pending` for the repo; insert survivors not matching a
   `rejected` or `accepted` normalised rule; return the inserted rows.
8. `repo.finishScan(scanId, { status: 'done', counts, tokens, cost_usd,
   sampled_files })`. On any throw after step 2: `finishScan(scanId,
   { status: 'failed', error })`, then rethrow.
9. Return `page(workspaceId, repoId)`.

`page` = newest scan (any status) + candidates `WHERE status <> 'rejected'`
ordered `confidence DESC, created_at ASC` + `rejected_count`.

`updateCandidate` — status transitions are free (`pending ⇄ accepted ⇄
rejected`); a `rule` or `category` change sets `edited = true` and
`updated_at`. A candidate with `skill_id` set may still be edited or rejected
— the skill already has its copy; the row is history.

`skillDraft(workspaceId, repoId, ids?)` — resolves the candidate set (accepted,
`skill_id IS NULL`, and in `ids` when given; any id that fails those checks is
a `ValidationError` naming it), then `buildConventionSkillBody`. Returns the
draft; writes nothing.

`createSkill(workspaceId, repoId, body)` — one transaction:

1. Draft as above (so a client `body` is optional and the candidate set is
   validated the same way).
2. Every `agent_id` must exist in the workspace — `agentsRepo.getById`; else
   422 naming the id. An empty list is valid: the skill is created unbound.
3. `skillsRepo.insert({ source: 'extracted', evidenceFiles: draft.evidence_files,
   enabled: body.enabled ?? true, … })` — the repository writes the v1
   snapshot; nothing here bypasses it (the 2026-09-20 seed lesson).
4. For each agent: `order = (agentsRepo.linkedSkills(agentId)).length`;
   `agentsRepo.linkSkill(agentId, skillId, order, true)` — `enabled: true`
   explicitly, the repository's default is `false`.
5. `repo.markAbsorbed(candidateIds, skillId)`.
6. Return `{ skill_id }`. No DTO mapping crosses a module boundary.

### Helpers — pure, hermetic, the bulk of the unit tests

- `CONFIG_FILE_CANDIDATES`, `findConfigFiles(clonePath)` — root and one level
  down; returns existing paths only.
- `readSample(clonePath, relPath)` — resolves, asserts the resolved path starts
  with the resolved clone path, reads utf8, returns `null` on ENOENT / EISDIR /
  a NUL byte in the first 1 KiB; truncates to `MAX_SAMPLE_LINES`.
- `numberLines(text)` → `"1: …\n2: …"`.
- `collectSamples` — budget loop with `tokenizer.count` and
  `SAMPLE_TOKEN_BUDGET`; configs first, then code in rank order; returns the
  ordered `sampledFiles`.
- `buildExtractionMessages` — system prompt from `constants.ts`; user message =
  one `<untrusted source="sample:<path>">` block per sample, via
  `wrapUntrusted` from `reviewer-core`.
- `normaliseRule(rule)` — lower-case, strip punctuation, collapse whitespace.
- `groundCandidates(candidates, samples)` — the gate from the cross-package
  spec: path ∈ sampled set, no `..`, snippet ≥ `MIN_SNIPPET_CHARS`, found at
  claimed line ± 3 else anywhere, `evidence_line` = found line, in-scan dedupe.
- `buildConventionSkillBody(repoFullName, candidates)` — grouped by category in
  enum order, each rule with its confidence, evidence in a fenced block inside
  `wrapUntrusted('convention-evidence', …)`. Deterministic: same input, same
  bytes.
- `toCandidateDto`, `toScanDto`.

### Constants

```
MAX_SAMPLE_FILES = 12          SAMPLE_TOKEN_BUDGET = 60_000
MAX_SAMPLE_LINES = 400         MAX_CONFIG_CHARS = 6_000
MIN_SNIPPET_CHARS = 8          MAX_RULE_CHARS = 300
MAX_CANDIDATES = 25            SCAN_STALE_MS = 10 * 60 * 1000
EVIDENCE_LINE_TOLERANCE = 3    DEFAULT_SKILL_NAME = 'repo-conventions'
CONVENTIONS_SYSTEM_PROMPT      EXTRACT_RATE_LIMIT = { max: 5, timeWindow: '1 minute' }
```

### Migration — generated (two files: add, then drop)

As built: `drizzle-kit generate` prompts interactively ("is `scan_id` a rename of
`accepted`?") whenever a table both gains and loses a column, and the prompt
cannot be answered from a pipe. So the change shipped as **0013** (everything
additive, with `accepted` still declared) and **0014** (`DROP COLUMN accepted`),
both generated, neither hand-written. The SQL below is what the two files
contain together.

```sql
CREATE TABLE convention_scans (…);                         -- as in the cross-package spec
ALTER TABLE conventions ADD COLUMN category text NOT NULL DEFAULT 'other';
ALTER TABLE conventions ADD COLUMN status text NOT NULL DEFAULT 'pending';
ALTER TABLE conventions ADD COLUMN evidence_line integer;
ALTER TABLE conventions ADD COLUMN edited boolean NOT NULL DEFAULT false;
ALTER TABLE conventions ADD COLUMN skill_id uuid REFERENCES skills(id) ON DELETE SET NULL;
ALTER TABLE conventions ADD COLUMN scan_id uuid REFERENCES convention_scans(id) ON DELETE SET NULL;
ALTER TABLE conventions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conventions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conventions DROP COLUMN accepted;
CREATE INDEX conventions_repo_idx ON conventions (repo_id);
CREATE INDEX conventions_ws_idx   ON conventions (workspace_id);
CREATE INDEX convention_scans_repo_idx ON convention_scans (repo_id);
```

Edit `db/schema/knowledge.ts` (the `conventions` table) and add
`convention_scans` next to it, then `pnpm db:generate`; never write the SQL by
hand. `db/rows.ts` gains `ConventionRow`, `ConventionScanRow`.

### Seed

`seed-conventions.ts` exports the three mock candidates (async/await over
`.then()`, typed `Result<T, ApiError>` handlers, the Redis singleton) with
`status: 'pending'`, categories `async` / `api` / `structure`, confidences
`.91 / .78 / .85`, and one `done` scan with `sampled_files` naming their three
evidence paths. Idempotent by `(repo_id, rule)`. Evidence is fictional — the
demo repo has no clone — and that is fine: verification runs only during
extraction, never on read.

### The one reviews change

```ts
// run-executor.ts buildSkillBlocks
const TRUSTED_SKILL_SOURCES = new Set<SkillSource>(['manual', 'extracted']);
r.source && TRUSTED_SKILL_SOURCES.has(r.source) ? r.body : wrapUntrusted(`skill-${r.id}`, r.body)
```

`prompt-skills.test.ts` gains the case. The `server/README.md` "Skills"
paragraph and the `modules/skills` comment that says "any body whose `source
!== 'manual'`" are updated in the same commit — the sentence would otherwise be
false.

## Acceptance

- `pnpm db:generate` produces exactly one new migration and `pnpm db:migrate`
  applies it on a database at `0012`; `pnpm db:seed` twice yields three
  candidates and one scan, not six and two.
- `conventions-helpers.test.ts` (hermetic): `readSample` refuses `../x`;
  `numberLines` output is what `groundCandidates` can search; a snippet claimed
  at line 10 but present at 14 grounds with `evidence_line: 14`; `}` does not
  ground; two rules differing only in case and punctuation dedupe; the body
  builder is byte-stable and wraps every snippet.
- `conventions.it.test.ts` (Testcontainers, `MockLLMProvider` with
  `structuredBySchema.ConventionExtraction`, a temp clone directory created
  by the test with the sampled files on disk, and a `RepoIntel` override
  returning their paths): every route case in the cross-package Acceptance —
  extract, 409, both 422s, rescan-keeps-rejection, PATCH edit/accept/reject,
  preview writes nothing, create writes skill + version + links + `skill_id`,
  and a review run's trace carrying the extracted body unwrapped with wrapped
  evidence.
- `settings-models.it.test.ts`: an override of `conventions` in `PUT /settings`
  changes the `model` the mock receives on the next `extract`.
- `pnpm lint`, `pnpm arch`, `pnpm typecheck`, `pnpm test` green; every new
  file carries a conventional name so it lands in a ring.

## Open questions

- Should `GET …/conventions` accept `?status=rejected` now so the "N hidden"
  count can be expanded? Cheap, but restore is out of scope; a list nobody can
  act on is a dead end. **Lean: no** — ship the count only.
