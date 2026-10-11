# Insights — project-wide

Things that are true but not visible from the code: why a choice was made, what
we tried that did not work, what surprised us. Scope this file to facts that
cross package boundaries; module-local ones go in `<module>/INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`), not a
changelog (that is `git log`).

How to read and append: `/engineering-insights`
(`.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

- 2026-09-18 — Verify a change to the agent-instruction files by running
  `claude -p "<question only AGENTS.md answers>" --max-turns 1` from the target
  directory. It loads project memory cold, so it proves what a fresh session
  actually sees — the in-session context is already loaded and cannot tell you.
  Run it once from the repo root and once from `server/` to cover the nested
  on-demand load. Refined 2026-09-18: the same technique verifies a **skill**,
  but `--max-turns 1` is far too low there — a skill only proves itself once the
  agent explores, and a refactor-shaped prompt hit the cap at 6 turns and
  finished at 14. Budget ~14 turns and add "answer in prose, do not edit files"
  so the cold run cannot touch the tree.

- 2026-09-18 — A `PreToolUse` hook added to `.claude/settings.json:3` goes live
  in the **running** session, no restart, and the harness re-executes the script
  file on every call, so edits to the hook take effect immediately. Proof: the
  pr-self-review gate blocked this session's own test commands seconds after the
  file was written. Test a hook by running the command it guards, not by reading
  the config.

- 2026-09-18 — `git push --dry-run` still runs `.githooks/pre-push`, so a gate
  hook is testable with no real push. Set `GIT_SSH_COMMAND='ssh -o BatchMode=yes
  -o ConnectTimeout=20'` or a passphrase prompt hangs the test; git contacts the
  remote before the hook fires.
- 2026-09-22 — To clear a dev server that outlived its session, run
  `./scripts/dev.sh --free-ports` (or `scripts/free-port.ps1 -Port 3000`
  standalone). It resolves the listener, walks **up** the parent chain while
  the ancestor is a wrapper (`node/cmd/pnpm/npm/sh/bash/tsx/next/conhost`) and
  `taskkill /T /F`s the topmost one — the leaf-only kill the old note warned
  about is exactly what this avoids. The allowlist is the safety: verified
  against :5432, where it refused `com.docker.backend.exe` and `wslrelay.exe`
  and exited 1 rather than taking Postgres down (`scripts/free-port.ps1:33`).
  Default behaviour is unchanged — the guard still only reports
  (`scripts/dev.sh:161`); killing is opt-in.
- 2026-09-29 — One verify entry point for every agent: `node scripts/verify.mjs
  <pkg> [--checks | --tests | --file <p>] [--it]` runs lint/typecheck/arch and
  vitest with `--reporter=dot`, prints one line per command and the tail only on
  failure, and caches green results under `.devdigest/verify/` keyed by a
  fingerprint of HEAD + diff + untracked blobs (`scripts/verify.mjs:100`). A
  second agent on the identical tree gets a `cached` line instead of a rerun;
  a failure is never cached (`scripts/verify.mjs:218`). Measured on
  `reviewer-core` + `mcp`: 6 commands, second run 6 cached, output 8 lines
  instead of the full vitest listing.
- 2026-10-01 — When a `/run-plan` agent call is interrupted and its outcome is unknown, list what moved
  before you relaunch: `find <pkg dirs> -newer .devdigest/sdd/<stem>/<last report>`. The interrupted
  test-writer had already edited two test files. Relaunching it with "read these first, keep the sound
  additions, finish what is half-written" gave no duplicate cases and lost no work.

## What Doesn't Work

- 2026-09-29 — A tree-fingerprinted cache that lives inside the tree. The first
  run of `verify.mjs` wrote `.devdigest/verify/cache.json`, which was untracked
  and therefore part of the next fingerprint — so the cache never hit once.
  Exclude the cache dir (and vitest's transient
  `vitest.config.ts.timestamp-*.mjs`) from the untracked set
  (`scripts/verify.mjs:106`) **and** gitignore it; either alone is not enough.
- 2026-09-29 — "Load the skills per step" in an agent body. The `Skill` tool
  appends the whole body every call, so a three-step server plan loaded
  `onion-architecture` three times. The rule is now once per run, at the first
  step that needs it (`.claude/agents/implementer.md:72`).
- 2026-09-29 — Preloading a review catalogue into a writing agent. `security`
  (≈270 lines, mostly Express/Mongo/JWT) sat in every `spec-creator` run for one
  table, and `react-testing-library` (≈600 lines of jsdom) in every
  `test-writer` run including server-only ones. Both are on-demand now; the
  one-table need became a *Validation vocabulary* in the `spec-writing` skill.

- 2026-09-15 — On Windows, `pnpm db:migrate` and `pnpm db:seed` exit 0 having
  done **nothing**. Both guard their CLI entrypoint with
  `import.meta.url === \`file://${process.argv[1]}\`` (`server/src/db/migrate.ts:37`,
  `server/src/db/seed.ts:707`), and `argv[1]` is a backslash path
  (`D:\…\migrate.ts`) while `import.meta.url` is `file:///D:/…` — never equal,
  so neither the success nor the failure branch runs. `scripts/dev.sh` and
  `scripts/e2e.sh` call those same scripts, so on Windows the stack boots
  against an unmigrated DB and every route 500s with `relation … does not exist`
  — the exact symptom `AGENTS.md` blames on a skipped migrate. **Fixed
  2026-09-20**: both guards now compare against
  `pathToFileURL(process.argv[1]).href` (`server/src/db/migrate.ts`,
  `seed.ts`), so `pnpm db:migrate` / `pnpm db:seed` work on Windows — with
  `DATABASE_URL` pointing at `127.0.0.1`, per the `28P01` note below.

- 2026-09-20 — On Windows, killing the `bash scripts/dev.sh` **process** does not
  stop the stack it started. The chain is
  `sh → pnpm → cmd.exe → next dev → start-server.js` (and the same for
  `tsx watch`), and only the top link dies — every descendant survives holding
  :3000/:3001, with its stdout pipe gone (`write EPIPE`, `uncaughtException`).
  The next `./scripts/dev.sh` then found both ports taken: the API failed to
  bind and `next dev` silently moved to another port. Ctrl-C in an interactive
  terminal is fine — the console control event reaches the whole group — so this
  only bites when the script is killed as a process (a background task, a
  `timeout`, a closed wrapper). `scripts/dev.sh:105-141` now refuses to start on
  a busy port and names the PID to kill; to stop an already-orphaned stack,
  resolve owners by port (`netstat -ano | grep LISTENING`) and kill the whole
  chain, not just the listener. Corollary (2026-09-20): because the orphan lives
  in no terminal, a later session cannot see that it is there and runs
  `pnpm build` in `client/` against it — the very thing `client/INSIGHTS.md`
  (*What Doesn't Work*, 2026-09-20) forbids — and then reads the resulting 404 on
  `/agents` and 500 on `/skills` as an application bug. Check
  `netstat -ano | grep -E ":3000 "` **before** building; if something already
  serves the port, stop it first or skip the build. Refined 2026-09-22: the
  usual source is not a killed script but an **agent session** — the two
  orphans found today had `claude.exe` as their chain root
  (`cmd.exe -> pnpm --dir client dev -> cmd.exe -> next dev -> start-server.js`)
  and had been holding :3000/:3001 for two days. Resolve one with
  `Get-CimInstance Win32_Process` ancestry, not `netstat` alone; the listener
  PID is the leaf, and killing it leaves the wrappers.

- 2026-09-18 — A real symlink is not usable as the `CLAUDE.md` → `AGENTS.md`
  link here, and its failure mode is silent. `New-Item -ItemType SymbolicLink`
  fails with *Administrator privilege required* (no admin, Windows Developer
  Mode off), and this repo has `core.symlinks=false`, so a committed symlink
  checks out on Windows as a **regular file whose whole content is the string
  `AGENTS.md`** — Claude Code loads that as the project instructions without an
  error. A hardlink creates fine but git stores two independent blobs and any
  temp-file+rename save (including Claude Code's own `Write`) severs it. Use the
  `@AGENTS.md` import stub instead.

- 2026-09-18 — Gating shell commands by a regex over the Bash command text is
  fail-closed in a way that bites the person testing it: `echo '… && git push'`
  matches `GATED_COMMAND` (`.claude/hooks/pr-self-review-gate.mjs:77`) exactly
  like a real push, because the regex cannot see quotes. Build hook test
  payloads in a node script by concatenation (`'git ' + 'push'`); never inline
  the guarded text in a Bash tool call, or the hook under test blocks the test.

- 2026-09-18 — A strict `=== '@AGENTS.md'` check on the `CLAUDE.md` stubs flags
  all five as CRITICAL: each carries an HTML comment above the import line.
  Strip `<!-- … -->` before comparing (`pr-self-review-gate.mjs:577`). Any rule
  that asserts the content of an existing file has to be run against the real
  tree before it is called done — the first `static` run was five false
  positives and zero true ones.

- 2026-09-18 — Carrying cached findings forward from the previous `report.json`
  while `findings.json` still lists the same files double-counts every finding
  (3 became 6, one waiver "waived 3"). A finalize re-run after adding a waiver
  legitimately hits this path. Dedupe by finding `id`, fresh over carried
  (`pr-self-review-gate.mjs:1127`).

- 2026-09-18 — Do not take a review subagent's `severity` at face value. The
  frontend group returned `client/src/lib/hooks/reviews.ts:8` importing
  `@/providers/toast` as CRITICAL, but the CRITICAL bucket in
  `.claude/skills/pr-self-review/routing.md` is specifically
  `src/components|lib` → `src/app`, and `src/providers` is neither — it is a
  WARNING-level placement smell. Map every returned finding back onto that
  table before writing `findings.json`; one wrong CRITICAL is the whole
  difference between PASS and BLOCK.

- 2026-09-20 — A shipped spec's resolved decisions can contradict the grading
  sheet. `client/specs/02-skills-lab.md` deliberately removed the `/skills`
  preview pane ("edit mode a second click away") and diffs a version against
  its predecessor; lab criteria 10 and 28 require a side-panel preview on card
  click and a diff against the **current** version. Both were reasonable calls
  made without the sheet in hand, and both now cost a rework
  (`specs/05-skills-lab-criteria-gaps.md`). Before resolving an open question in
  a spec, grep the grading criteria for the surface it touches; "matches the
  mock" is not the same as "matches the rubric".

- 2026-09-20 — The gate's `test-naming` static rule is a false positive for every
  integration test that reaches Postgres through the shared fixture: its regex
  (`pr-self-review-gate.mjs:634`) looks for `testcontainers`, `db/client`,
  `withPostgres` or `startPostgres`, but `skills.it.test.ts`,
  `conventions.it.test.ts`, `agent-skills.it.test.ts` and
  `settings-models.it.test.ts` import `startPg` from `./helpers/pg.js` and get
  the container from there. The four WARNINGs it emits are noise, not a naming
  bug — add `startPg|helpers\/pg` to that regex when the gate is next touched.

- 2026-09-22 — `permissionMode` in a subagent's frontmatter is **not** a safety
  boundary: under auto mode it is ignored and every action goes through the
  parent session's classifier instead. `disallowedTools: Bash(git push:*)` is not
  one either — it removes the **whole** `Bash` tool, not the pattern. A
  subagent's only real gate is what you leave out of `tools:`
  (`.claude/agents/planner.md:11` has no `Write`/`Edit`, which is what makes it
  read-only); command-level limits exist only in `settings.json →
  permissions.deny`, which is session-wide and binds the author's own session
  too. Everything else an agent body forbids is convention, not enforcement.

- 2026-09-26 — The `mcp` route in `pr-self-review-gate.mjs` matches
  `mcp/src/**/*.ts` only, so non-test helpers under `mcp/test/helpers/*.ts`
  (`connect.ts`, `fake-api.ts`, `fixtures.ts`) fall to `unrouted` and emit
  three `unrouted-file` WARNINGs on every run. They are test scaffolding, not
  product code: mark `mcp/test/**` convention-only in `ROUTES` when the gate is
  next touched, the same treatment `*.test.ts` already gets.

- 2026-09-27 — Checking an e2e assertion against the long-lived dev DB is
  misleading: `seed()` is idempotent per row, so the dev DB still carried the
  L03 intent row from an older `seed-intent.ts` (2 of 4 sources, 45 %) while a
  fresh seed gives 6 sources / 77 %, and the demo runs with findings on all
  four PR files were missing. Verify flow strings only on the hermetic stack
  (`./scripts/e2e.sh`) or re-run `pnpm db:seed` and re-check the specific row.


- 2026-09-29 — Editing from a pre-restart read. After the desktop app quit and
  resumed a session, `Edit` on `.claude/agents/README.md` failed on a stale
  `old_string`: another session had renamed `planner.md` →
  `implementation-planner.md` and rewritten the README between the read and the
  edit, and `Write` on `specs/README.md` had already overwritten a version never
  seen. After any resume, run `git status --short` and re-read every file before
  editing it; a snapshot from before the restart is not the tree.

- 2026-09-29 — `pnpm exec` inside a throwaway `git worktree` whose
  `server/node_modules` was a junction to the main tree: pnpm judged the modules
  dir stale, ran an install **through the junction**, and re-pointed every
  top-level symlink of the *main* `server/node_modules` at the worktree path.
  Once the worktree was removed the links dangled and `pnpm install` itself
  failed (`ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`, "Access is denied") until
  the dead links were `rmdir`ed. For a baseline run in a worktree, call the
  binary directly (`node node_modules/vitest/vitest.mjs run <file>`), never
  `pnpm exec` or `pnpm run` there; the lock-file was untouched, so
  `pnpm install --frozen-lockfile` in `server/` restored the tree.
- 2026-10-01 — Do not check "this change did not touch X" with `git diff --stat main -- X`. On a branch
  that already carries earlier feature commits, it lists their files: 5 `reviewer-core` files from
  `67bb193`/`fb83008` turned the project-context-authoring NFR-5 row PARTIAL. For uncommitted work,
  diff against `HEAD`; otherwise diff against the plan's recorded base commit.
- 2026-10-01 — A raw `diff` is the wrong check for "the vendored `@devdigest/shared` copies are
  byte-identical". With `core.autocrlf=true` the working-tree EOL differs per file: server
  `platform.ts` is `w/crlf`, client `w/lf`, both `i/lf`. A raw `diff` printed 776 lines on identical
  content, and two verify passes held the rows PARTIAL. Use `diff --strip-trailing-cr` or compare
  `git ls-files --eol`.
- 2026-10-05 — In the Agent SDK, `allowedTools` only **pre-approves** tools; under
  `permissionMode: "bypassPermissions"` every other tool stays usable. An eval workflow session
  used `Edit` on `server/INSIGHTS.md`, and others reached the logged-in account's claude.ai
  connectors and created private artifacts. Restrict with `tools` + `disallowedTools` +
  `strictMcpConfig: true, mcpServers: {}` (`evals/src/runtime/run-claude.ts:74`).
- 2026-10-05 — An `eval:benchmark` where every session shows `tok_out 0` and the output files say
  `Not logged in · Please run /login` is not a 0% → 0% result. The desktop app's login does not
  reach the Agent SDK subprocess; run `claude` → `/login` once in a terminal, then re-run.
- 2026-10-06 — Do not switch the workflow tier to Sonnet with `EVAL_MODEL` and read the reds as a
  routing regression. The cases are budgeted on Haiku. On `claude-sonnet-5` the API-route trace read
  the `reviews` module code instead of `server/README.md`, and the contrast case hit `maxTurns: 6`
  (`evals/workflow/review-workflow.cases.ts:66`). The same tree on Haiku was 5/5. Re-budget the
  cases first if Sonnet becomes the workflow model.

## Codebase Patterns

- 2026-09-29 — Skills are split into write-time and review-time
  (`.claude/skills/pr-self-review/routing.md:34`). `security` and
  `typescript-expert` grade a finished diff and never appear in a plan's Skill
  contract; the implementer loads only what changes what gets typed, the gate
  applies the rest. Why: together they are ~700 lines of context on a blank file
  and change nothing about the code written.
- 2026-09-29 — `implementation-planner` writes `plans/<stem>.md` itself
  (`Write`, no `Edit`, limited by prompt text — `.claude/agents/implementation-planner.md:32`)
  and returns a short Plan Report. Why: a plan relayed through the caller's
  context costs a second copy and was once summarised on the way; structural
  read-only was traded for the guarantee, the same trade `spec-creator` makes.
- 2026-09-29 — Chain order is implementer → plan-verifier → (test-writer ∥
  architecture-reviewer) → plan-verifier in delta mode
  (`.claude/agents/plan-verifier.md:85`). Why: a DIVERGES goes back to the
  implementer through the fix loop (plan path + report path + item numbers), so
  tests written before that pass would be written against the wrong behaviour;
  the delta pass re-checks only rows not MET or whose evidence file changed.
- 2026-09-29 — The build half of the chain is one command, `/run-plan
  plans/<stem>.md` (`.claude/skills/run-plan/SKILL.md`); the spec and the plan
  are made by hand before it because a person approves each. Every agent reply
  is saved verbatim to `.devdigest/sdd/<stem>/NN-<agent>.md` and the next agent
  gets a path plus item numbers; fix loops are capped at 2 (verifier, arch) and
  1 (gate), then the run stops with a summary. Why: an uncapped loop is where an
  orchestrator burns tokens, and a report relayed by summary loses the items the
  fix needs. A new skill without a route must be added to `NON_REVIEW_SKILLS`
  in the gate (`.claude/hooks/pr-self-review-gate.mjs:83`) or `unrouted-skill`
  fires.
- 2026-09-29 — `plan-verifier` and `architecture-reviewer` run on sonnet;
  `spec-creator` and `implementation-planner` stay on opus. Why: the two
  reviewers emit a forced structure (four-status ledger, finding with
  `path:line` + verbatim evidence + table-read severity) and run two to four
  times per feature inside fix loops; the two authors decide once and everything
  downstream inherits it.

- 2026-09-22 — A change confined to `.claude/**` gets **no automated verification at
  all**, and that is by design, not a gap to fill. `ROUTES` files it as
  `convention-only` (`pr-self-review-gate.mjs:153`), so no review skill is loaded;
  `packageOf` returns `null` for it (`pr-self-review-gate.mjs:248`), so no `lint`,
  `typecheck`, `test` or `arch` command is ever scheduled; and `isSourceFile` is
  extension-based (`pr-self-review-gate.mjs:397`), so `no-insights` cannot fire on
  markdown either. Running `pnpm lint` after editing an agent or a skill proves
  nothing. The only verification that exists is invoking the thing on a change with a
  known ground truth — pick a commit whose findings you already know.

- 2026-09-15 — Unknown cost renders "—", never "$0.00", on every surface. The
  distinction is load-bearing and already baked into the engine: the per-chunk
  sum in `reviewer-core/src/review/run.ts:184` poisons to `null` the moment one
  call reports no cost, rather than under-reporting a total. Anything that
  persists, aggregates or displays cost must preserve that — skip nulls, never
  coerce them to 0.

- 2026-09-15 — `@devdigest/shared` is two physical copies behind one alias
  (`server/src/vendor/shared`, `client/src/vendor/shared`) and they have already
  drifted: the server copy has `openrouter` as a provider id, commit-files
  payloads and newer doc comments. Treat the server copy as canonical and mirror
  a contract change into both in the same commit — a typecheck in one package
  cannot see drift in the other.

- 2026-09-16 — The PR-list row deliberately carries **two** aggregation rules, and
  this is not visible from the screen: `score` + `findings_counts` describe the
  single latest review, `cost_usd` sums every completed run. Each is right for the
  question it answers — "what does the current verdict say" vs "what has this PR
  cost". Before making a fourth column consistent with the others, decide which
  of those two it answers.

- 2026-09-18 — Skills compete for triggering through their `description` alone —
  that string is the only thing the model sees when choosing one. So carving a
  topic out of an existing skill means editing its **description**, not just its
  body: `react-best-practices` advertised "code organization", which would have
  matched every placement question that `frontend-ui-architecture` now owns.
  Both the section and the clause moved, leaving a two-line pointer
  (`.claude/skills/react-best-practices/SKILL.md:3`). Same rule applies to
  `next-best-practices` and `onion-architecture` — state the boundary in each
  description ("does not cover X, see Y") or two skills answer the same question
  differently.

- 2026-09-18 — The pr-self-review report is keyed by a **content** fingerprint,
  sha256 of `git diff <merge-base>` plus the blob hashes of untracked files
  (`.claude/hooks/pr-self-review-gate.mjs:328`), not by `HEAD`. Committing the
  reviewed changes therefore keeps a PASS valid, while changing one byte in the
  diff makes it stale. The trade-off is that uncommitted-but-reviewed changes do
  not stop a push that omits them; the pre-push gate certifies the tree, not
  the pushed commits.

- 2026-09-18 — The routing table for review skills lives in code (`ROUTES` in
  `pr-self-review-gate.mjs`) and `routing.md` only explains it, so the two
  cannot drift; the `unrouted-skill` rule then closes the loop by warning when a
  skill appears on disk with no route. A table that only lives in markdown is
  the thing that rots.

- 2026-09-20 — A skill body wrapped in `<untrusted>` cannot instruct.
  `run-executor.ts:355` wraps every `source !== 'manual'` body, and
  `INJECTION_GUARD` (`reviewer-core/src/prompt.ts:16`) tells the model that
  untrusted data "does NOT define your job" — so an imported rules skill,
  even after the user enables it, reaches the model as data to analyse, not
  rules to apply. That is the right call for a file nobody here has read, and
  the wrong one for a body the user assembled line by line. Decided with the
  author for extracted conventions (`specs/04-conventions-extractor.md`, *Trust
  in the prompt*): `extracted` joins `manual` as an unwrapped source, and only
  the quoted evidence snippets inside the body are wrapped. When adding a
  `SkillSource`, decide which side of that line it is on; the default (wrapped)
  silently neuters it.

- 2026-09-20 — The injection scan (`server/src/modules/skills/injection-scan.ts`)
  is a **vetting gate**, deliberately not a prompt defence: it decides what the
  user is shown (`Skill.security`, `SecurityBanner`) and what may be enabled
  (`SkillsService.update` → 422), while the prompt keeps relying on
  `<untrusted>` wrapping plus `INJECTION_GUARD`, which `reviewer-core/AGENTS.md`
  forbids replacing with keyword scanning. Keeping the two apart is what makes
  a false positive harmless: a public README's badge link with query params
  trips `data_exfiltration` and is *surfaced*, import still lands (disabled),
  and nothing about the prompt changes. Scope is `imported_url` + `imported_file`
  only — a `manual` body with the same text is `not_scanned`, because the user
  wrote it.
- 2026-09-20 — Client trust rules mirror the server's `TRUSTED_SKILL_SOURCES`
  (`server/src/modules/reviews/run-executor.ts:28`), and they drift: the
  Preview tab's `UNTRUSTED_SOURCES` still listed `extracted` two days after the
  server trusted it, with a comment claiming it mirrored the server. When the
  trust line moves on the server, grep the client for `UNTRUSTED_SOURCES` and
  `needsVetting` in the same change.

- 2026-09-22 — The `planner → implementer` chain hands over a **file path**, not
  a plan. A subagent inherits none of the caller's context (only its own system
  prompt, the `Agent` tool's prompt string and `CLAUDE.md`), and the caller may
  summarise a subagent's final message — so `.claude/agents/planner.md` ends with
  "output the plan verbatim", the caller saves that text to a file, and
  `.claude/agents/implementer.md:38` reads it as step 0. A retold plan loses
  exactly the parts (paths, verify commands, constraints) the implementer cannot
  re-derive.
- 2026-09-22 — Skills do **not** auto-trigger inside a subagent the way they do
  in the main session: an agent reaches one either through `skills:` in
  frontmatter (full body preloaded on every run) or through the `Skill` tool.
  Both new agents keep `Skill` and preload nothing, so a frontend task does not
  pay for the `onion-architecture` body. Consequence for the split: the planner
  can only *name* skills in its *Skill contract*, the implementer invokes them,
  and both route through the one canonical table,
  `.claude/skills/pr-self-review/routing.md`.

- 2026-09-26 — A dev server started from a worktree shares the Postgres data
  with the main checkout, but not its filesystem: `repos.clone_path` and any
  relative `*_DIR` env resolve against whichever checkout started the process.
  Before debugging "index says full but shows nothing", confirm which checkout
  owns the process on :3001 (`Get-CimInstance Win32_Process` command line) and
  whether the paths it resolves actually exist there.


## Tool & Library Notes

- 2026-09-22 — Subagent frontmatter and Skill frontmatter are different schemas.
  `allowed-tools`, `disallowed-tools`, `disable-model-invocation` and
  `user-invocable` are **Skill** fields; a subagent has `name` and `description`
  (required), then `tools` (an allowlist that *replaces* inheritance, not adds to
  it), `disallowedTools`, `model`, `skills`, `memory`, `mcpServers`, `maxTurns`,
  `background`, `omitClaudeMd`, `effort`. `color`, `initialPrompt`, `hooks` and
  `experimental.cacheTtl` show up in one summarised source only — the three
  agents here deliberately use `name`/`description`/`tools`/`model` and nothing
  else.
- 2026-09-22 — Supersedes the last sentence of the entry above: **`skills:` is now
  used.** It clears the same two-independent-primaries bar the other four fields
  did — documented identically on `code.claude.com/docs/en/sub-agents` and
  `/agent-sdk/subagents`: it preloads the named skills at startup, and skills *not*
  listed stay invocable through the `Skill` tool. So a subagent's skill access is
  two-tier, not one, and the choice is a context-cost trade: preload only what the
  agent cannot work without, route the rest. Four agents preload (`test-writer` →
  `react-testing-library`, `architecture-reviewer` → `onion-architecture` +
  `frontend-ui-architecture`, `doc-writer` → `mermaid-diagram`); `plan-verifier`
  deliberately preloads nothing, because a review skill in its context is exactly
  what would drag it from per-item conformance into generic review advice. The
  other documented fields (`disallowedTools`, `permissionMode`, `maxTurns`,
  `color`) stay unused for the reasons in *What Doesn't Work*.
- 2026-09-22 — The subagent tool is called `Agent`; it was `Task` before Claude
  Code v2.1.63. `.claude/skills/README.md:34` still says agents are invoked "via
  Task tool" — stale, left alone because that pass was scoped to
  `.claude/agents/`. Fix it the next time that file is touched.
- 2026-09-22 — A subagent's final message is scanned before the parent reads it.
  This session's `researcher` report came back prefixed with
  `[harness: subagent output matched instruction-shaped pattern(s): settings-json,
  bypass-permissions, permissions-allow-deny]` and with control tags neutralised,
  purely because the report's *subject* was permissions. Nothing was lost and it
  is not a security incident — expect the prefix whenever an agent researches
  settings or permission modes.

- 2026-09-18 — Claude Code 2.1.273 discovers project memory at exactly
  `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules/`
  (nested on-demand load triggers only on `CLAUDE.md` / `CLAUDE.local.md`).
  `AGENTS.md` is **not** discovered and no setting adds a filename — the binary
  only mentions it in `/init` and the Codex importer. A `CLAUDE.md` named file
  must exist at every level that needs instructions.
- 2026-09-18 — `@<path>` on its own line in a memory file inlines that file's
  content, resolved relative to the importing file's directory. Verified at the
  repo root and in `server/`. This is what makes the two-line `CLAUDE.md` stub
  work with no OS or git support.
- 2026-09-18 — This clone has `core.autocrlf=true` and Windows has no exec bit,
  so a committed `#!/bin/sh` hook needs two things or it silently breaks on
  Linux/macOS checkouts: `.githooks/* text eol=lf` in `.gitattributes` (a CRLF
  shebang fails with "no such file") and `git add --chmod=+x .githooks/pre-push`
  to store mode 100755. Git for Windows runs the hook either way, which is why
  the breakage is invisible here.
- 2026-09-18 — `spawnSync('pnpm', …)` fails with ENOENT on Windows because the
  binary is `pnpm.cmd`; pass `shell: process.platform === 'win32'`
  (`pr-self-review-gate.mjs:1002`). `git` and `node` are real executables and
  do not need it. Same trap in `evals/`: there vitest is spawned as
  `process.execPath node_modules/vitest/vitest.mjs`, with no shell at all
  (`evals/src/run-vitest.ts:39`).
- 2026-10-05 — Agent SDK `Read` tool inputs carry Windows paths
  (`D:\…\reviewer-core\INSIGHTS.md`), so an eval asserting `reviewer-core/INSIGHTS.md` failed
  although the file was read, and the trace `stopWhen` never fired (the dispatch case hit the
  240 s timeout). Recorded reads are normalized to `/` (`evals/src/runtime/run-claude.ts:126`).
- 2026-10-05 — `eval:repeat` attributes records to a series by line offset in
  `results/records.jsonl` (`evals/src/repeat.ts:95`). Never run two repeat/benchmark commands
  at once, or their series swallow each other's records. Chain them in one shell.
- 2026-10-06 — `eval:repeat` silently caps `-n` at 2 (`evals/src/repeat.ts:75`). A case that
  passes the vitest `testTimeout` of 480 s (`evals/vitest.config.ts:10`) writes **no record**, so the
  repeat prints `2/3 cases` for a 4-case file and `eval:delta` shows `—%`. A missing row is a timeout,
  not a skipped case. Re-run it alone with `pnpm exec vitest run <dir>/ -t "<case>"` to see the error.

- 2026-09-18 — `client/pnpm-workspace.yaml` and `server/pnpm-workspace.yaml`
  ship pnpm's own unanswered prompt as their contents
  (`esbuild: set this to true or false`), so `pnpm install` in either package
  stops with `ERR_PNPM_IGNORED_BUILDS` — the file looks like configuration and
  records no decision. Replace the placeholders with real booleans or run
  `pnpm approve-builds`. Verified with `pnpm install --offline` in `client/`.

- 2026-09-20 — Git Bash on this machine fails to parse a `bash -c` script once a
  quoted heredoc grows past ~100 lines of Python/Perl with mixed quotes
  ("unexpected EOF while looking for matching `''"), and **nothing before the
  heredoc runs either** — the whole command is rejected at parse time. Write the
  script to the scratchpad with the Write tool and `python that-file.py`; keep
  shell heredocs for short, quote-free content.
- 2026-09-22 — Windows PowerShell 5.1 decodes a BOM-less `.ps1` as **ANSI**, so
  one non-ASCII character inside a string is a *parse* error, not mojibake: an
  em dash in `scripts/free-port.ps1` produced `Unexpected token 'not' in
  expression or statement` pointing at an unrelated line, and nothing in the
  file ran. Keep repo `.ps1` ASCII-only (the file says so at its top) rather
  than adding a BOM — unlike `.sh`, these are read by the ANSI-default host.

- 2026-09-26 — Never launch a stdio MCP server through `npm run`/`npx`: `npm
  run` prints its `> pkg@ver script` banner to **stdout**, which is the
  JSON-RPC channel, and `npx.cmd` needs a `cmd /c` wrapper on Windows (same
  family as the `pnpm.cmd` ENOENT above). `.mcp.json` runs `node` against the
  tsx CLI file directly (`.mcp.json:5-9`); the package's own `npm run inspect`
  is fine because the inspector, not the model, reads that stdout.

- 2026-09-26 — Windows PowerShell 5.1 swallows the `--` separator before it
  reaches `claude mcp add … -- node <file> --tsconfig …`, so the CLI parses
  `--tsconfig` as its own flag and fails with `unknown option`. Use
  `claude mcp add-json <name> '<json>'` (no separator needed) or run the
  `add` form from Git Bash. `claude mcp get <name>` run inside a worktree
  reports the **project** `.mcp.json` entry first (`Scope: Project config`,
  `⏸ Pending approval`) even when a user-scope entry of the same name exists.

- 2026-09-29 — `AskUserQuestion` is stripped from every subagent even when its
  `tools:` lists it (sub-agents docs, fetched 2026-09-28), so "ask the user if
  unclear" cannot be a tool call inside an agent. The only working shape is the
  one `.claude/agents/implementation-planner.md` uses: a required prompt input
  (`mode: single-agent | multi-agent`) plus a structured block that is the
  agent's **whole** reply when the input or an answer is missing; the caller
  relays it with its own `AskUserQuestion` and re-invokes. Two invocations are
  the normal case.

- 2026-09-29 — The desktop app's agent registry picks up a new or deleted
  `.claude/agents/*.md` with a lag of **minutes**, not the "few seconds" the docs
  promise: `implementation-planner` was refused as unknown (and the deleted
  `planner` still listed) on two calls one and two minutes after the file was
  written, and appeared roughly five minutes later without a restart. Do not
  conclude the frontmatter is broken; in the meantime the body can be exercised
  by a `general-purpose` agent told to read the file and obey it. Confirmed the
  same day for `spec-creator` (refused ~3 min after the write; the refusal lists
  the registry's current names, which is the quickest way to see the lag). The
  stand-in reproduced both branches of the body — the *Need clarification* block
  on a vague request and a full 14-section spec on a concrete one — so a new
  agent can be validated before the registry catches up. The registry also
  **snapshots the body**: after `spec-creator.md` was edited (numbering → dated
  stems) the registered agent still reported "my instructions say `NN-`" and
  only followed the new rule because it read `specs/README.md` from the tree.
  Keep the load-bearing convention in a repo file the agent is told to read,
  not only in the agent body, and expect an edited agent to run stale for a few
  minutes.
- 2026-09-29 — Per-agent token spend lives only in the subagent transcript (`~/.claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl` + `.meta.json`), summed once per `message.id` — a streamed reply is several lines that repeat the same `usage`. The `totalTokens` in an `Agent` tool result is the agent's **final context size**, not its spend, and the session's `cost-state` line has been seen to undercount subagent output by ~40 % (`scripts/retro-usage.mjs` prints a ⚠ when the sums disagree). cost-state is a snapshot at write time — in one session its opus figures equalled the first agent exactly and knew nothing of the four that ran later. Reconstruct spend from the transcript at list price instead (input/output/cache read per model, cache writes 1.25× for the 5-minute TTL and 2× for the 1-hour TTL — that formula reproduces the harness figure to the cent).

## Recurring Errors & Fixes

- 2026-09-16 — `28P01 auth_failed` connecting to the dev Postgres from the host on
  Windows: `localhost` resolves to `::1` first, where a WSL relay answers, while
  the container is published on IPv4. The container is fine — `docker exec psql`
  with the same URL succeeds. Use `127.0.0.1` in `DATABASE_URL` for anything run
  against the dev DB from the host.
- 2026-09-16 — `runMigrations` takes a **URL string**, not a `Db`
  (`server/src/db/migrate.ts:19`), while `seed` takes a `Db`. Passing the handle
  to the first yields a confusing `28P01` rather than a type error. This bites
  precisely because the documented Windows workaround is to import both from a
  script — get the argument types right or you will chase a phantom auth problem.

- 2026-09-29 — A scripted edit (sed / heredoc from the Bash tool on Windows)
  that carries an em dash writes it as the single cp1252 byte `0x97`, which is
  invalid UTF-8 that lint and typecheck never see; the same encoding error once
  emptied `server/src/modules/reviews/run-executor.ts` mid-edit (restored from
  git). Check a touched file with `iconv -f UTF-8 -t UTF-8 <file> >/dev/null`
  and `grep -nP '[^\x00-\x7F]'`; use the Edit tool, not a shell script, for any
  non-ASCII text. Companion to the 2026-09-22 `.ps1` note above.

## Session Notes

### 2026-09-15 — run cost badge
Built per-run USD cost end to end (schema → routes → three screens). The engine
was already computing it; the server was dropping it on the floor in one
destructuring line. Two things cost the most time and are recorded above: the
`RunStats` nullish rule (old traces have no `cost_usd` key) and discovering that
`db:migrate`/`db:seed` silently no-op on Windows, which is why the dev DB had no
tables at all rather than merely a missing column.

### 2026-09-15 — where contracts live
Documenting the `AGENTS.md` set surfaced that the "shared" contracts package is
vendored twice rather than shared. Recorded the canonical-copy rule above so the
next contract change mirrors instead of drifting further.

### 2026-09-16 — findings by severity, and closing the HW-1 criteria
Built the severity counters and filter across three screens, then closed the
grading-criteria gaps around them. Two things cost the most time and are recorded
above: the IPv4/`::1` split that made the dev DB look like an auth failure, and
the `borderColor`-is-a-shorthand rerender warning that only appeared once the
filter made the cards rerender.

Two findings about the audit itself. A `src/`-only grep declared a helper dead
when it had a live test. And the seed is idempotent per-PR, so new fixtures never
reach an already-seeded dev DB — visual verification had to run against a scratch
database rather than the developer's own.

ESLint went in across all four packages and found far less than feared: 7 real
issues on the server (all dead imports or an unused catch binding), 1 in
`reviewer-core`, 0 in `e2e`. The client's 11 remaining warnings are pre-existing
hydration patterns, left visible rather than silenced.

### 2026-09-16 — follow-up: Reject label, timeline previews, collapsed drawer
Four corrections after driving the finished severity UI: renamed Dismiss →
Reject (label only — the action and `dismissed_at` are untouched), seeded a
review per demo run so every timeline row shows icons instead of a word,
collapsed the trace drawer's Findings section, and gave the timeline rows the
same read-only hover preview the PR list has.

The preview work paid for itself twice: extracting `useFindingsPreview` and
`sortBySeverity` meant the timeline reused the PR list's anchor/timer logic
rather than growing a second copy of a timer that must be cleared on unmount.

Half an hour went to a phantom regression — the PR-list popover appeared dead in
screenshots after the refactor. It was not: screenshot coordinates and page
coordinates differ by the zoom factor, so every `hover` was missing the cell. RTL
and a `javascript_tool` DOM check both showed it working. Recorded in
client/INSIGHTS.md; the session also left behind the PRRow hover test that was
missing all along.

### 2026-09-18 — CLAUDE.md → AGENTS.md
Renamed all five instruction files to `AGENTS.md` (root + four packages) so
non-Claude agents read them, and left a two-line `CLAUDE.md` stub containing
`@AGENTS.md` at each level. Symlinks were the asked-for mechanism but are
unavailable on this host and fail silently when they are; the import stub is
plain text, needs no privileges or `git config`, and behaves the same on every
OS and in CI. Also repointed the ~17 prose/link references across `INSIGHTS.md`,
`docs/README.md` and the four `eslint.config.mjs` headers.

### 2026-09-18 — frontend-ui-architecture skill
Added `.claude/skills/frontend-ui-architecture/` (SKILL.md + README + five
references) to answer "where does this code live", which neither
`react-best-practices` nor `next-best-practices` covered. Sources were checked
with `curl` before citing: two of ~25 were unusable (`profy.dev` did not respond,
the TanStack `query-key-factory` docs URL 404s), which is cheap to catch up front
and embarrassing to ship.

The step that paid was writing the repo-specific reference file **last** and
checking every claim against the tree. Three drafted statements were wrong:
`src/lib/hooks/index.ts` is not "the only barrel" (30 `index.ts` files exist,
all benign single-component forwards), `src/lib/types.ts` is not a clean shim
(`PrRowView` is local), and `RunTraceDrawer`'s split is not driven by the
`'use client'` seam (the whole drawer is already client). A skill that asserts
things about the codebase has to be verified against the codebase, not written
from the general rule and assumed to fit.

### 2026-09-18 — onion-architecture skill
Added `.claude/skills/onion-architecture/` (SKILL.md + layers/rules/enforcement),
the backend counterpart to `frontend-ui-architecture`, and backed it with two
checks: import zones in `server/eslint.config.mjs` and a new
`server/.dependency-cruiser.cjs` behind `pnpm arch`. No dependency was added —
`dependency-cruiser` was already a runtime dep of `server/` (it backs
`adapters/depgraph`), so no lockfile moved.

The rings were mapped onto the folders that already exist rather than introducing
`domain/application/infrastructure` subfolders: the repo already names its layers
by file, and a filename maps directly onto an ESLint flat-config glob, so the map
and the enforcement cannot drift apart. Both checks landed green on the first
commit by freezing the ten pre-existing violations file by file, each keeping the
rules it does *not* break — a ratchet rather than a big bang. The check is worth
nothing unless it is verified to fail: two deliberate bad imports (`drizzle-orm`
into `repos/service.ts`, `modules/repos/repository.js` into `platform/jobs.ts`)
confirmed lint and arch actually fire before either was called done.

### 2026-09-18 — first pass on the architecture-audit plan
Audited the repo through the new `frontend-ui-architecture` skill plus the
existing React/Next/onion/Postgres ones, then executed the top of the resulting
plan: the Windows path bug in two server test helpers, 12 foreign-key indexes
(migration `0011`), 54 client imports moved onto `@/`, a `shared → routes` lint
boundary, the provider stack out of `src/lib` into `src/providers`, and one dead
type deleted. Each finding is recorded in the package that owns it.

Two things worth carrying forward. First, **running the existing gates was worth
more than reading code**: `pnpm lint`, `pnpm arch`, the test suites and `pnpm
build` found the red build, the missing indexes and a broken import that no
amount of reading had surfaced. Start an audit by running what the repo already
has. Second, **two of the plan's own items were wrong once checked against the
tree** — `agent_versions` needed no index (its composite PK already leads with
`agent_id`), and `feature-models.ts` should stay central rather than be demoted.
A plan written from general rules is a hypothesis; the tree is the authority.

### 2026-09-18 — pr-self-review skill and gate
Added `.claude/skills/pr-self-review/` (SKILL.md + routing.md + report.md) and
its deterministic half, `.claude/hooks/pr-self-review-gate.mjs`, wired as a
Claude Code `PreToolUse` hook (`.claude/settings.json`) and as
`.githooks/pre-push` (`scripts/dev.sh` sets `core.hooksPath`). One script owns
routing, the static AGENTS.md rules, machine checks, grounding of the skill's
findings, waivers, cache, history and both gates. No dependency added.

Verified end to end on this tree: 11 gate cases (4 blocked, 7 allowed), a real
`git push --dry-run` aborted by the hook, finalize with 7 synthetic findings of
which 4 were dropped for the right reasons, cache hits on the second run,
waiver + stale-waiver handling, staleness on a new file, a static CRITICAL
overriding a PASS report, and a `claude -p` cold run that described the skill
correctly. Three bugs were found by running, not reading, and are recorded
above: the greedy command regex, the CLAUDE.md-stub false positive, and the
carried-finding double count.

### 2026-09-18 — first real /pr-self-review pass
Ran the gate end to end on the 98-file tree: 9/9 machine checks green, one
static WARNING (pr-size), six review findings, verdict PASS. Two of the four
findings the frontend subagent returned were false positives and a third
carried the wrong severity; both causes are recorded above and in
`client/INSIGHTS.md`. Grounding did not catch either — every cited line was
inside a hunk — so the verification that pays is re-reading the rule the
finding names, not re-checking its line number.

### 2026-09-20 — conventions extractor: built
Implemented specs 04 / 05 end to end (server module + two generated
migrations, client page + modal, seed, e2e flows, the nine Skills Lab gap
items via a subagent). Every gate is green: server unit 141 / integration 59,
client 181, lint + arch + typecheck in both, flows 09 and 10 against the live
dev stack. What the tree taught, recorded above and in the package files:
`drizzle-kit generate` cannot be answered from a pipe (two migrations, add
then drop); the ring-2 lint pushes `node:fs` into a `repository*.ts` file and
the model's zod schema into the contracts; a whole-facade `RepoIntel` mock
breaks the review run, so patch one method on the real one; and
agent-browser's find-text click misfires inside the fixed Drawer, so the flow
clicks a `data-testid`. Criterion 21 is still the author's call.

### 2026-09-20 — conventions extractor: spec, not code
Wrote the L02 second-half specs (`specs/04-conventions-extractor.md` + server
and client child specs) and a gap list against the lab's 53 criteria
(`specs/05-skills-lab-criteria-gaps.md`). Four decisions taken with the
author: sync extraction, one `repo-conventions` skill, agents picked in the
modal, rules trusted / evidence wrapped. Three things the tree taught that the
task description did not: the `conventions` table cannot hold a rejection
(`accepted boolean` → a `status` enum, one migration); `no-cross-module-reach-in`
forces `feature-models.ts` into `modules/_shared/`; and the existing skills
trust rule would have neutered the very skill the feature exists to create.
Nine criteria outside the extractor do not hold on the current tree — listed
in spec 05 with the smallest fix each. Criterion 21 (git-push auto-invoke
off) is left for the author.

### 2026-09-20 — Skills Lab revisions: direct-open cards, one Add modal, URL import + injection gate
The author reviewed the criteria-gaps pass and reversed two readings: a card
click now opens the editor (the side panel is gone) and the editor rail shows
the same `SkillCard` tiles as the grid; **Add Skill** is one modal with
Create / From file / Import from URL on both screens. URL import is new end to
end (`UrlFetcher` port in `vendor/shared`, guarded `FetchUrlFetcher`, two
routes) and every `imported_*` body is scanned on read with a 422 enable gate.
The conventions modal got its missing body padding and agents became optional
(none preselected; `agent_ids` may be empty). What the tree taught: a port must
live in ring 1 because the ring-2 lint blocks even type imports from
`adapters/**`; a service reading `container.skillsRepo` instead of `new`-ing
it is what unlocks no-DB service tests; `Modal` gives `children` no padding;
and this session itself repeated a recorded mistake — `pnpm build` in
`client/` while an (orphaned, invisible) `next dev` was serving :3000 — and
spent a detour blaming the 404/500 on the orphan before the existing
`client/INSIGHTS.md` entry explained it; read *What Doesn't Work* before
verifying, not after. `./scripts/e2e.sh` still cannot run here
(`agent-browser` not on PATH); the flows were updated and the UI verified
through the browser pane instead.

### 2026-09-22 — planner + implementer subagents
Added `.claude/agents/planner.md` (opus, read-only) and `implementer.md`
(sonnet, full write set) plus `.claude/agents/README.md` as the map of the set,
all uncommitted for now. The research behind them corrected three assumptions
that would have produced a broken config: a subagent has no `permissions` field
(those are Skill fields), `permissionMode: plan` is ignored under auto mode, and
`disallowedTools` cannot scope a Bash *pattern*. Deny rules in `settings.json`
were considered and declined — they would bind every developer's own session,
while the existing `pr-self-review` `PreToolUse` gate already covers push/PR and
has a waiver path a hard deny would not. So `Bash` is granted to both agents and
limited only by their prompt text; that trade-off is written down in the
agents' README rather than left to be rediscovered.

### 2026-09-22 — four more subagents: test-writer, architecture-reviewer, plan-verifier, doc-writer
Extended the set from three to seven and made good on the README's outstanding
promise of "architecture / security review agents" — the architecture half now
exists, the security half is stated plainly as still being the `security` skill
inside `/pr-self-review`, not an agent. The chain is now
planner → implementer → test-writer → plan-verifier → architecture-reviewer →
doc-writer → `/pr-self-review`; `plan-verifier` runs *before* the architecture
review because there is no point grading the architecture of work that is not the
agreed work. `architecture-reviewer` and `plan-verifier` are read-only the only way
that actually holds — no `Write`, no `Edit` — but both keep `Bash`, and the README
now records why that is a judgement call rather than a settled rule: Anthropic's SDK
docs omit `Bash` from their read-only example while their best-practices page ships a
read-only reviewer that includes it. Without it neither agent can do its job
(no `git diff` for scope, no `pnpm arch`, no re-running a plan's `verify` commands),
and a verifier that believes the Implementation Report verifies nothing. Two prompt
rules came straight out of measured failure modes rather than taste: `test-writer`'s
hard stop on weakening an assertion (agents delete failing tests instead of fixing
the bug) and `plan-verifier`'s forced per-item ledger with four fixed statuses (LLM
reviewers drift into generic advice, and get *worse* at conformance when asked to
explain themselves). The gate's only finding on the whole change was the expected
`pr-size` WARNING.
### 2026-09-22 — the two-day orphan on :3000/:3001
`./scripts/dev.sh` refused to start: both ports were held. The holders were
not a killed terminal but a **previous Claude session** — chain root
`claude.exe` (PID 24700), started 20.09, with the API leaf restarted at 16:30
today by `tsx watch`, which is why it looked current. Killed both trees,
then made it self-service: `scripts/free-port.ps1` (climb the wrapper chain,
`taskkill /T /F`, refuse anything not on the wrapper allowlist) and
`./scripts/dev.sh --free-ports`. Verified end to end — reclaim on a fake
`cmd -> node` chain, the full stack up afterwards (`/health` 200, web 200),
the default path still blocking with a PID and now a pointer to the flag, and
the allowlist refusing Docker on :5432.

### 2026-09-26 — L04: `mcp/` package (devdigest MCP server)
Added the fifth standalone package (`mcp/`, npm) as a stdio adapter over the
API, plus `.mcp.json`, `mcp.yml` and the pr-self-review gate routing for it.
The repo now has **five** packages; the `<pm>`-by-lockfile rule and the
lock-file do-not-touch list in `AGENTS.md` were extended rather than
special-cased. Package-local lessons (two distinct TS2589 sources with SDK
1.30.1, the measured tools/list budget) are in `mcp/INSIGHTS.md`.

### 2026-09-26 — L04: Blast Radius (server `modules/blast`, client panel, MCP tool)
Plan `specs/09-blast-radius.md` → contract step alone, then three implementers
in parallel on disjoint file lists (server / client+P3 / mcp): no conflicts, all
three lanes green first time. architecture-reviewer ∥ plan-verifier found one
WARNING (the `repo-intel/constants.ts` edge, kept on purpose because the
assignment's P2 asks for that file) and five suggestions, four applied. The
assignment text disagrees with the tree in three places — `githubBlobUrl` path,
route name, and `BFS_DEPTH` (only `getCriticalPaths` uses it; blast is 1-hop) —
and the tree won each time. Package-local lessons are in the three module files.

### 2026-09-29 — `planner` → `implementation-planner`, plans leave `specs/`
The planner had drifted into writing specs: `specs/08` and `specs/09` are
Development Plans with Problem/Contract/Acceptance sections, saved where agents
read current intent. Split it: specs are human-written input, the renamed agent
starts with a Requirements review (ledger quoting the spec with four statuses,
questions, recommendations, single-agent vs multi-agent question) and only then
emits an Implementation Plan, saved to the new `plans/NN-slug.md`. Multi-agent
means parallel `implementer` tracks with exclusive file ownership plus a shared
step 0 and an Integration step — the shape the Blast Radius session used by hand.
Verified by invocation on known ground truth (no automated check exists for
`.claude/**`): no mode → review block only; `mode: multi-agent` on `specs/09` →
disjoint Tracks table, step 0 shared, Integration last; `mode: single-agent` on a
one-file request → the ledger caught that the request's premise contradicted the
tree (`mcp/src/index.ts:27-29`: a stopped API gives per-call "not reachable", not
CONNECTION_CLOSED — that one is a missing `mcp/node_modules`) and returned
questions instead of a plan.

### 2026-09-29 — `spec-creator` in front of the planner; specs get a template
Specs were "human-written" in the chain above and still on the old
Problem/Scope/Contract/Acceptance shape. Added `.claude/agents/spec-creator.md`
(opus; Write/Edit limited by prompt text to the five spec folders; `security`
preloaded for the *Untrusted inputs* table) and rewrote `specs/README.md` to the
EARS template with `Status` and a dated `YYYY-MM-DD-short-name` stem as the Spec ID
(no ticket numbers exist, and a bare counter told nobody what a spec was about);
`implementation-planner`
and `plan-verifier` now read `AC-n`/`EC-n` instead of `## Acceptance`. Two
things the smoke run taught: a markdown mockup under `specs/designs/<slug>/` is
enough for the *Design review* — the agent caught that the mockup's HIGH/MEDIUM
labels do not exist in `Severity` (`server/src/vendor/shared/contracts/findings.ts`)
and that the "evidence quote" maps to no contract field, and turned both into a
blocking Open question rather than inventing a contract; and a hard write
boundary was declined on purpose — a `PreToolUse` hook is the only real fence,
and the README's "no hooks in frontmatter" rule stands until an agent misfires.
Second pass, same day, after a review of the first smoke specs: the 301-line
spec for a copy button showed the agent drifting into a plan (it cited
`icons.tsx:20`, `fireEvent`, border longhands under NFRs), so the template,
EARS rules, a size budget, a "spec smells" list and a self-check moved into a
preloaded `spec-writing` skill (a repo file reaches every run fresh; the agent
body does not, see *Tool & Library Notes*). `scripts/spec-lint.mjs` checks the
structure and the gate's `staticRules` runs it on every changed spec
(`.claude/hooks/pr-self-review-gate.mjs`, after the e2e-flow block) — the
first machine check on a markdown file, verified with a malformed probe (2
CRITICAL + 12 WARNING, then exit 0 once removed). Research goes through
`researcher`: the agent gets `Agent` but the body handles the harness
withholding it below the spawn-depth limit by returning a *Research needed*
block.

### 2026-09-29 — SDD workflow audit: verify script, skill loading, chain order
Audited the eight agents against the token cost of one feature. The waste was
not the models but verification: four agents each re-ran full suites with the
default reporter, and the implementer re-loaded the same skills per step.
Added `scripts/verify.mjs` (one line per command, dot reporter, per-tree cache),
the write-time/review-time split in `routing.md`, once-per-run skill loading,
the planner's own `Write` into `plans/`, the verifier's delta mode, the
implementer's fix-loop input, and `test-writer ∥ architecture-reviewer` after
the first verifier pass. Dropped two preloads (`security` on spec-creator,
`react-testing-library` on test-writer). Fixed the stale "four lock-files /
npm for reviewer-core/e2e" in implementer and test-writer — `mcp/` had been
missing since 2026-09-26. `mcp/node_modules` was absent on this machine, which
is the CONNECTION_CLOSED the devdigest MCP server showed at session start;
`npm ci` in `mcp/` fixed it. Second half of the session: `/run-plan` (the
build half as one resumable command with capped fix loops, test-writer and
doc-writer opt-in), the implementer's fix-loop input generalised to Plan
Conformance, Architecture Review and gate `report.json` findings, and the two
reviewers moved to sonnet.


### 2026-09-29 — Project Context: first full `/run-plan` run
Spec (spec-creator, 3 clarifications) → approved → plan (multi-agent, 15 steps) →
`/run-plan`. Build was clean; the only real defect was found by the integration
lane, not by any reviewer: js-tiktoken hanging on a 64 KB whitespace-free fixture
(server Tool & Library Notes). The verify fix-loop cap was hit on a red test that a
clean-HEAD worktree proved pre-existing (`run-cost.it`), so the person waived it
and resumed with `--from arch`. Two process lessons: the orchestrator's baseline
worktree corrupted `server/node_modules` via `pnpm exec` (What Doesn't Work), and
an auto-mode classifier outage mid-chain blocked every mutating tool for ~20 min;
the reports in `.devdigest/sdd/<stem>/` were enough to resume cold.

### 2026-10-01 — Onboarding Generator: the chain run by hand, one commit per stage
The person drove every stage separately: spec-creator, then 15 questions put
to the person, then approval, then implementation-planner (4 decisions), then
the implementer in waves, then plan-verifier, then arch ∥ test-writer, then a
delta verify. Each stage was committed, using `--allow-empty` when only
git-ignored reports changed, so `git log` reads as the chain. Neither the
implementer nor either reviewer caught a real AC-6 bug that test-writer found (root-level `test/`
leaking into the reading path; see server What Doesn't Work). Running
`test-writer ∥ architecture-reviewer` after the first verify paid off.
A decision that changed an *approved* spec made spec-creator write a
superseding spec rather than edit it. Because the spec was unbuilt, the person
chose an in-place amendment instead, keeping the stem the plan already used.
The orchestrator repeated the known `pnpm exec`-in-a-worktree mistake (What
Doesn't Work, 2026-09-29) because it skipped reading root INSIGHTS first. This
time the install failed before touching anything.

### 2026-10-02 — /run-plan on PR Brief (multi-agent, 2 tracks + e2e)

**Fix loop.** The first verify had four PARTIAL rows where the code was right and a plan line was
stale (`diffPaths` prop, two e2e locator steps). The implementer may not edit the plan in a fix loop,
so it skipped them. The orchestrator edited those plan lines and marked each "Amended during build";
the delta verifier then accepted them. Before sending a PARTIAL row to the implementer, check whether
it is a stale plan line rather than a code gap.

**Review and counts.** The "cross-model" plan review ran on Claude Fable 5.1, the same family; the
person accepted that. The plan said "17 fact pairs" but listed 16, which step 0 caught.

### 2026-10-05 — L06 harness evals on this repo
`upstream/l06-evals` cases were written against the template repo: workflow paths
(`server/docs/api-contracts.md`, …) do not exist here, and the agent practices expected a rule
catalogue (`reviewer-core-zero-io`) that our `architecture-reviewer` does not have. Adapt cases to
this repo's `AGENTS.md` "Read when" rows and report format, never the agent to the cases.
`eval:delta` paired by full nodeid, so strict vs lite never lined up; it now pairs by case name
(`evals/src/delta.ts:69`). The onion rule-10 break moved only the *citation* practice
(100 → 50 → 100): the model finds the reach-in without the rule, and the skill adds the rule name.

### 2026-10-06 — /run-plan on eval case authoring (multi-agent, 2 tracks)
Step 0 → A ∥ B → Integration needed no fix loops; test-writer's only real add was the foreign-workspace
404 sweep the ledger had flagged as unexercised. The orchestrator made the `pnpm exec`-in-a-junctioned-worktree
mistake (What Doesn't Work, 2026-09-29) for the **third** time, again by baselining a red it-test before
reading root INSIGHTS. pnpm 10 stopped at `ERR_PNPM_IGNORED_BUILDS` before relinking anything (no
`server/node_modules` link pointed at the worktree afterwards). Read root INSIGHTS **before** any baseline run.

### 2026-10-06 — architecture-reviewer before/after on Sonnet (strict vs lite)
Edit under test: `architecture-reviewer-lite.md` drops the required `Rule:` line and softens step 5
from "a finding is a boundary break with a named rule, or it is not a finding" to "prefer findings
that trace back to a rule". Model and judge `claude-sonnet-5`, subscription, `-n 2`, sha `0397565`.
Scores, strict → lite: checkout diff 2/2 → 2/2; benign rename **2/2 → 1/2**; reviewer-core citation
1/1 → 2/2 (strict also timed out 3 times, see Tool & Library Notes); out-of-scope security diff
0/2 → 0/2. The one real delta is the benign rename. Without the citation rule the agent invented a
WARNING-or-higher finding on a diff that breaks no rule. The rule buys precision, at a cost: strict
used ~40% more output tokens on the checkout case and about 2× wall time on reviewer-core. The n=2
Haiku series of 2026-10-05 was 4/8 vs 4/8, which is noise. Keep the strict definition.
Both variants fail "does not comment on naming, style or test coverage" on every run, so that
practice measures the case, not the edit.

## Open Questions

- 2026-09-18 — The pr-self-review PreToolUse hook matches on command text, so a
  `git push` inside a heredoc or a quoted string is blocked too. Fail-closed is
  the right default for a gate, but if it becomes a nuisance the fix is a real
  shell tokenizer, not a looser regex.
- 2026-09-20 — Is an `imported_file` skill meant to stay inert as instructions
  after the user enables it? Today it is (see the 2026-09-20 Codebase Patterns
  entry): the "needs vetting" badge clears, the block appears in the trace, but
  the wrap makes the model read it as data. Either enabling should also lift the
  wrap (the user vetted it), or the badge should say the skill is advisory
  context, not rules. Unresolved; not changed by the conventions spec.
- 2026-09-20 — Lab criterion 21 says the `git push` auto-invocation of
  `pr-self-review` is **off** and the skill is run by hand on a mixed diff. This
  tree enables both the `PreToolUse` gate and `.githooks/pre-push`. Options and
  a recommendation are in `specs/05-skills-lab-criteria-gaps.md` §21; the
  author decides.

- 2026-09-26 — The `tsx watch` API on :3001 (started 18:21 from this worktree)
  kept answering 404 on `/pulls/:id/blast-radius` after `modules/index.ts`
  changed, so the new module never loaded without a manual restart. Unverified
  whether tsx's watcher misses files created after start on a Windows worktree
  path with spaces; if it recurs, restart `pnpm dev` after adding a module.

- 2026-10-05 — `architecture-reviewer` (strict) flagged the skipped `groundFindings()` gate in only
  1/2 runs and never named a rule for it, while the lite variant flagged it 2/2. The grounding
  gate has no named rule in `.claude/skills/pr-self-review/routing.md` (only `do-not-touch` on
  `grounding.ts`), so the citation requirement may push the strict agent to drop what it cannot
  cite. Undecided: add a named judgement rule for "findings bypass the grounding gate".
