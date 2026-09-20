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

## What Doesn't Work

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
  chain, not just the listener. Second signature of the same orphan (2026-09-20):
  an orphaned `next dev` keeps serving its **old module graph**, so after files
  are deleted or moved it answers 404 on routes that exist (`/agents`) and 500 on
  the changed one while `pnpm build` is green. A 404 on a route you did not touch
  means "restart the web process", not "find the bug".

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

## Codebase Patterns

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

## Tool & Library Notes

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
  do not need it.

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
an orphaned `next dev` serves a dead module graph (404 on existing routes)
and must be killed, not debugged. `./scripts/e2e.sh` still cannot run here
(`agent-browser` not on PATH); the flows were updated and the UI verified
through the browser pane instead.

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
