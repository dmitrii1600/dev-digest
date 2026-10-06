# Insights — @devdigest/api

Server-local facts that are not visible from the code: why a choice was made,
what we tried that did not work, what surprised us. Cross-package findings go in
`../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

- 2026-09-20 — To stub ONE `RepoIntel` method in an integration test, patch
  the real facade instead of replacing it:
  `Object.assign(Object.create(app.container.repoIntel), { getConventionSamples })`
  assigned to `app.container['overrides'].repoIntel` after `buildApp`
  (`test/conventions.it.test.ts`). A whole-object fake
  (`{ getConventionSamples } as RepoIntel`) made every review run in the same
  test fail with a `TypeError` in `run-executor.ts` (`getRepoMap` /
  `getCallerSignatures` missing) — a failure that shows up as an empty trace,
  three assertions away from its cause.

## What Doesn't Work

- 2026-09-15 — Do not add a required field to `RunStats`, even a nullable one.
  `run_traces.trace` already holds documents written before the field existed;
  `z.number().nullable()` makes the key mandatory and every pre-existing trace
  stops parsing, breaking the drawer on read. Use `.nullish()`
  (`src/vendor/shared/contracts/trace.ts:61`). `RunSummary` has no such history
  — it is built per-request from columns, so `.nullable()` is fine there
  (`:97`).

- 2026-09-16 — "Zero call sites" from a `src/`-only grep is not dead code.
  `rollupSeverities` looked unused repo-wide but had a live unit test
  (`test/pulls-status.test.ts`), so reshaping its return keys broke the suite.
  Grep `test/` too before changing a helper's contract.

- 2026-09-18 — ESLint cannot police the innermost rings: `src/vendor/**` is in
  `ignores` (`eslint.config.mjs:20`), so no `no-restricted-imports` zone ever
  fires on the Zod contracts or on `vendor/shared/adapters.ts`, where the ports
  live. That is why the `contract-stays-pure` / `port-stays-pure` rules had to go
  into `.dependency-cruiser.cjs` instead. Do not "fix" it by un-ignoring a
  vendored tree.

- 2026-09-16 — A demo run with a denormalized `findingsCount` but no `reviews`
  row makes the UI look broken for a data reason. Two of the three seeded runs in
  `src/db/seed.ts` had counts and no review, so `RunSummary.findings_counts` came
  back null and the timeline printed "2 finding(s)" where the other row showed
  severity icons — which reads as a rendering bug and is not one. Seed a review
  per demo run, and keep its `findingsCount`/`blockers`/`score` equal to that
  review's, or the timeline row and the card below it disagree.

- 2026-09-20 — The seed inserts into `t.skills` directly rather than through
  `SkillsRepository.insert()`, so it wrote no `skill_versions` row and every
  seeded skill claimed `version: 1` while `GET /skills/:id/versions` returned
  `[]` — a history the studio can neither diff nor restore from, on a DB that
  looks correctly seeded. Fixed by writing the v1 snapshot in the seed loop
  (`src/db/seed.ts:419`). The general rule: when a table has a companion history
  table that only the repository maintains, seeding past the repository silently
  drops the history — seed both or go through the repository.

- 2026-09-20 — Do not build from a starter's leftover hooks. `adapters/mocks.ts:49`
  describes `structuredBySchema` as support for a two-step conventions dialogue
  (`'ConventionFileSelection'` then `'ConventionExtraction'`), i.e. the model
  picking which files to read. The lab's grading criterion 39 requires sample
  selection with **no** model call (`repoIntel.getConventionSamples` + config
  files, in code). Following the mock's comment would have failed the lesson.
  The hook is still useful — one schema name, one fixture — but the design it
  hints at is not a requirement.

- 2026-09-24 — `test/reviews.it.test.ts` is **not hermetic** since L03: every review run
  calls `container.intent.ensure` (`src/modules/reviews/run-executor.ts:134`), `appWith()`
  overrides `llm.openai` only (not `intent`), `review_intent` defaults to `openrouter`,
  and `SecretsProvider` finds a real `OPENROUTER_API_KEY` in `~/.devdigest/secrets.json` —
  so the test makes a paid OpenRouter call (2.8–8s+) inside `waitForPrRuns`' 10s budget
  (`test/helpers/runs.ts:19`). "grounding drops the hallucinated finding" failed 2/3 on
  an untouched tree. Do not read that failure as a regression; stub `intent` in `appWith`.

- 2026-09-26 — Do not read `MAX_CALLERS_PER_SYMBOL` as a per-symbol limit.
  The persistent facade path applies it once across all symbols after a global
  rank sort, `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`
  (`src/modules/repo-intel/service.ts:386`), and the ripgrep fallback
  (`service.ts:236-295`) applies no cap at all. A consumer that promises "N per
  symbol" must re-cap after grouping (`src/modules/blast/helpers.ts`), and a PR
  with >20 resolved callers in total can show zero for its low-rank symbols.

- 2026-09-26 — Running the API from a git worktree with the default
  `DEVDIGEST_CLONE_DIR=./clones` (`.env:28`, resolved against `process.cwd()`
  in `src/platform/config.ts:77`) points at `<worktree>/server/clones`, which
  does not exist; the DB's `repos.clone_path` still names the main checkout.
  Every resync then fails inside `git.sync` in milliseconds, `resyncRepo`
  returns `sync_failed`, the job is marked `done`, and the stale index keeps
  saying `full`. Fix for a worktree: a junction `<worktree>/server/clones` →
  the main `server/clones` (git-ignored), no restart needed.
- 2026-09-26 — `POST /repos/:id/resync` is a no-op when the clone's HEAD equals
  `lastIndexedSha` (`pipeline/incremental.ts:97`, reason `sha_unchanged`), so
  it cannot repair a broken index of the same commit. To force a full pass
  without touching code, set `repo_index_state.indexer_version` to a value
  other than `INDEXER_VERSION` and resync again (`incremental.ts:78` delegates
  to `runFullIndex`).

- 2026-09-26 — A clone dir reached through a junction/symlink (the worktree
  `server/clones` → main `server/clones` shortcut) gave the depgraph adapter
  **0 edges even after the backslash fix**: dependency-cruiser reports
  `module.source` through the path it was given but `dependency.resolved`
  through the real path, so `relative(root, resolved)` climbed out of the root
  and every edge was dropped. `toRel` now realpaths both sides
  (`src/adapters/depgraph/index.ts`, junction case in
  `test/depgraph-torel.test.ts`), and `INDEXER_VERSION` went to 4 so every
  v3 index (all of which carry 0 edges) rebuilds itself. Diagnosis shortcut:
  `repo_index_state.stats->>'edgesWritten'` = 0 with `referencesWritten` > 0.



- 2026-09-29 — Reading `GET /runs/:id/trace` the moment `waitForPrRuns` sees
  `done` returns 404 / `prompt_assembly` undefined: `completeAgentRun`
  (`src/modules/reviews/run-executor.ts:308`) runs before `saveRunTrace`
  (`:354`), and per-slot token counting sits in the gap. A test that needs the
  trace polls it (`test/project-context.it.test.ts` `runReview`, up to 10 s)
  instead of reading once. Whether the executor should save the trace first is
  open.
- 2026-10-01 — A directory pattern with a leading slash, matched with
  `includes`, misses the same directory at the repo root: `'/test/'`,
  `'/tests/'`, `'/migrations/'` and `'/__fixtures__/'` in `JUNK_PATH_PATTERNS`
  let `test/x.ts` and `migrations/0001.ts` through into `getTopFilesByRank`.
  `isJunkPath` now matches against `'/' + path`
  (`src/modules/repo-intel/service.ts:732`). The non-directory patterns
  (`jest.`, `eslint` …) are still bare substrings.
- 2026-10-01 — Do not ground LLM-cited paths on "the file is in the index":
  the indexer walks only `.ts/.tsx/.js/.jsx/.mjs/.cjs`
  (`src/modules/repo-intel/pipeline/walk.ts:7`), so `package.json`, READMEs
  and `.env.example` are never there, and every run command sourced from them
  is dropped. Onboarding grounds on "the prompt carried this file" instead
  (`groundedPathSet`, `src/modules/onboarding/helpers.ts`).
- 2026-10-02 — `pnpm typecheck` never sees `server/test/**`: `tsconfig.json:28` includes only
  `src/**/*.ts`, and vitest strips types. A test fake typed as a port (`makeStore` in
  `test/project-context-service.test.ts`) stays green after the port gains a method. When you widen a
  port, grep `test/` for its fakes by hand.
- 2026-10-02 — A green `node scripts/verify.mjs server --it` proves nothing when Docker is down: every
  `*.it.test.ts` gates on `dockerAvailable()` (`test/helpers/pg.ts:23`) and self-skips, and the lane
  still reports green. Track A of PR Brief shipped 3 unexecuted `.it` files this way. Run `docker info`
  first, or check the vitest output for skipped tests.

## Codebase Patterns

- 2026-09-18 — An onion ring is derived from the **filename**, not a folder:
  `service.ts` / `helpers.ts` / `constants.ts` are ring 2, `repository.ts` is
  ring 3, `routes.ts` is ring 4, and the lint zones are globs over exactly those
  names (`eslint.config.mjs`). The consequence is a silent opt-out — a file with
  an unconventional name matches no zone and no rule applies to it, which is how
  `modules/settings/feature-models.ts:1` still imports `drizzle-orm`. Name a new
  file conventionally even when it is small, or it leaves the architecture.
- 2026-09-18 — `platform/container.ts` is the **composition root**, so it is the
  one file in `platform/` allowed to import `modules/**` (`container.ts:26-29`);
  every other platform file importing a feature is an inverted dependency and
  `pnpm arch` rejects it. The rings, the eleven rules and the grandfathered
  violation list are in `.claude/skills/onion-architecture/`.

- 2026-09-15 — Per-PR cost on the list is the newest `done` run **per agent**,
  summed — dedupe key `prId:agentId`, not just the single newest run
  (`src/modules/pulls/routes.ts:132`). Re-running one agent then replaces only
  that agent's share instead of collapsing the column to one run's price. A run
  with unknown cost is skipped, never added as 0, so a PR whose runs all lack
  usage stays `null` → "—".
- 2026-09-15 — A failed/cancelled run stores `costUsd: null`, not `0`
  (`src/modules/reviews/run-executor.ts:301`). Zero would read as "this was
  free"; null reads as "no verdict, no meaningful spend".

- 2026-09-16 — **Supersedes the 2026-09-15 per-agent cost note.** Per-PR cost is
  now **every** `status='done'` run, summed — no dedupe key at all
  (`src/modules/pulls/routes.ts:137`). The column answers "what has this PR
  cost", not "what does the current verdict cost", so a re-run adds rather than
  replaces. The null-skip is unchanged: unknown is still never added as 0.
- 2026-09-16 — `score` and `findings_counts` are read off the **same** review row
  and share one map (`src/modules/pulls/routes.ts:119`), while `cost_usd` uses a
  different rule entirely. Deliberate: the ring and the severity chips in a row
  must describe one population or they contradict each other on screen. A new
  column needing "the latest review" should reuse `latestReviewByPr` — a second
  lookup is how two rules drift into one row.

- 2026-09-16 — A seeded review's `createdAt` must be its run's `ranAt`, not the
  default `now()` (`src/db/seed.ts`). The PR list reports the **latest** review
  (`src/modules/pulls/routes.ts:119`), so three reviews inserted in a loop all
  stamped `now()` would hand the column to whichever ran last in the loop — the
  oldest run — and silently change the FINDINGS and SCORE cells.

- 2026-09-18 — Postgres does **not** index a foreign key column; only PKs and
  UNIQUE get an index for free. This schema had 51 `references()` against 11
  `index()` declarations, and the split was not random: the repo-intel and
  context tables were indexed, while `runs.ts`, `reviews.ts` and `agents.ts` —
  the tables every screen reads — had **zero**. Two costs, both invisible until
  the data grows: `ON DELETE CASCADE` on an unindexed child seq-scans it once per
  deleted parent row, and `findings` for a review was a seq scan on the product's
  hottest join (`modules/reviews/repository/run.repo.ts:62`). Migration `0011`
  adds the 12 that a real query or a cascade asks for. When adding a table, an FK
  needs a deliberate yes/no on an index — the default is no index.

- 2026-09-20 — The ring-2 zones (`eslint.config.mjs`) forbid `node:fs` and a
  runtime `zod` import in `modules/*/helpers.ts`, and the zone glob for ring 3
  is `modules/*/repository*.ts`. So a module that must read files keeps its
  reader in a second ring-3 file named `repository-<what>.ts`
  (`modules/conventions/repository-samples.ts` — the clone reader) and its
  model-output schema in `vendor/shared/contracts/` next to `Review`, which is
  the precedent for a model schema living with the contracts. `helpers.ts`
  stays pure and hermetically testable; the name is what puts the file in the
  right ring.
- 2026-09-20 — `no-cross-module-reach-in` (`.dependency-cruiser.cjs:73`) allows
  a helper under `modules/<x>/` exactly one importing folder: its own. So
  `modules/settings/feature-models.ts` (`resolveFeatureModel`) cannot be reached
  from a second feature — the conventions module planned in
  `specs/03-conventions-module.md` is that second consumer — and the rule's own
  comment names the fix: move the file to `modules/_shared/`, beside
  `context.ts`, the other DB-reading shared helper. That move also closes the
  2026-09-18 note above about the file sitting outside every lint zone. The same
  rule means a module cannot import another module's DTO mapper
  (`modules/skills/helpers.ts` `toSkillDto`); a route that creates another
  module's entity returns `{ skill_id }` and lets the owning module's `GET`
  serve the DTO.

- 2026-09-20 — A port for a new adapter goes in `src/vendor/shared/adapters.ts`
  (ring 1), not next to its implementation the way `Tokenizer` sits in
  `adapters/tokenizer/index.ts:17`. The ring-2 zone (`eslint.config.mjs:84-87`)
  forbids *any* import from `**/adapters/**` in a `service.ts` — `import type`
  included, because `no-restricted-imports` sees only the specifier — so a
  service cannot even name a port declared beside the adapter. `Tokenizer` gets
  away with it only because ring 4 (`platform/container.ts`) is its sole
  importer. `UrlFetcher` (`vendor/shared/adapters.ts`, mirrored to the client)
  is the shape to copy; the client mirror must move with it.
- 2026-09-20 — An adapter cannot import a module's constants either
  (`.dependency-cruiser.cjs` `adapter-not-to-feature`), so limits the adapter
  must enforce travel in as call options: `SkillsService.fetchForImport` passes
  `{ maxBytes: MAX_UPLOAD_BYTES }` to `container.urlFetcher.fetch`
  (`modules/skills/service.ts`) rather than the adapter reading
  `modules/skills/constants.ts`.
- 2026-09-20 — A service takes its repository from the composition root
  (`this.repo = container.skillsRepo`, `modules/skills/service.ts:50`), never
  `new SkillsRepository(container.db)`. The why: it is the only thing that lets
  a hermetic test hand in an in-memory fake (`{ skillsRepo: fake, urlFetcher:
  mock } as unknown as Container`, `test/skills-service.test.ts`) — the enable
  gate and the URL import are covered without Postgres because of it. The
  switch broke the one caller that built the service with `{ db }`
  (`test/skills.it.test.ts:277`); grep for `as unknown as Container` when you
  change what a service reads off the container.
- 2026-09-20 — Per-request DTO fields beat persisted ones when they are a pure
  function of the row: `Skill.security` is `securityReport(row.body)` inside
  `toSkillDto` (`modules/skills/helpers.ts`) for `SCANNED_SOURCES` only, like
  `agent_count` before it. No migration, and an edit clears the flag with no
  second column to keep in step. The cost is one regex pass per skill per read,
  which for a seven-row list is nothing; revisit only if the list endpoint ever
  pages thousands.

- 2026-09-26 — `repoIntel.getBlastRadius` never emits `flag_off`, `index_failed`
  or `index_partial`: it returns `degraded:true, reason:'no_data'` or
  `degraded:false` (`src/modules/repo-intel/service.ts:233,302,338,389`), and a
  `partial` index comes back non-degraded. Derive the reason from
  `config.repoIntelEnabled` plus `getIndexState` (`src/modules/blast/helpers.ts`
  `resolveDegraded`) — the facade knows whether rows exist, not why they are
  missing.
- 2026-09-26 — `pr_files` is written only by `GET /pulls/:id`
  (`src/modules/pulls/routes.ts:241-252`); the list sync never fills it. A route
  that reads a PR's changed files (`GET /pulls/:id/blast-radius`) sees an empty
  list until the detail was fetched once. The studio relies on mount order, the
  MCP tool calls `getPull` first. A third consumer is the moment to move that
  refresh behind a service.
- 2026-09-26 — `GET /pulls/:id/blast-radius` is the first route with a
  `response: { 200: Schema }` (`src/modules/blast/routes.ts:37`). A mapper bug
  now surfaces as a generic 500 `internal_error` through
  `isResponseSerializationError` (`src/app.ts:130-134`), never as malformed
  JSON — the `.it.test.ts` `safeParse` assertion is where it becomes visible.

- 2026-09-26 — When indexer output changes shape, bump `INDEXER_VERSION`
  (`src/modules/repo-intel/constants.ts`) rather than editing rows: the
  incremental pass delegates to `runFullIndex` on a version mismatch
  (`pipeline/incremental.ts:78`). Nothing triggers that pass on its own, so
  `modules/blast/service.ts` nudges it — a blast read on a stale index
  enqueues one `repo-intel-resync` per repo per 10 min (`REINDEX_NUDGE_INTERVAL_MS`)
  and answers `degraded: true, reason: 'index_stale'` with the old map. Why:
  the read path must stay a read, but a user opening a PR is the only moment
  anyone looks at the index, so that is where the rebuild has to be kicked.
- 2026-09-26 — "Prior PRs touching these files" is 12 + ≤40 GitHub calls on a
  cache miss (`modules/blast/constants.ts`), so it is cached per PR head sha in
  `pr_brief.json.history` (`blast/repository.ts`). A missing token or a rate
  limit degrades to `{ history: [] }` with a warn log, never a 500.
- 2026-10-02 — `pr_brief.json` has two writers, and each owns one top-level key: blast owns `history`
  and brief owns `brief`. Each write is ONE upsert, `set: { json: sql\`${t.prBrief.json} || excluded.json\` }`
  (`blast/repository.ts:130`, `brief/repository.ts:77`). Why: the old read-merge-write in `upsertHistory`
  lost one write when both ran at once. A third writer gets its own key and the same statement.

- 2026-09-27 — A hand-seeded repo-intel index is only "live" for blast if it has
  ALL of: `file_edges` caller→decl (so `resolveReferences` sets `decl_file`),
  `file_rank` rows for every **caller** file (`getResolvedCallers` inner-joins
  `file_rank` on `from_path`, `modules/repo-intel/repository.ts:517`), and a
  `repo_index_state` row at the current `INDEXER_VERSION` written LAST.
  `src/db/seed-blast.ts` does exactly that through `RepoIntelRepository`; rank
  rows are deliberately absent for the changed files so the review prompt's
  "top 5%" note stays byte-identical. Proof: `test/seed-blast.it.test.ts`.
- 2026-10-01 — Tell a schema failure from other LLM errors by type, never by
  message text: adapters throw `StructuredOutputError`
  (`src/platform/errors.ts`), and the OpenRouter provider from reviewer-core is
  wrapped in `SchemaFailureTagger` at the composition root
  (`src/platform/container.ts:254`). Why: three adapters wrote the
  "failed schema validation" prose independently, so a regex on it misfiled
  `invalid_output` as `llm_error` on any reword. The tagger shadows zod v3's
  own-property `safeParse` (`src/adapters/llm/schema-failure.ts:43`), so
  re-check it on a zod v4 upgrade. OpenRouter output that is not JSON never
  reaches `safeParse` and stays untyped.
- 2026-10-01 — A repo with no `repo_index_state` row reports `never_indexed`,
  not `no_ranked_files`: the facade synthesises a `no_data` degraded state
  (`src/modules/onboarding/helpers.ts:63`). A test for `no_ranked_files` needs a
  state row with zero rank rows.
- 2026-10-05 — `eval_cases.owner_id` is polymorphic (no FK), so deleting an
  agent removes its cases by hand: `AgentsRepository.deleteById`
  (`src/modules/agents/repository.ts`) deletes `eval_cases` for
  `owner_kind = 'agent'` in the same transaction as the agent. Eval runs and
  their per-case rows go by FK cascade. This is the one place a second module
  writes an evals table. The "evals-owned helper that takes the `tx`" shape is
  not available: `no-cross-module-reach-in` forbids `agents` importing
  `modules/evals`. When skill-owned cases ship, `skills/repository.ts` needs the
  same cleanup, or move both behind a helper in `modules/_shared/`.
  (2026-10-06: skill-owned cases shipped; `SkillsRepository.deleteById` now deletes
  skill-owned runs, then cases, then the skill in one transaction —
  `src/modules/skills/repository.ts:76`. A third owner kind should move both into one helper.)
- 2026-10-06 — A skill eval run stores its **host** agent's id in `eval_runs.agent_id`
  (owner is the skill). Any agent-facing run read must filter through `AGENT_SUITE`
  (`owner_kind = 'agent'`, `src/modules/evals/repository.ts:114`), never on `agent_id`
  alone, or skill runs leak into that agent's history, dashboard and Compare; skill reads use
  `OWNER_SUITE` (`:118`). The running-suite unique index is keyed on `owner_id` for the same reason.




- 2026-10-05 — A feature-folder `types.ts` (a port plus DTOs) matches no lint zone, so a `drizzle-orm` import
  there passes `pnpm lint` silently. List each one in `RING_2` by path (`eslint.config.mjs:123-126`), not as a
  `src/modules/*/types.ts` glob: `blast`, `intent`, `project-context` and `smart-diff` `types.ts` are unaudited
  and a glob may turn lint red. Mirror every `RING_2` addition in `.claude/skills/onion-architecture/layers.md`,
  which as of this date still lacks `_shared/review-inputs.ts` and `evals/types.ts`.

## Tool & Library Notes

- 2026-09-20 — `drizzle-kit generate` asks interactively ("is `scan_id`
  created or renamed from `accepted`?") whenever one table both gains and
  loses a column, and the prompt reads a TTY — `yes '' |` and here-docs are
  ignored, the run just hangs. Ship it as two generated migrations: declare
  the new columns with the old one still present (`0013`, additive, no
  prompt), then remove the old column from the schema (`0014`, drop-only, no
  prompt). Never hand-write the SQL to dodge the prompt.
- 2026-09-20 — A Fastify route with `schema.body: Schema.optional()` still
  answers 422 to a POST that sends no body at all (`inject` without
  `payload`, or the client's `api.post(path)`), so "optional body" is not a
  thing on this stack. Declare the body required and send `{}` from every
  caller (`modules/conventions/routes.ts` `SkillPreviewBody`,
  `client/src/lib/hooks/conventions.ts`).

- 2026-09-18 — `no-restricted-imports` matches the **import specifier as
  written**, never a resolved path — so one `{ group: ['**/db/schema*'] }` entry
  catches `'../../db/schema.js'` from any depth (`eslint.config.mjs:37`). That is
  what makes the onion ring zones work with zero new dependencies;
  `eslint-plugin-boundaries` was not needed.
- 2026-09-18 — dependency-cruiser's `tsPreCompilationDeps` defaults to **false**,
  which drops every `import type` edge. That is why `no-circular` passes despite
  `platform/container.ts:26-29` importing `modules/**` while those modules import
  `Container` back — the return edge is type-only and erased at compile time.
  Flip that flag and the whole codebase reports as cyclic
  (`.dependency-cruiser.cjs`).
- 2026-09-18 — A `.cjs` file at the package root is linted by the flat config and
  fails `no-undef` on `module`, because the config is ESM. It needs its own block
  with `languageOptions.sourceType: 'commonjs'` and the node globals
  (`eslint.config.mjs`). Cost one red `pnpm lint` on an otherwise-green change.

- 2026-09-16 — ESLint is configured per package (flat config, `eslint.config.mjs`),
  never shared — this is not a monorepo. The server enables `no-console`
  deliberately (pino is the logger) and exempts the two CLI entrypoints,
  `src/db/migrate.ts` and `src/db/seed.ts` (`eslint.config.mjs:46`). That is what
  makes the pre-existing `// eslint-disable-next-line no-console` markers in
  `test/` mean something instead of being reported as unused directives.

- 2026-09-20 — A new ring-2 file is invisible to the onion zones until its path
  is added to `RING_2` in `eslint.config.mjs:114` — the globs are per-file
  (`src/modules/*/service.ts`, `helpers.ts`, `constants.ts`), not per-folder.
  `modules/skills/injection-scan.ts` had to be listed by hand; `pnpm lint` stays
  green either way, so nothing tells you it was skipped.
- 2026-09-20 — `AbortSignal.timeout()` + `redirect: 'manual'` on the global
  `fetch` is enough to follow redirects by hand and re-run an SSRF guard per hop
  (`adapters/url-fetcher/fetch.ts`); the body is read with `getReader()` and
  cancelled past `maxBytes` because `content-length` is optional. In tests the
  whole thing is driven by a stubbed `fetchImpl` returning `new Response(...)`
  with a `location` header — no server, no network (`test/url-fetcher.test.ts`).

- 2026-09-26 — The depcruise exemption for `repo-intel/constants.ts` is on the
  *target* path (`.dependency-cruiser.cjs:85`), so every module may import it,
  while `.claude/skills/onion-architecture/enforcement.md:115` describes it as
  one pinned edge. `modules/blast/routes.ts:7` is the second consumer and
  `pnpm arch` stays green. Pin the rule to `from: repos/service.ts` when the
  read limits move to `modules/_shared/`.


- 2026-09-29 — js-tiktoken `cl100k_base` `encode()` is super-linear on one
  whitespace-free run: a 64 KB string of a single letter never returned, and the
  vitest worker died after the 120 s test timeout. `TiktokenTokenizer.count` now
  encodes any text matching `/\S{512,}/` in 64-char slices
  (`src/adapters/tokenizer/index.ts:31-33`); prose without such a run is counted
  exactly as before. Anything that tokenises untrusted file content (Project
  Context tokenises every listed `.md` on `GET /repos/:id/context`) must go
  through that adapter, never a raw `getEncoding()`.
- 2026-10-01 — `String.prototype.isWellFormed()` is ES2024, and the server's `"lib": ["ES2022"]` (`server/tsconfig.json:20`)
  rejects it with TS2550. To reject invalid UTF-16 text (lone surrogates), use the `LONE_SURROGATE` regex
  (`src/modules/project-context/helpers.ts:122`) rather than raising `lib` for one call.
- 2026-10-01 — On Windows, renaming a temp file over a file another process holds open fails with `EPERM`/`EBUSY`/`EACCES`.
  An atomic temp-then-rename save needs a short bounded retry (`src/modules/project-context/repository-writes.ts:150-165`),
  and a test whose reader loops without pause still sees `EPERM` on win32. It must count the successful replaces,
  not expect every one to succeed.

- 2026-10-02 — `completeStructured({ maxRetries: 0 })` stops only the schema re-ask. The transport still
  retries: `withRetry` 3 times on 429/5xx, plus the SDK's own default retries. When a spec says "exactly
  one model call", use `container.llm(id, { singleShot: { timeoutMs } })` (`platform/container.ts:306`,
  cached as `${id}:single`), which sets SDK `maxRetries: 0` and `withRetry` `retries: 0`.

## Recurring Errors & Fixes

- 2026-09-15 — `pnpm exec vitest run --exclude '**/*.it.test.ts'` fails 6 tests
  in `test/indexer-pipeline.test.ts` on Windows with `ENOENT … \src\a.ts`. Not a
  regression: the helper does `full.lastIndexOf('/')` on a path `join()` built
  with backslashes, so it never creates the parent dir (`test/indexer-pipeline.test.ts:142`).
  Linux CI is unaffected. **Fixed 2026-09-18** — both helpers now use
  `dirname(full)`; the suite is 103/103 on Windows, so a failure here is once
  again a real signal and should be chased. The same `lastIndexOf('/')` sat in
  `test/indexer-walk.test.ts:20` and *passed*: with no `/` found, `slice(0, -1)`
  produced a path one character short, and `mkdir -p` on that happened to create
  the real parent as a side effect. A latent bug that silently works is why the
  fix went into both files rather than only the failing one.

- 2026-09-26 — `conventions.it.test.ts:474` (`trace.prompt_assembly` undefined)
  failed once inside a full `pnpm test` run and passed alone (7/7). It drives a
  whole review run under parallel Testcontainers; re-run the file alone before
  blaming a change outside `modules/reviews`. (2026-10-06: it also failed 3 runs in a
  row *alone*, once on a clean `b6c1529` worktree, then passed in the next full `--it`
  run ~20 min later — "fails alone" is not proof of a regression either; prove a
  clean-HEAD baseline.)

- 2026-09-26 — Blast radius shows N symbols and 0 callers on a `full` index.
  Check `repo_index_state.stats->>'edgesWritten'`: if it is `0`, the depgraph
  adapter dropped every edge and `references.decl_file` never resolved. On
  Windows the cause was `path.relative()` returning backslashes in
  `src/adapters/depgraph/index.ts` `toRel`, which never matched the POSIX
  `files` set — fixed by re-joining with `/` (`test/depgraph-torel.test.ts`).
  The adapter swallows cruise errors into `[]`, so `graphFailed` stays unset
  and the index is still stamped `full`.



- 2026-09-29 — `run-cost.it.test.ts` "a completed run persists the
  engine-reported cost" fails with `cost_usd` null after ≈10 s on this Windows
  host, and identically on a clean `289f8bb` worktree with no feature diff: the
  run has not reached `done` when `waitForPrRuns`' 10 s budget
  (`test/helpers/runs.ts:19`) expires. `reviews.it.test.ts` shows the same
  shape intermittently (3/6 red, then 6/6; on 2026-10-01 a clean `146cc40`
  worktree failed it 2 of 3 runs, a different test each time, and
  `conventions.it` "skill preview" showed it once too). Same family as the 2026-09-24 entry
  above: prove a baseline before reading it as a regression of a change outside
  `modules/reviews`. The 3–5 s run-start latency itself is unexplained.

## Session Notes

## Open Questions

- 2026-10-01 — Should repo-intel skip `.devdigest/`? Its `EXCLUDED_DIRS` (`src/modules/repo-intel/constants.ts:18-25`)
  does not list it, so `walkClone` would index a `.ts` file placed under `.devdigest/specs/`. That is pinned in
  `test/project-context-isolation.test.ts`. Today Project Context authoring writes only `.md`, so NFR-3 of
  SPEC-2026-10-01-project-context-authoring holds. Excluding `.devdigest/` would also need a decision about
  dot-folders in general.
