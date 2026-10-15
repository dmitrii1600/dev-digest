# Implementation Plan: Export to CI — wizard, GitHub Actions install, verified pull ingest, CI Runs

**Plan ID:** 2026-10-11-export-to-ci  ·  **Spec:** [specs/2026-10-11-export-to-ci.md](../specs/2026-10-11-export-to-ci.md)  ·
**Execution mode:** multi-agent (2 parallel tracks)  ·  **Packages:** server, client  ·
**Implementer instances:** 4 planned: step 0, Track A, Track B, Integration. The cap is 5, which leaves 1 for a single fix loop.
**Assumptions:** the spec is still `Status: draft`, but the user approved it for planning on 2026-10-11. The user approved Q1–Q5 as recommended, plus the `.gitattributes` addition (R41). `scripts/dev.sh` is **not** changed (see Recommendation 6).

## Summary
This plan adds a server `modules/ci` slice that does four things:
- turns an agent into the exported file set: manifest, enabled skills, `memory.jsonl`, the on-disk `agent-runner/dist/` bundle, a root `.gitattributes` that marks the bundle as generated (written only when the target repo has none), and a pinned least-privilege workflow;
- installs that set as a PR from `devdigest/ci`, or hands it over as a zip;
- pulls completed workflow runs back with the user's token;
- verifies each run against the installation and stores it once, as a `ci_runs` row plus an `agent_runs` row (`source='ci'`) with its trace.

On the client it adds three things: a CI tab with the 4-step wizard on the agent page, a `/ci-runs` page, and its sidebar entry. Existing contracts in `eval-ci.ts`, the `ci_*` tables, `agent_runs`, `run_traces` and `GitHubClient.commitFiles/findOpenPr/openPullRequest` are reused. A single additive migration adds only the fields that have no home. The work splits cleanly by package. Contracts and the GitHub port come first (step 0). The server (A) and the client (B) are then built in parallel, and an Integration pass runs the one full verify.

## Requirements review

**What I understood:** build the studio side of Export-to-CI (wizard → PR or zip, pull-based verified ingest, CI tab + CI Runs page), consuming the locally built `agent-runner/dist/` unchanged.
**Inputs read:** specs/2026-10-11-export-to-ci.md (amended: runner guard exception, installation records manifest version/model/runner sha256) · request text · coordinator addendum (`.gitattributes`, user-approved) · AGENTS.md · server/AGENTS.md · client/AGENTS.md · agent-runner/CLAUDE.md + README.md · INSIGHTS.md · server/INSIGHTS.md · client/INSIGHTS.md · agent-runner/insights/INSIGHTS.md · design jsx under specs/designs/export-to-ci/.

### Requirements ledger
| # | Requirement (quoted, trimmed) | Source | Status |
|---|---|---|---|
| R1 | "CI deployment … Active in N repos … Update CI config … Add to CI … one row per installation … workflow version … dashed Add repository" | §AC-1 | clear |
| R2 | "Fail CI on … exactly Critical, Warning + and Never, bound to the agent's `ci_fail_on`" | §AC-2 | clear (tree: an agent may already hold `any`, [knowledge.ts:480](../server/src/vendor/shared/contracts/knowledge.ts:480); then no option is selected) |
| R3 | "Export to CI modal with the steps Target, Preview, Configure and Install … GitHub Actions only and a repository picker" | §AC-3 | clear |
| R4 | "Preview … list each file … with its full contents … `.devdigest/runner/` … the only editable file is the workflow" | §AC-4 | clear after Q1 (user-approved) |
| R5 | "manifest shall parse under the same `AgentManifest` schema" | §AC-5 | clear |
| R6 | "workflow … pull_request only … permissions contents: read, pull-requests: write … pinned … skip forks … upload artifact … no pull_request_target" | §AC-6 | clear |
| R7 | "Configure … opened and synchronize (on), reopened (off) … three publication modes … static text" | §AC-7 | contradicts tree — `CiExportInput.triggers` defaults to all three, [eval-ci.ts:417](../server/src/vendor/shared/contracts/eval-ci.ts:417); fixed in step 0 |
| R8 | "Open a PR … commit to `devdigest/ci` … reuse or open 'Add DevDigest CI review' … record manifest version, model, runner sha256 … next steps" | §AC-8 (amended) | clear |
| R9 | "Download zip … exactly the previewed files … write nothing to GitHub, and record the installation" | §AC-9 | clear |
| R10 | "Update CI config … regenerate … commit … record the new workflow version" | §AC-10 | clear |
| R11 | "accept a run only when … repository id … workflow path … head SHA … ≤ 64 KiB, parses as CiResultArtifact … PR number among the run's pull requests" | §AC-11 | clear; repo id needs a new column (Q3, approved) |
| R12 | "store it once as an `agent_runs` row with `source='ci'` … linked to repository, PR number, commit SHA, per-severity counts, job URL … trace records manifest version, model, runner identity, skill slugs, commit SHA" | §AC-12 (amended) | clear after Q4 (approved): `agent_runs.pr_id` stays NULL; the link lives on `ci_runs` |
| R13 | "CI Runs … table, newest first … timestamp, repository, PR number and title, agent, status, findings per severity, cost, duration, job link … agent and repository filters and Refresh" | §AC-13 | clear |
| R14 | "CI tab shall list the agent's CI runs … same columns … except agent" | §AC-14 | clear |
| R15 | "No CI runs yet … Set up CI for an agent … Not in CI yet … Add to CI" | §AC-15 | clear |
| R16 | "sidebar shall list 'CI Runs' under Global and mark it active on `/ci-runs`" | §AC-16 | clear — no GLOBAL section exists today, [nav.ts:21-38](../client/src/vendor/ui/nav.ts:21); a new `GLOBAL` group is added. The active key is already mapped at [helpers.ts:38](../client/src/components/app-shell/helpers.ts:38) |
| R17 | "GitHub refuses the commit or the PR → GitHub's error message, no installation, offer Download zip" | §EC-1 | clear |
| R18 | "repository already has a CI installation for another agent → refused naming that agent" | §EC-2 | clear |
| R19 | "Install again for same agent and repository → one open PR, one installation" | §EC-3 | clear |
| R20 | "edited workflow does not parse as YAML → Install disabled, parse error shown" | §EC-4 | clear after Q2 (approved: the `yaml` package goes into the client) |
| R21 | "enabled skill flagged by the existing injection scan → left out, Preview names it skipped" | §EC-5 | clear after Q5 (approved: the scan moves to `_shared`) |
| R22 | "completed run fails any check → failed with 'result rejected', no counts or cost" | §EC-6 | clear |
| R23 | "no `devdigest-result` artifact or expired → failed with 'no result produced' and its job link" | §EC-7 | clear |
| R24 | "Refresh covers stored runs → each GitHub run stored once" | §EC-8 | clear |
| R25 | "GitHub unreachable or rate-limited during Refresh → stored runs stay visible, error with retry" | §EC-9 | clear |
| R26 | "runner bundle not built → Preview tells the user to run `pnpm build` in `agent-runner`, both install paths disabled" | §EC-10 | clear |
| R27 | "no imported repository → Target says import first, Continue disabled" | §EC-11 | clear |
| R28 | "generator reads no secret … no file, zip, row, trace or log contains an LLM key or GitHub token" | §NFR-1 | clear |
| R29 | "export, update and ingest make zero LLM calls" | §NFR-2 | clear |
| R30 | "every user-facing string … from `messages/en/ci.json`" | §NFR-3 | contradicts tree — ci.json:71 says "Requires a GitHub App" (DR-20); the file is rewritten in step 6 |
| R31 | "wizard operable by keyboard … status and severity as text or icon" | §NFR-4 | clear |
| R32 | Untrusted: repository choice → "an imported repository of this workspace … 404" | §Untrusted inputs | clear |
| R33 | Untrusted: edited workflow YAML → "≤ 64 KiB, parses as YAML" | §Untrusted inputs | clear (the server re-checks; the client disables Install) |
| R34 | Untrusted: export body → "`.strict()`; triggers ⊆ {opened, synchronize, reopened}, at least 1 → 422" | §Untrusted inputs | contradicts tree — `CiExportInput` is not strict and triggers are free strings, [eval-ci.ts:411-419](../server/src/vendor/shared/contracts/eval-ci.ts:411); fixed in step 0 |
| R35 | Untrusted: workflow run metadata → "repository id and workflow path equal the installation's; head SHA present" | §Untrusted inputs | clear |
| R36 | Untrusted: `devdigest-result.json` → "CiResultArtifact, ≤ 64 KiB; PR number among the run's PRs" | §Untrusted inputs | clear |
| R37 | Untrusted: PR title, agent name → "plain text, truncated" | §Untrusted inputs | clear |
| R38 | Untrusted: `/ci/runs` filters → "uuids → 422" | §Untrusted inputs | clear |
| R39 | Module interaction "Fail CI on → `PATCH /agents/:id`" | §Design review | contradicts tree — the agent update is `PUT /agents/:id`, [client/src/lib/hooks/agents.ts:64](../client/src/lib/hooks/agents.ts:64); the plan reuses `useUpdateAgent` |
| R40 | "no other agent-runner edits" (amendment a); dist is local, git-ignored, embedded whole | §Non-goals, Q-5 | clear — `git check-ignore` confirms `agent-runner/.gitignore:2` ignores `dist/`. The stale root comment at [.gitignore:3-6](../.gitignore:3) is left alone (follow-up) |
| R41 | "the exported file set (PR and zip, preview list) also includes a generated `.gitattributes` in the target repo root containing `.devdigest/runner/** linguist-generated=true` … If the target repo already has a `.gitattributes` … skip writing ours (don't merge) — mention in the preview list only when written" | coordinator addendum, user-approved 2026-10-11 | clear — existence is checked on GitHub (new port method, step 0). When GitHub cannot be read (no token or any error), the file is **omitted**, so an existing `.gitattributes` is never overwritten |

### Questions relayed to the user — all approved as recommended (2026-10-11)
1. **The edited workflow vs Configure.** If the workflow was not edited, it is regenerated from the Configure choices whenever Preview reloads. If it was edited, the edit is sent verbatim, and Configure shows a note that its choices are not applied to it. "Update CI config" regenerates from the stored settings, which overwrites manual edits; the CI tab says so.
2. **The `yaml@^2.6.1` package** is added to `server` and `client` via `pnpm add`.
3. **One additive migration:**
   - `ci_installations`: `agent_version`, `github_repo_id`, `export_meta`;
   - `ci_runs`: `github_run_id` (unique), `head_sha`, `pr_title`, `critical`/`warning`/`suggestion`, `agent_run_id` (FK, indexed).
4. **CI `agent_runs.pr_id` stays NULL.** This keeps CI out of the PR-list rollup ([pulls/routes.ts:177-179](../server/src/modules/pulls/routes.ts:177)) and the PR run history ([run.repo.ts:47-51](../server/src/modules/reviews/repository/run.repo.ts:47)).
5. **`modules/skills/injection-scan.ts` and `SCANNED_SOURCES` move to `modules/_shared/injection-scan.ts`.**

### Recommendations
1. **One migration, additive only** — why: no column exists for repo id, workflow version, run identity, SHA or per-severity counts, [ci.ts:4-27](../server/src/db/schema/ci.ts:4). An add-only change avoids the drizzle-kit rename prompt ([server/INSIGHTS.md:351-357](../server/INSIGHTS.md:351)). Plan change: step 1. **adopted**
2. **CI `agent_runs.pr_id` stays NULL** — why: Q4. Plan change: step 4 repository. **adopted**
3. **Read every file in `agent-runner/dist/`, not a fixed list of three names** — why: `300.index.js` is an ncc chunk id that can change on a rebuild. Require `index.js` + `package.json`, embed all regular files. Plan change: step 4. **adopted**
4. **Injectable runner bundle (`ContainerOverrides.runnerBundle`)** — why: `server-integration.yml` runs `*.it.test.ts` without building `agent-runner` ([.github/workflows/server-integration.yml:65](../.github/workflows/server-integration.yml:65)), so an it-test must not depend on a real `dist/`. Plan change: steps 4–5. **adopted**
5. **Record the manifest path in `export_meta` and reuse it on update and re-install** — why: the runner hard-fails on more than one `.devdigest/agents/*.yaml` ([agent-runner/src/manifest.ts:41-45](../agent-runner/src/manifest.ts:41)), and `commitFiles` layers on the existing tree and never deletes ([octokit.ts:285-296](../server/src/adapters/github/octokit.ts:285)). Plan change: steps 3–4. **adopted**
6. **`scripts/dev.sh` builds the runner** — **not adopted**: it would add an `agent-runner` + `reviewer-core` install to every boot. EC-10's message plus the module README cover the one-time `cd agent-runner && pnpm install && pnpm build`.
7. **Fix the stale root `.gitignore:3-6` comment ("dist MUST be committed")** — **not adopted**: outside the scope. Recorded as a Follow-up.

### Execution mode
Stated by caller: at most 5 implementers. Chosen: **multi-agent**. `server` and `client` share no file. Four implementer instances in total.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](../AGENTS.md) | Stack, naming table, do-not-touch, verify flags |
| [server/AGENTS.md](../server/AGENTS.md) | Module = routes.ts + service.ts + one `modules/index.ts` entry; declarative zod; adapters via container |
| [client/AGENTS.md](../client/AGENTS.md) | Hooks over `lib/api.ts`; `nav.ts` is app-owned and editable; messages per namespace |
| [agent-runner/README.md](../agent-runner/README.md) | Env contract (`OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `PR_NUMBER`, `DEVDIGEST_POST_AS`); no artifact on hard failure; exit 1 on gate |
| [agent-runner/src/artifact.ts](../agent-runner/src/artifact.ts) | The artifact carries findings_count, critical/warning/suggestion, cost_usd, duration_ms, agent, version, pr_number |
| [server/src/vendor/shared/contracts/eval-ci.ts:370-476](../server/src/vendor/shared/contracts/eval-ci.ts:370) | Existing CI contracts (unused anywhere today; the server and client copies are identical) |
| [server/src/vendor/shared/contracts/trace.ts:93-111](../server/src/vendor/shared/contracts/trace.ts:93) | `RunTrace.config` already has `version`, `model`, `source:'ci'`; `log[]` holds free lines, so no contract change is needed |
| [server/src/vendor/shared/adapters.ts:143-190](../server/src/vendor/shared/adapters.ts:143) | `GitHubClient` port: commitFiles/findOpenPr/openPullRequest exist; no runs, artifacts or file existence |
| [server/src/adapters/github/octokit.ts](../server/src/adapters/github/octokit.ts) | `withRetry(withTimeout(…, 30s))` pattern for every call |
| [server/src/adapters/mocks.ts:126-266](../server/src/adapters/mocks.ts:126) | `MockGitHubClient` records `committed`/`openedPrs`; findOpenPr derives from openedPrs |
| [server/src/platform/container.ts:62-86,287-294](../server/src/platform/container.ts:62) | `ContainerOverrides`; `github()` throws `ConfigError` without a token |
| [server/src/db/schema/repos.ts](../server/src/db/schema/repos.ts) | `repos.full_name`, `default_branch`; no GitHub repo id |
| [server/src/db/schema/runs.ts:17-57](../server/src/db/schema/runs.ts:17) | `agent_runs` columns incl. `source`, `blockers`, `error` |
| [server/src/modules/skills/repository.ts:232-253](../server/src/modules/skills/repository.ts:232) | The "enabled skills" predicate = `agent_skills.enabled AND skills.enabled`, ordered |
| [server/eslint.config.mjs:79-93,114-130](../server/eslint.config.mjs:114) | Ring 2 bans `node:fs`, `zod` and adapters; the `RING_2` list names special files by path |
| [server/package.json](../server/package.json) | `fflate` already a dependency (zip + unzip); no `yaml` |
| [client/src/i18n/request.ts](../client/src/i18n/request.ts) | Every `messages/en/*.json` is auto-loaded as a namespace |
| [client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx:17-30](../client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx:17) | Tab rendering switch; Config is the fallback branch |
| [client/src/components/app-shell/nav.test.ts](../client/src/components/app-shell/nav.test.ts) | Pattern for nav tests |
| [.claude/skills/pr-self-review/routing.md:34-50](../.claude/skills/pr-self-review/routing.md:34) | Write-time skill set |
| `git ls-remote` of actions/checkout, setup-node, upload-artifact (2026-10-11) | Current pins (see step 3) |
| `remotes/upstream/full-functionality:server/src/modules/ci/**` | A prior, larger design. **Reference only**: do not copy it; it carries features that are out of scope here |

## Insights that bind this work
1. **Mirror a contract into the client copy in the same change** — [INSIGHTS.md:299-304](../INSIGHTS.md:299). Step 0 edits `eval-ci.ts` and `adapters.ts` in both `server/src/vendor/shared` and `client/src/vendor/shared`. It checks equality with `diff --strip-trailing-cr`, not raw `diff` ([INSIGHTS.md:227-231](../INSIGHTS.md:227)).
2. **Ring 2 cannot touch the filesystem, and a module cannot import another module's folder** — [server/INSIGHTS.md:202-223](../server/INSIGHTS.md:202). The disk read of `agent-runner/dist/` goes in ring-3 `modules/ci/repository-bundle.ts`. Ports go in `modules/ci/types.ts`, listed in `RING_2` like `evals/types.ts` ([server/INSIGHTS.md:336-340](../server/INSIGHTS.md:336)). The injection scan moves to `modules/_shared/` (Q5). `modules/ci/repository.ts` runs its own agent, skill, repo and memory queries.
3. **A green `--it` proves nothing when Docker is down, and `tsc` never sees `server/test/**`** — [server/INSIGHTS.md:139-146](../server/INSIGHTS.md:139). Every `--it` verify is preceded by `docker info`, and the output is checked for skipped files. After the `GitHubClient` port grows (step 0), `grep -rn "GitHubClient" server/test` is run by hand to find fakes.

Also honoured:
- [INSIGHTS.md:292-297](../INSIGHTS.md:292): null cost stays null; the UI shows "—".
- [client/INSIGHTS.md:288-290](../client/INSIGHTS.md:288): `ErrorState` takes only `title` + `onRetry`.
- [client/INSIGHTS.md:75-79](../client/INSIGHTS.md:75): no dialog nested inside the wizard `Modal`.
- [client/INSIGHTS.md:230-237](../client/INSIGHTS.md:230): `page.tsx` stays a server component.
- [server/INSIGHTS.md:358-364](../server/INSIGHTS.md:358): a body-less POST still needs `{}`.

"What Doesn't Work" check:
- **drizzle-kit interactive prompt** ([server/INSIGHTS.md:351-357](../server/INSIGHTS.md:351)): safe, because the migration only adds columns.
- **The Windows `file://` guard** ([INSIGHTS.md:82-94](../INSIGHTS.md:82)) is the very bug the one allowed `agent-runner/src/index.ts` edit fixed. The current `dist/index.js` already contains `pathToFileURL`. Do not touch it again.

## Constraints
- **Onion rings (server)**, enforced by `pnpm lint` + `pnpm arch`:
  - `modules/ci/constants.ts`, `helpers.ts`, `service.ts` and `types.ts` are ring 2. No `node:fs`, no `zod` import, no `**/adapters/**`. `@devdigest/shared` schemas, `yaml`, `fflate` and `node:crypto` are fine.
  - `modules/ci/repository.ts` and `repository-bundle.ts` are ring 3, and import only *types* from `./types.js`.
  - `modules/ci/routes.ts` is ring 4.
  - `modules/_shared/injection-scan.ts` is ring 2.
  - `platform/container.ts` is the composition root and may import `modules/ci/**`.
- **Contract once + mirror**: every change to `server/src/vendor/shared/contracts/eval-ci.ts` and `server/src/vendor/shared/adapters.ts` is made in `client/src/vendor/shared/…` in the same step (step 0 only).
- **`.js` relative imports** in every new server file.
- **DB tests are `*.it.test.ts`**: `server/test/ci.it.test.ts`. The hermetic tests are `server/test/ci-*.test.ts` without `.it`.
- **Declarative validation**: zod `params`/`querystring`/`body`/`response` on every route, `.strict()` bodies, POST bodies required (send `{}`).
- **Secrets**: the GitHub token comes only from `container.github()`. No code reads `OPENROUTER_API_KEY`. The generated workflow names `secrets.OPENROUTER_API_KEY` and `github.token` and holds no value.
- **No `fetch` in a client component**: hooks in `client/src/lib/hooks/ci.ts` over `client/src/lib/api.ts`.
- **i18n**: every CI string goes in `client/messages/en/ci.json`. The tab label goes in `client/messages/en/agents.json` → `editor.tabs.ci`.
- **Naming**: `_components/<Name>/<Name>.tsx` + `<Name>.test.tsx`. The migration is generated (`NNNN_*.sql`), never named by hand.
- **Do not touch**:
  - `server/src/db/migrations/0000–0020`;
  - the five lock-files (change `server/pnpm-lock.yaml` and `client/pnpm-lock.yaml` **only** by `pnpm add` in that folder);
  - `agent-runner/**`, including `dist/`, which is read-only input, never minified, never committed;
  - `reviewer-core/**`;
  - `modules/reviews/**` (the multi-run service, the run executor) and `modules/pulls/**` (the PR feed).
- **Spec bounds down the stack**:
  - **64 KiB caps**: `z.string().max()` counts UTF-16 units, so the server additionally checks `Buffer.byteLength(text,'utf8') <= 65_536` for the workflow. The adapter refuses an artifact whose `size_in_bytes` or unzipped entry exceeds `maxBytes`.
  - **Request body size**: the Fastify `bodyLimit` of 1 MiB ([app.ts:49](../server/src/app.ts:49)) is fine, because install sends only the workflow (≤ 64 KiB) and never the runner bundle.
  - **GitHub timeouts**: calls keep the existing 30 s `TIMEOUT` ([octokit.ts:17](../server/src/adapters/github/octokit.ts:17)).

## Skill contract
| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/eval-ci.ts` (+ client mirror) | `zod` | contract shapes, `.strict()`, defaults |
| `server/src/vendor/shared/adapters.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts` | `onion-architecture` | port in ring 1, adapter in ring 3 |
| `server/src/db/schema/ci.ts` + generated migration | `drizzle-orm-patterns`, `postgresql-table-design` | additive columns, unique index, FK index |
| `server/src/modules/ci/{constants,helpers,types,service}.ts`, `modules/_shared/injection-scan.ts`, `platform/container.ts` | `onion-architecture` | ring placement |
| `server/src/modules/ci/repository*.ts` | `onion-architecture`, `drizzle-orm-patterns` | ring 3 queries, transaction, `onConflictDoNothing` |
| `server/src/modules/ci/routes.ts`, `modules/index.ts` | `onion-architecture`, `fastify-best-practices` | route = ring boundary + HTTP surface (`security` is the gate's, review-time) |
| `client/src/lib/hooks/ci.ts`, `client/src/components/ci-runs-table/**`, `client/src/app/**/_components/**` | `frontend-ui-architecture`, `react-best-practices` | placement + component rules |
| `client/src/app/ci-runs/page.tsx`, files with `'use client'` | `next-best-practices` | RSC boundary |
| `client/**/*.test.tsx` | `react-testing-library` | component tests (`fireEvent`, no user-event) |

Derived from the write-time row of `.claude/skills/pr-self-review/routing.md`. Each skill is loaded once per implementer run, at the first step that needs it.

## Tracks
| Track | Owned files (exclusive) | Steps | Verify | May start after |
|---|---|---|---|---|
| 0 — shared | `server/src/vendor/shared/contracts/eval-ci.ts`, `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/adapters.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`, `server/test/ci-contracts.test.ts` | 0 | `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs client --checks` · `node scripts/verify.mjs server --file server/test/ci-contracts.test.ts` | — |
| A — server | `server/package.json`, `server/pnpm-lock.yaml`, `server/src/db/schema/ci.ts`, `server/src/db/migrations/0021_*.sql` + `meta/**` (generated), `server/src/modules/ci/**`, `server/src/modules/_shared/injection-scan.ts`, `server/src/modules/skills/{helpers,service,constants}.ts`, `server/src/modules/skills/injection-scan.ts` (deleted by the move), `server/src/modules/index.ts`, `server/src/platform/container.ts`, `server/eslint.config.mjs`, `server/test/ci-helpers.test.ts`, `server/test/ci-service.test.ts`, `server/test/ci.it.test.ts`, `server/test/skills-injection-scan.test.ts`, `server/README.md`, `server/AGENTS.md`, `.claude/skills/onion-architecture/layers.md` | 1–5 | `node scripts/verify.mjs server --checks` · `--file` per step | step 0 |
| B — client | `client/package.json`, `client/pnpm-lock.yaml`, `client/messages/en/ci.json`, `client/messages/en/agents.json`, `client/src/lib/hooks/ci.ts`, `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx}`, `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**`, `client/src/components/ci-runs-table/**`, `client/src/app/ci-runs/**`, `client/src/vendor/ui/nav.ts`, `client/src/components/app-shell/nav.test.ts`, `client/README.md` | 6–9 | `node scripts/verify.mjs client --checks` · `--file` per step | step 0 |
| shared — integration | none of its own; may edit any file of A or B only to fix a cross-track mismatch found by the full run | 10 | `node scripts/verify.mjs server client` + `node scripts/verify.mjs server --it` (the one full run) | A, B |

No path appears in two rows. Each track is one `implementer` invocation. The two tracks are in different packages, so they never share a typecheck.

## Steps

### 0. Contracts, the GitHub port and its two implementations (tree compiles)
- **Files:**
  - [`server/src/vendor/shared/contracts/eval-ci.ts`](../server/src/vendor/shared/contracts/eval-ci.ts) (edit) and [`client/src/vendor/shared/contracts/eval-ci.ts`](../client/src/vendor/shared/contracts/eval-ci.ts) (edit, byte-identical mirror);
  - [`server/src/vendor/shared/adapters.ts`](../server/src/vendor/shared/adapters.ts) (edit) and [`client/src/vendor/shared/adapters.ts`](../client/src/vendor/shared/adapters.ts) (edit, mirror);
  - [`server/src/adapters/github/octokit.ts`](../server/src/adapters/github/octokit.ts) (edit) and [`server/src/adapters/mocks.ts`](../server/src/adapters/mocks.ts) (edit);
  - `server/test/ci-contracts.test.ts` (new).
- **Track:** shared
- **Layer:** ring 0/1 contracts + port; ring 3 adapter.
- **Skills:** `zod`, `onion-architecture`
- **Prerequisite:** `client/node_modules` is absent in this worktree. Run `cd client && pnpm install --frozen-lockfile` once. It installs only and changes no tracked file.
- **Do (contracts, `eval-ci.ts`):**
  - Add `CiTrigger = z.enum(['opened','synchronize','reopened'])`, `CiPostAs = z.enum(['github_review','pr_comment','none'])`, and `export const CI_MAX_BYTES = 65_536` (used for both the workflow and the artifact).
  - `CiExportInput` becomes `.strict()`, with these fields:
    - `repo`: `z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)`;
    - `target`: `z.literal('gha').default('gha')`;
    - `action`: `z.enum(['open_pr','files']).default('open_pr')`;
    - `post_as`: `CiPostAs.default('github_review')`;
    - `triggers`: `z.array(CiTrigger).min(1).max(3).default(['opened','synchronize'])`;
    - `workflow_yaml`: `z.string().max(CI_MAX_BYTES).optional()`;
    - **remove `base`**, because the base comes from `repos.default_branch`.
  - `CiInstallation` adds `agent_version: z.number().int()`. `CiExport` adds `zip_base64: z.string().nullable()`.
  - `CiRun` adds, all `.nullish()`: `repo`, `pr_title`, `head_sha`, `agent_id`, `critical`, `warning`, `suggestion` (int), and `failure_reason: z.enum(['result_rejected','no_result'])`.
  - New schemas:
    - `CiPreview = { files: CiFile[], skipped_skills: string[], bundle_missing: boolean }`;
    - `AgentCi = { installations: CiInstallation[], runs: CiRun[] }`;
    - `CiUpdateResult = { results: { repo: string, pr_url: string|null, error: string|null }[] }`;
    - `CiRefreshInput = z.object({ agent_id: z.string().uuid().optional() }).strict()`;
    - `CiRefreshResult = { ingested: number }`.
  - Leave `AgentManifest`, `CiResultArtifact`, `CiFile` and `CiTarget` unchanged. `.gitattributes` is an ordinary `CiFile`.
- **Do (port, `adapters.ts`):** add the following. Limits travel in as call options ([server/INSIGHTS.md:233-238](../server/INSIGHTS.md:233)).
  ```ts
  interface WorkflowRunMeta { id: number; head_sha: string | null; repository_id: number; path: string;
    html_url: string; conclusion: string | null; display_title: string; updated_at: string; pull_requests: number[] }
  type ArtifactDownload = { kind: 'ok'; text: string } | { kind: 'missing' } | { kind: 'expired' } | { kind: 'too_large' };
  // GitHubClient +=
  getRepoId(repo: RepoRef): Promise<number>;
  /** True when `path` exists on `ref` (default branch). 404 → false; any other error throws. */
  pathExists(repo: RepoRef, path: string, ref: string): Promise<boolean>;
  listWorkflowRuns(repo: RepoRef, workflowFile: string, perPage: number): Promise<WorkflowRunMeta[]>;
  downloadRunArtifact(repo: RepoRef, runId: number, opts: { name: string; fileName: string; maxBytes: number }): Promise<ArtifactDownload>;
  ```
- **Do (Octokit):**
  - `getRepoId` uses `rest.repos.get` → `data.id`.
  - `pathExists` uses `rest.repos.getContent({ path, ref })`: `true` on 200, `false` when the error has `status === 404`, rethrows otherwise.
  - `listWorkflowRuns` uses `rest.actions.listWorkflowRuns({ workflow_id: workflowFile, status: 'completed', event: 'pull_request', per_page })`, mapped to `WorkflowRunMeta`, with `pull_requests` reduced to their numbers.
  - `downloadRunArtifact`:
    - calls `rest.actions.listWorkflowRunArtifacts({ run_id, name })`;
    - returns `missing` when there is none and `expired` when `expired` is set;
    - returns `too_large` when `size_in_bytes > maxBytes`, without downloading;
    - otherwise calls `rest.actions.downloadArtifact({ archive_format: 'zip' })`, then fflate `unzipSync`;
    - returns `missing` when the `fileName` entry is absent and `too_large` when the entry exceeds `maxBytes`;
    - otherwise returns `strFromU8` as `ok`.
  - Every call is wrapped in `withRetry(withTimeout(…, TIMEOUT))` like its neighbours.
- **Do (Mock):** add these `MockGitHubOptions`:
  - `repoId?: number` (default `4242`);
  - `existingPaths?: string[]` (default `[]`), which `pathExists` reads;
  - `workflowRuns?: WorkflowRunMeta[]`;
  - `artifacts?: Record<number, ArtifactDownload>` (default `missing`);
  - `commitError?: string`, which makes `commitFiles` throw `new Error(commitError)`;
  - `runsError?: string`, which makes `listWorkflowRuns` throw.

  Record `listRunsCalls`, `artifactCalls` and `pathExistsCalls`. Then `grep -rn "GitHubClient" server/test` and widen any hand-written fake that must satisfy the port.
- **Done when:**
  - Both `eval-ci.ts` copies and both `adapters.ts` copies compare equal with `diff --strip-trailing-cr`.
  - `ci-contracts.test.ts` proves the input boundaries:
    - `triggers: []` → fail;
    - `['Opened']` (case variant) → fail;
    - `['pull_request_target']` (near-miss) → fail;
    - default → `['opened','synchronize']`;
    - an unknown key such as `base` → fail (strict);
    - `workflow_yaml` of 65 536 chars → pass and 65 537 → fail;
    - `repo: 'owner'` (no slash) → fail.
  - `CiRun` still parses an object holding only the pre-existing fields.
- **Verify:** `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs client --checks` · `node scripts/verify.mjs server --file server/test/ci-contracts.test.ts`

### 1. Server dependencies, schema and the one migration
- **Files:** [`server/package.json`](../server/package.json) and `server/pnpm-lock.yaml` (edit, via `cd server && pnpm add yaml@^2.6.1`) · [`server/src/db/schema/ci.ts`](../server/src/db/schema/ci.ts) (edit) · `server/src/db/migrations/0021_<generated>.sql` + `meta/` (new, via `cd server && pnpm db:generate`)
- **Track:** A
- **Layer:** ring 3 (`db/**`)
- **Skills:** `drizzle-orm-patterns`, `postgresql-table-design`
- **Do:**
  - `ciInstallations` gains `agentVersion: integer('agent_version').notNull().default(1)`, `githubRepoId: bigint('github_repo_id', { mode: 'number' })` and `exportMeta: jsonb('export_meta')`.
  - `ciRuns` gains:
    - `githubRunId: bigint('github_run_id', { mode: 'number' })`;
    - `headSha: text('head_sha')` and `prTitle: text('pr_title')`;
    - `critical`, `warning` and `suggestion` as `integer`;
    - `agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' })`;
    - the table callback with `uniqueIndex('ci_runs_github_run_uq').on(t.githubRunId)` and `index('ci_runs_agent_run_idx').on(t.agentRunId)`.

    Import `agentRuns` from `./runs`.
  - Generate. **Additive only**: nothing is renamed or dropped, so drizzle-kit asks no question. Never hand-write or rename the SQL.
- **Done when:** exactly one new migration file exists. It holds only `ADD COLUMN`, `CREATE UNIQUE INDEX` and `CREATE INDEX` statements plus the FK constraint, and migrations 0000–0020 are byte-unchanged (`git diff --stat HEAD -- server/src/db/migrations` lists only new files).
- **Verify:** `node scripts/verify.mjs server --checks`

### 2. Move the injection scan to `_shared`
- **Files:**
  - `server/src/modules/skills/injection-scan.ts` → `server/src/modules/_shared/injection-scan.ts` (move with `git mv`; content unchanged, plus `SCANNED_SOURCES` moved in from `skills/constants.ts:34`);
  - [`server/src/modules/skills/constants.ts`](../server/src/modules/skills/constants.ts) (edit: `export { SCANNED_SOURCES } from '../_shared/injection-scan.js'`);
  - [`server/src/modules/skills/helpers.ts`](../server/src/modules/skills/helpers.ts) and [`server/src/modules/skills/service.ts`](../server/src/modules/skills/service.ts) (edit the import path);
  - [`server/test/skills-injection-scan.test.ts`](../server/test/skills-injection-scan.test.ts) (edit the import path);
  - [`server/eslint.config.mjs:118`](../server/eslint.config.mjs:118) (edit the `RING_2` path to `src/modules/_shared/injection-scan.ts`, and add `'src/modules/ci/types.ts'`);
  - [`server/AGENTS.md:71`](../server/AGENTS.md:71) (edit the path);
  - [`.claude/skills/onion-architecture/layers.md`](../.claude/skills/onion-architecture/layers.md) (edit: list `_shared/injection-scan.ts` and `ci/types.ts` as ring 2).
- **Track:** A
- **Layer:** ring 2
- **Skills:** `onion-architecture`
- **Done when:** skills behaviour is unchanged, `rg "skills/injection-scan" server/src server/test` is empty, and the skills scan test passes.
- **Verify:** `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs server --file server/test/skills-injection-scan.test.ts`

### 3. Pure generators and the run verifier (`constants.ts`, `helpers.ts`)
- **Files:** `server/src/modules/ci/constants.ts` (new) · `server/src/modules/ci/helpers.ts` (new) · `server/test/ci-helpers.test.ts` (new)
- **Track:** A
- **Layer:** ring 2. These files are pure: no fs, no zod import, no container.
- **Skills:** `onion-architecture`
- **Do (constants):**
  - `CI_BRANCH = 'devdigest/ci'`, `PR_TITLE = 'Add DevDigest CI review'` and a static `PR_BODY` template with the three next steps;
  - `WORKFLOW_FILE = 'devdigest-review.yml'` and `WORKFLOW_PATH = '.github/workflows/devdigest-review.yml'`;
  - `ARTIFACT_NAME = 'devdigest-result'`, `RESULT_FILE = 'devdigest-result.json'`;
  - `RUNNER_DIR = '.devdigest/runner'`;
  - `GITATTRIBUTES_PATH = '.gitattributes'` and `GITATTRIBUTES_BODY = '.devdigest/runner/** linguist-generated=true\n'`, verbatim;
  - `REFRESH_RUNS_PER_REPO = 20`, `RUNS_LIST_LIMIT = 200`, `PR_TITLE_MAX = 200`;
  - `PINNED_ACTIONS`, verified with `git ls-remote` on 2026-10-11 (lightweight tags pointing at the commit):
    - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
    - `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`
    - `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2`

    Re-resolve them if a release moves, but never use a tag in `uses:`.
- **Do (helpers):**
  - `slugify(name)`: lowercase, runs of `[^a-z0-9]` become `-`, trimmed, at most 60 chars, `'agent'` when empty. `uniqueSlugs(names)` adds `-2`, `-3`, … on a collision.
  - `buildManifestYaml(agent, skillSlugs)` returns `yaml.stringify({ name, provider, model, system_prompt, skills, strategy, ci_fail_on })` (AC-5).
  - `buildWorkflowYaml({ triggers, postAs })` renders the fixed template below. Only the closed-set `types` list and the `DEVDIGEST_POST_AS` literal vary, and **no agent or user text is ever interpolated**:
    ```yaml
    # Generated by DevDigest — Export to CI. "Update CI config" regenerates this file.
    name: DevDigest Review
    on:
      pull_request:
        types: [opened, synchronize]
    permissions:
      contents: read
      pull-requests: write
    jobs:
      review:
        name: DevDigest Review
        if: github.event.pull_request.head.repo.full_name == github.repository
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
            with:
              persist-credentials: false
          - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
            with:
              node-version: 22
          - name: Run DevDigest review
            run: node .devdigest/runner/index.js
            env:
              OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
              GITHUB_TOKEN: ${{ github.token }}
              PR_NUMBER: ${{ github.event.pull_request.number }}
              DEVDIGEST_POST_AS: github_review
          - name: Upload result
            if: always()
            uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
            with:
              name: devdigest-result
              path: devdigest-result.json
              if-no-files-found: ignore
    ```
    Triggers are rendered in the fixed order opened → synchronize → reopened, de-duplicated.
  - `buildMemoryJsonl(rows)` emits one `JSON.stringify({ kind, content })` per line, and `''` when there are no rows.
  - `assembleFiles({ manifestPath, manifestYaml, skills: { slug, body }[], memoryJsonl, runner: { name, contents }[], includeGitattributes: boolean, workflowYaml })` returns `CiFile[]` in this order:
    1. the manifest;
    2. the skills;
    3. `.devdigest/memory.jsonl`;
    4. `.devdigest/runner/<each file>`;
    5. `.gitattributes` with `GITATTRIBUTES_BODY`, `editable: false`, **only when `includeGitattributes` is true**;
    6. the workflow.

    Only the workflow has `editable: true`.
  - `validateWorkflowYaml(text)` returns `{ ok: true } | { ok: false, error }`. It fails when `Buffer.byteLength(text,'utf8') > CI_MAX_BYTES` and when `yaml.parse` throws, carrying the parser's message.
  - `verifyRun(inst: { githubRepoId: number }, run: WorkflowRunMeta, dl: ArtifactDownload)` returns `{ kind: 'accepted', artifact } | { kind: 'rejected' } | { kind: 'no_result' }`. The checks run in this order:
    1. `run.repository_id !== inst.githubRepoId` → rejected;
    2. `run.path.split('@')[0] !== WORKFLOW_PATH` (exact, case-sensitive) → rejected;
    3. `!run.head_sha` → rejected;
    4. `dl.kind` is `missing` or `expired` → no_result;
    5. `too_large` → rejected;
    6. `JSON.parse` throws or `CiResultArtifact.safeParse` fails → rejected;
    7. `artifact.pr_number` is null or not in `run.pull_requests` → rejected;
    8. otherwise accepted.
  - `countBlockers(counts, ciFailOn)`: `critical` → c; `warning` → c+w; `any` → c+w+s; `never` → 0.
  - `runStatus(artifact)`: `findings_count > 0` → `'succeeded'`, otherwise `'no_findings'`. A rejected or no_result run gets `'failed'`.
  - `buildCiTrace({ agentName, agentVersion, model, provider, prNumber, artifact|null, headSha, skills, runnerSha256, jobUrl })` returns a `RunTrace`:
    - `config: { agent, version: String(agentVersion), provider, model, pr, source: 'ci' }`;
    - `stats: { duration_ms, tokens_in: 0, tokens_out: 0, cost_usd, findings, grounding: '' }`;
    - `prompt_assembly: { system: '', user: '' }` and empty arrays;
    - `log` lines `info`: `commit <sha>`, `manifest version <v>`, `model <m>`, `skills <a, b>`, `runner sha256 <hex>`, `job <url>`.
  - `buildZipBase64(files)` uses fflate `zipSync` keyed by repo path and returns `Buffer.from(...).toString('base64')`.
- **Done when:** `ci-helpers.test.ts` covers the following.
  - **AC-5:** parsing `buildManifestYaml` output with `yaml.parse` and then `AgentManifest.parse` yields the agent's model, prompt, skills, strategy and `ci_fail_on`. A multi-line prompt with `: ` and `#` round-trips exactly.
  - **AC-6:** the workflow parsed by `yaml.parse` has:
    - `on` keys exactly `['pull_request']`, with `types` equal to the selection;
    - top-level `permissions` deep-equal to `{ contents: 'read', 'pull-requests': 'write' }`;
    - every `uses` matching `/@[0-9a-f]{40}$/`;
    - a run step of `node .devdigest/runner/index.js` with env `OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}'`, `GITHUB_TOKEN: '${{ github.token }}'` and `DEVDIGEST_POST_AS` equal to each of the 3 modes;
    - the job `if` equal to the fork-guard string above;
    - an upload step with `if: always()`, `name: devdigest-result`, `path: devdigest-result.json`.

    The raw text must not contain `pull_request_target`.
  - **verifyRun boundaries:**
    - repo id ±1 → rejected;
    - path `.github/workflows/devdigest-review.yml@refs/pull/7/merge` → passes the path check;
    - `.github/workflows/devdigest-review.yml.bak` (near-miss) → rejected;
    - `.github/workflows/Devdigest-review.yml` (case variant) → rejected;
    - `head_sha: null` → rejected;
    - `missing` and `expired` → no_result;
    - `too_large` → rejected;
    - non-JSON or a schema miss → rejected;
    - `pr_number: null` → rejected;
    - `pr_number: 8` with `pull_requests: [7]` → rejected;
    - `pr_number: 7` with `[7]` → accepted.
  - **validateWorkflowYaml:** exactly 65 536 bytes → ok, 65 537 → error, and `"a: [b"` → error with a message.
  - **slugify:** `"Security Reviewer!"` → `"security-reviewer"`, `""` → `"agent"`, `uniqueSlugs(['A','a'])` → `['a','a-2']`.
  - **assembleFiles:**
    - only the workflow is editable;
    - with `includeGitattributes: true`, the list contains exactly one `.gitattributes` (root path, not `.devdigest/.gitattributes`) whose contents equal `'.devdigest/runner/** linguist-generated=true\n'`;
    - with `false`, no path ends in `.gitattributes`.
- **Verify:** `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs server --file server/test/ci-helpers.test.ts`

### 4. Ports, ring-3 readers and the service
- **Files:** `server/src/modules/ci/types.ts` (new) · `server/src/modules/ci/repository.ts` (new) · `server/src/modules/ci/repository-bundle.ts` (new) · `server/src/modules/ci/service.ts` (new) · [`server/src/platform/container.ts`](../server/src/platform/container.ts) (edit) · `server/test/ci-service.test.ts` (new)
- **Track:** A
- **Layer:** `types.ts`/`service.ts` ring 2; `repository*.ts` ring 3 (type-only import from `./types.js`); container ring 4.
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`
- **Do (types.ts):**
  - `CiExportMeta = { model, provider, skills: string[], ci_fail_on, triggers, post_as, manifest_path, runner_sha256 }`.
  - `RunnerBundle = { files: { name: string; contents: string }[]; sha256: string }`, with the port `RunnerBundleSource { read(): Promise<RunnerBundle | null> }`.
  - The `CiStore` port, with the methods listed under *Do (repository.ts)*, and its row DTOs.
- **Do (repository-bundle.ts):** `class RunnerBundleReader implements RunnerBundleSource`.
  - The constructor takes `dir = fileURLToPath(new URL('../../../../agent-runner/dist/', import.meta.url))`.
  - `read()` returns `null` when the directory, `index.js` or `package.json` is missing or unreadable. Otherwise it returns every regular file in the directory (non-recursive), sorted by name, and `sha256` = hex sha256 of `index.js` (`node:crypto`).
- **Do (container.ts):** add `runnerBundle?: RunnerBundleSource` to `ContainerOverrides` and `get runnerBundle(): RunnerBundleSource`, which returns the override or a cached `new RunnerBundleReader()`.
- **Do (repository.ts):** `class CiRepository implements CiStore`, over `Db`.
  - **Its own reads, with no import from other modules:**
    - `getAgent(ws, id)`, which also returns `version` and `ciFailOn`;
    - `enabledSkills(agentId)` → `{ name, source, body }[]`, with the same predicate as [skills/repository.ts:232-253](../server/src/modules/skills/repository.ts:232);
    - `findRepo(ws, fullName)` → `{ id, fullName, defaultBranch }`, an **exact** `full_name` match;
    - `getRepoById(ws, id)`;
    - `repoMemory(ws, repoId)` → `{ kind, content }[]` where `scope='repo'`, ordered by `created_at`;
    - `installationForRepo(ws, fullName)` → installation + `agentName`, joined through `agents.workspace_id`;
    - `listInstallations(ws, agentId?)`.
  - **Writes:**
    - `upsertInstallation({ agentId, repo, agentVersion, exportMeta, githubRepoId? })` updates the `(agent_id, repo)` row if one exists, otherwise inserts. It never creates a second row (EC-3).
    - `setGithubRepoId(id, n)`.
  - **Ingest:**
    - `knownRunIds(installationId)` → `Set<number>`.
    - `recordRun(input)` runs one transaction:
      1. insert `ci_runs` with `.onConflictDoNothing({ target: githubRunId })` and `.returning({ id })`; return `false` when nothing comes back (EC-8);
      2. insert `agent_runs` with `source: 'ci'`, **`prId: null`** (Q4), `workspaceId`, `agentId`, `provider`, `model`, `durationMs`, `costUsd` (null stays null), `status: 'done'|'failed'`, `findingsCount`, `blockers` and `error` (`'result_rejected'`, `'no_result'` or null);
      3. insert `run_traces`;
      4. update `ci_runs.agent_run_id`.
  - **List:** `listRuns(ws, { agentId?, repo? })` starts from `ci_runs`, inner-joins `ci_installations`, left-joins `agents` (scoped by `agents.workspace_id`) and `agent_runs`. It orders by `ran_at desc` and limits to `RUNS_LIST_LIMIT`.
- **Do (service.ts):** `CiService` with deps `{ store: CiStore; bundle: RunnerBundleSource; github: () => Promise<GitHubClient> }`. The GitHub client is resolved lazily, so a zip install and the preview work with no token.
  - **Private `shouldWriteGitattributes(repo)` → `boolean` (R41).** It returns `!(await gh.pathExists(repoRef, GITATTRIBUTES_PATH, repo.defaultBranch))`. **Any error** (no token / `ConfigError`, network, rate limit) returns `false`: when existence is unknown, the file is omitted, so an existing `.gitattributes` is never overwritten. Ours is never merged into theirs.
  - **`preview(ws, agentId, { repo, triggers, postAs })` → `CiPreview`.**
    - 404 when the agent or the repo is unknown in this workspace.
    - For each skill: when `SCANNED_SOURCES.has(source) && securityReport(body).status === 'flagged'`, push its name to `skipped_skills` and leave it out (EC-5).
    - The manifest path is `export_meta.manifest_path` of an existing installation for this agent and repo, else `.devdigest/agents/<slugify(agent.name)>.yaml`.
    - `includeGitattributes = await shouldWriteGitattributes(repo)`. `.gitattributes` therefore appears in the preview list only when it will be written.
    - Read the bundle. When it is null, set `bundle_missing: true` and omit the runner files (EC-10).
  - **`export(ws, agentId, input)` → `CiExport`.**
    1. Return 404 for an unknown agent or repo.
    2. EC-2: when `installationForRepo` returns another agent, throw `AppError('ci_repo_taken', '<agentName> is already installed in <repo>', 409, { agent_name })`.
    3. Build the files exactly as in `preview`, with the same `.gitattributes` decision recomputed at install time. A missing bundle → `AppError('ci_bundle_missing', 'Runner bundle not built — run pnpm build in agent-runner', 422)`.
    4. When `workflow_yaml` is present, run `validateWorkflowYaml`. On failure → `AppError('ci_workflow_invalid', error, 422)`. On success it replaces the generated workflow text.
    5. `action: 'open_pr'`:
       - `gh.commitFiles({ branch: CI_BRANCH, base: repo.defaultBranch, message: PR_TITLE, files })`, then `gh.findOpenPr(repo, CI_BRANCH) ?? gh.openPullRequest({ title: PR_TITLE, head: CI_BRANCH, base, body })`, then `gh.getRepoId`.
       - Any throw from these calls, `ConfigError` included → `AppError('ci_github_failed', err.message, 502)`, and **no installation is written** (EC-1).
       - Only after success, `upsertInstallation` with `agentVersion: agent.version`, `githubRepoId` and `exportMeta` (model, provider, skill slugs, `ci_fail_on`, triggers, post_as, manifest path, `runner_sha256`).
    6. `action: 'files'`: no GitHub **write** (the read-only `pathExists` check is allowed and degrades to "omit"). `upsertInstallation` without a repo id, and `zip_base64 = buildZipBase64(files)`.
    7. Return `{ installation, files, pr_url, zip_base64 }`.
  - **`updateAll(ws, agentId)` → `CiUpdateResult` (AC-10).** For each installation of the agent:
    - regenerate with the current agent and its stored `triggers`/`post_as`, with the `.gitattributes` decision made the same way;
    - commit, then reuse or open the PR;
    - on success, `upsertInstallation` with the new `agent.version` and meta;
    - on failure, record `error: err.message` for that repo and keep its version.

    A missing bundle → 422 `ci_bundle_missing` before any commit.
  - **`agentCi(ws, agentId)`** returns installations plus `listRuns({ agentId })`. **`listRuns(ws, filters)`** resolves `repo_id` to `full_name` (404 when unknown).
  - **`refresh(ws, { agentId? })` → `{ ingested }`.** For each installation:
    1. When `githubRepoId` is null, pin it with `gh.getRepoId` and `setGithubRepoId`. This applies to zip installs.
    2. `gh.listWorkflowRuns(repo, WORKFLOW_FILE, REFRESH_RUNS_PER_REPO)`.
    3. Skip runs with `conclusion === 'skipped'` and runs whose id is in `knownRunIds`.
    4. For each remaining run, `downloadRunArtifact(repo, id, { name: ARTIFACT_NAME, fileName: RESULT_FILE, maxBytes: CI_MAX_BYTES })`, then `verifyRun`.
    5. Accepted → counts, cost, duration and findings come from the artifact, `blockers = countBlockers(…, meta.ci_fail_on)`. Otherwise status is `failed`, counts, cost and findings are null, and the reason is `result_rejected` or `no_result` (EC-6, EC-7).
    6. `pr_number`: the artifact's when accepted, else `run.pull_requests[0] ?? null`.
    7. `pr_title = run.display_title.slice(0, PR_TITLE_MAX)`, `ran_at = run.updated_at`, `github_url = run.html_url`.
    8. The trace is built from the installation meta (manifest version = `agent_version`, model, runner sha256, skills) plus `head_sha`.
    9. `recordRun`.

    The first GitHub error throws `AppError('ci_github_failed', err.message, 502)`; rows already recorded stay (EC-9).
- **Done when:** `ci-service.test.ts` passes. It is hermetic, built with an in-memory `CiStore` fake, a fake `RunnerBundleSource` and `MockGitHubClient`, and asserts the following.
  - **EC-5:** a flagged `imported_url` skill is absent from the files and named in `skipped_skills`, while a `manual` skill with the same text is kept.
  - **EC-10:** a null bundle gives `bundle_missing: true` and makes export throw 422 `ci_bundle_missing`.
  - **EC-2:** export to a repo held by another agent throws 409 with `details.agent_name`.
  - **EC-1:** `commitError` gives 502 carrying the same message, and the fake store has 0 installations.
  - **EC-4 server side:** `workflow_yaml: "a: [b"` gives 422 `ci_workflow_invalid`.
  - **R41:**
    - `existingPaths: []` puts `.gitattributes` in the preview and the commit;
    - `existingPaths: ['.gitattributes']` puts it in neither, and the existing file is never in `committed`;
    - a `github` factory that throws `ConfigError` puts no `.gitattributes` in the preview or the zip, and the zip export still succeeds.
  - **Files action:** 0 `commitFiles`/`openPullRequest` calls, and the zip's entries are exactly the preview paths.
  - **Refresh:** a `skipped` run is not recorded; a known run id is not downloaded again; `runsError` gives 502.
- **Verify:** `node scripts/verify.mjs server --checks` · `node scripts/verify.mjs server --file server/test/ci-service.test.ts`

### 5. Routes, registration, docs and the integration test
- **Files:** `server/src/modules/ci/routes.ts` (new) · [`server/src/modules/index.ts`](../server/src/modules/index.ts) (edit: one import + `ci` entry) · `server/src/modules/ci/README.md` (new) · [`server/README.md`](../server/README.md) (edit: API map rows) · [`server/AGENTS.md`](../server/AGENTS.md) (edit: one "Read when" line for `modules/ci/README.md`) · `server/test/ci.it.test.ts` (new)
- **Track:** A
- **Layer:** ring 4
- **Skills:** `onion-architecture`, `fastify-best-practices`
- **Do:** register the routes below in `evals/routes.ts` style. `getContext`, `IdParams`, and the service is built with `new CiService({ store: new CiRepository(container.db), bundle: container.runnerBundle, github: () => container.github() })`.
  | Method · path | Schema | Response |
  |---|---|---|
  | `GET /agents/:id/ci` | `IdParams` | `AgentCi` |
  | `GET /agents/:id/export-ci/preview?repo=&post_as=&triggers=opened,synchronize` | local strict querystring: `repo` like the contract, `post_as: CiPostAs`, `triggers` comma string → `z.array(CiTrigger).min(1)` | `CiPreview` |
  | `POST /agents/:id/export-ci` | body `CiExportInput` | `CiExport` (200) · 404 · 409 `ci_repo_taken` · 422 `ci_bundle_missing`/`ci_workflow_invalid`/validation · 502 `ci_github_failed` |
  | `POST /agents/:id/ci/update` | body `z.object({}).strict()` | `CiUpdateResult` · 422 `ci_bundle_missing` |
  | `GET /ci/runs?agent_id=&repo_id=` | strict querystring, both `z.string().uuid().optional()` | `z.array(CiRun)` |
  | `POST /ci/runs/refresh` | body `CiRefreshInput` | `CiRefreshResult` · 502 `ci_github_failed` |

  The module README covers:
  - the routes and error codes;
  - the exported file set, including the `.gitattributes` rule (written only when absent on the default branch, never merged, omitted when GitHub cannot be read);
  - the setup step `cd agent-runner && pnpm install && pnpm build` (reviewer-core deps also needed: `cd reviewer-core && npm install`);
  - the verification order;
  - the "pr_id stays null" rule and why;
  - the pins and how to re-resolve them.
- **Done when:** `ci.it.test.ts` passes against real Postgres. It uses `buildApp` with overrides `github: new MockGitHubClient({...})`, a fixture `runnerBundle` (two files, known sha), a mock `secrets` provider with the sentinels `OPENROUTER_API_KEY=sk-or-SENTINEL` and `GITHUB_TOKEN=ghp_SENTINEL`, and a call-counting LLM mock. It asserts:
  - **AC-8:**
    - `committed[0]` has `branch: 'devdigest/ci'`, `base` equal to the repo row's `default_branch`, and paths for the manifest, each skill, `.devdigest/memory.jsonl`, each `.devdigest/runner/*`, `.gitattributes` (contents `.devdigest/runner/** linguist-generated=true\n`) and `.github/workflows/devdigest-review.yml`;
    - the edited workflow text, when sent, is the committed one;
    - `openedPrs[0].title === 'Add DevDigest CI review'`;
    - the `ci_installations` row has `agent_version`, `github_repo_id === 4242`, and `export_meta.model` and `runner_sha256` equal to the fixture sha.
  - **R41:** a second app with `existingPaths: ['.gitattributes']` commits no `.gitattributes` path.
  - **EC-3:** a second identical install leaves 1 `openedPrs` entry and 1 installation row.
  - **EC-2:** a second agent gets 409.
  - **EC-1:** `commitError` gives 502 and 0 rows.
  - **AC-9:** `action: 'files'` returns a `zip_base64` whose unzipped entry paths equal the preview's paths (`.gitattributes` included exactly when the preview listed it), makes 0 `committed`, and writes 1 installation row.
  - **AC-10:** after `PUT /agents/:id` changes the model, `POST /agents/:id/ci/update` commits again and the row's `agent_version` and `export_meta.model` are updated.
  - **AC-11/AC-12:**
    - Fixture runs:
      - run 1 is valid, with artifact `{ findings_count: 3, critical: 1, warning: 2, suggestion: 0, cost_usd: 0.01, duration_ms: 4200, agent, pr_number: 7 }`;
      - run 2 has the wrong repo id;
      - run 3 has no artifact;
      - run 4 is `skipped`.
    - After `POST /ci/runs/refresh`, run 1 has a `ci_runs` row with `head_sha`, `pr_number 7`, the PR title, the counts and `github_url`, plus an `agent_runs` row with `source='ci'`, `pr_id IS NULL`, the model, `duration_ms 4200`, `findings_count 3`, and `blockers 1`.
    - The `run_traces` log contains `commit <sha>`, `manifest version <n>`, `runner sha256 <fixture>` and the skill slug.
    - Run 2 is `failed` with `'result_rejected'` and null counts and cost (EC-6). Run 3 is `failed` with `'no_result'` and the job link (EC-7). Run 4 is absent.
  - **EC-8:** a second refresh leaves the row count unchanged.
  - **GET filters:** `GET /ci/runs?agent_id=` returns newest first. `?repo_id=not-a-uuid` → 422.
  - **NFR-1:** no response body, decoded zip entry, `ci_*` or `agent_runs` row, or trace JSON contains `sk-or-SENTINEL` or `ghp_SENTINEL`.
  - **NFR-2:** the LLM mock call count is 0 after export, update and refresh.
- **Verify:** `node scripts/verify.mjs server --checks` · `docker info` then `node scripts/verify.mjs server --file server/test/ci.it.test.ts` (confirm the file actually ran and was not skipped).

### 6. Client dependency, copy and data hooks
- **Files:** [`client/package.json`](../client/package.json) and `client/pnpm-lock.yaml` (edit, via `cd client && pnpm add yaml@^2.6.1`) · [`client/messages/en/ci.json`](../client/messages/en/ci.json) (rewrite) · [`client/messages/en/agents.json`](../client/messages/en/agents.json) (edit: `editor.tabs.ci` = `"CI"`) · `client/src/lib/hooks/ci.ts` (new)
- **Track:** B
- **Skills:** `frontend-ui-architecture`, `react-best-practices`
- **Do (hooks, each with an exported key builder):**
  - `useAgentCi(agentId)` → `GET /agents/:id/ci`;
  - `useCiPreview(agentId, { repo, triggers, postAs }, enabled)` → GET preview (key includes all three);
  - `useExportCi(agentId)` → POST export-ci, invalidating agent-ci;
  - `useUpdateCiConfig(agentId)` → POST `/agents/:id/ci/update` with `{}`;
  - `useCiRuns({ agentId?, repoId? })` → `GET /ci/runs`;
  - `useRefreshCiRuns()` → POST `/ci/runs/refresh` with `{ agent_id? }` or `{}`, invalidating `ci-runs` and `agent-ci` on success.

  Types come from `@devdigest/shared` with `import type`. The only value import is `CI_MAX_BYTES` ([client/INSIGHTS.md:295-301](../client/INSIGHTS.md:295)).
- **Do (copy):** rewrite `ci.json` so it holds only keys the new UI uses, and remove the dead `publishDialog`, circle/jenkins/cli and "GitHub App" keys. **Use these strings verbatim.**
  | Key (suggested) | Text |
  |---|---|
  | `ciTab.heading` | `CI deployment` |
  | `ciTab.activeIn` | `Active in {count, plural, one {# repo} other {# repos}}` |
  | `ciTab.updateConfig` | `Update CI config` |
  | `ciTab.addToCi` | `Add to CI` |
  | `ciTab.addRepository` | `Add repository` |
  | `ciTab.target.gha` | `GitHub Actions` |
  | `ciTab.workflowVersion` | `Workflow v{version}` |
  | `ciTab.noRuns` | `No runs yet` |
  | `ciTab.updateNote` | `Update CI config regenerates the workflow from this agent's current settings and replaces manual edits.` |
  | `ciTab.updateDone` | `CI config updated in {count, plural, one {# repo} other {# repos}}` |
  | `ciTab.updateFailed` | `{repo}: {message}` |
  | `ciTab.failOn.label` | `Fail CI on` |
  | `ciTab.failOn.critical` | `Critical` |
  | `ciTab.failOn.warning` | `Warning +` |
  | `ciTab.failOn.never` | `Never` |
  | `ciTab.failOn.note` | `Takes effect in a repository after “Update CI config”.` |
  | `ciTab.runsTitle` | `CI runs` |
  | `ciTab.emptyTitle` | `Not in CI yet` |
  | `ciTab.emptyBody` | `Deploy this agent to run automatically on every pull request in a repo's CI pipeline.` |
  | `wizard.title` | `Export to CI` |
  | `wizard.steps.target` / `.preview` / `.configure` / `.install` | `Target` / `Preview` / `Configure` / `Install` |
  | `wizard.back` / `wizard.continue` / `wizard.install` / `wizard.installing` | `Back` / `Continue` / `Install` / `Installing…` |
  | `wizard.target.gha` / `wizard.target.ghaDesc` | `GitHub Actions` / `Runs on pull_request events` |
  | `wizard.target.repoLabel` | `Target repository` |
  | `wizard.target.noRepos` | `Import a repository first — the workflow is added to one of this workspace's imported repositories.` |
  | `wizard.preview.filesToCreate` | `FILES TO CREATE` |
  | `wizard.preview.editable` | `editable` |
  | `wizard.preview.loading` | `Generating…` |
  | `wizard.preview.skipped` | `Skipped {name}: flagged by the skill security scan.` |
  | `wizard.preview.bundleMissing` | `The CI runner bundle is not built. Run pnpm build in agent-runner, then reopen this step.` |
  | `wizard.preview.yamlError` | `The workflow is not valid YAML: {error}` |
  | `wizard.configure.triggers` | `Trigger on` |
  | `wizard.configure.opened` / `.synchronize` / `.reopened` | `opened` / `synchronize` / `reopened` |
  | `wizard.configure.triggerRequired` | `Select at least one trigger.` |
  | `wizard.configure.postAs` | `Post results as` |
  | `wizard.configure.githubReview` / `.prComment` / `.none` | `GitHub review` / `PR comment` / `None (exit code only)` |
  | `wizard.configure.secretNote` | `Add OPENROUTER_API_KEY to the repository's Actions secrets (Settings → Secrets and variables → Actions).` |
  | `wizard.configure.tokenNote` | `GITHUB_TOKEN is provided automatically by GitHub Actions.` |
  | `wizard.configure.blockNote` | `To block a merge, set “Fail CI on” and make the “DevDigest Review” check required in branch protection.` |
  | `wizard.configure.editedNote` | `You edited the workflow, so it is used as-is: these choices are not applied to it.` |
  | `wizard.install.openPr` / `wizard.install.openPrDesc` | `Open a PR` / `Commits the files to the devdigest/ci branch of {repo} and opens “Add DevDigest CI review”.` |
  | `wizard.install.zip` / `wizard.install.zipDesc` | `Download zip` / `Downloads the files at their repository paths. Nothing is written to GitHub.` |
  | `wizard.install.prDone` | `Pull request ready` |
  | `wizard.install.viewPr` | `View pull request` |
  | `wizard.install.zipDone` | `Zip downloaded — commit these files to {repo}, then follow the same steps.` |
  | `wizard.install.nextSteps` | `Next steps` |
  | `wizard.install.step1` | `Add OPENROUTER_API_KEY to the repository's Actions secrets.` |
  | `wizard.install.step2` | `Review and merge the pull request.` |
  | `wizard.install.step3` | `Make the “DevDigest Review” check required to block merges.` |
  | `wizard.install.githubError` | `GitHub refused the change: {message}` |
  | `wizard.install.zipInstead` | `Download zip instead` |
  | `wizard.install.close` | `Close` |
  | `runs.title` | `CI Runs` |
  | `runs.subtitle` | `Agent reviews executed inside CI · not local runs` |
  | `runs.refresh` / `runs.refreshing` | `Refresh` / `Refreshing…` |
  | `runs.filters.allAgents` / `runs.filters.allRepos` | `All agents` / `All repos` |
  | `runs.table.timestamp` / `.repository` / `.pullRequest` / `.agent` / `.status` / `.findings` / `.cost` / `.duration` / `.job` | `Timestamp` / `Repository` / `Pull request` / `Agent` / `Status` / `Findings` / `Cost` / `Duration` / `Job` |
  | `runs.status.succeeded` / `.noFindings` / `.failed` | `Succeeded` / `No findings` / `Failed` |
  | `runs.reason.resultRejected` / `runs.reason.noResult` | `result rejected` / `no result produced` |
  | `runs.viewJob` | `View job` |
  | `runs.emptyTitle` / `runs.emptyCta` | `No CI runs yet` / `Set up CI for an agent` |
  | `runs.emptyBody` | `Once you export an agent to CI, every automated review shows up here.` |
  | `runs.refreshError` | `Could not read CI runs from GitHub — showing stored runs.` |
  | `page.crumb` | `CI Runs` |
- **Done when:** the hooks typecheck against the step-0 contracts, `ci.json` parses as JSON, and no `publishDialog` key remains.
- **Verify:** `node scripts/verify.mjs client --checks`

### 7. Shared runs table and the CI tab (with Fail CI on)
- **Files:** `client/src/components/ci-runs-table/{CiRunsTable.tsx,CiRunsTable.test.tsx,index.ts}` (new) · [`client/src/app/agents/[id]/_components/AgentEditor/constants.ts`](../client/src/app/agents/[id]/_components/AgentEditor/constants.ts) (edit: add `{ key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" }`) · [`AgentEditor.tsx`](../client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx) (edit: render `CiTab` for `tab === "ci"` and exclude it from the Config fallback) · `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/{CiTab.tsx,CiTab.test.tsx,index.ts,styles.ts}` (new)
- **Track:** B
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`
- **Do:**
  - **`CiRunsTable({ runs, showAgent })`.** It is used by two routes, so it lives in `src/components/`. Columns, newest first as received:
    - timestamp (relative);
    - repository;
    - `#<pr_number> <pr_title>` (plain text, CSS-truncated);
    - agent, only when `showAgent`;
    - status as **text + icon**, plus the failure reason text when present;
    - findings per severity as labelled text (`1 critical · 2 warning · 0 suggestion`);
    - cost (null → `—`);
    - duration;
    - a `View job` link to `github_url` with `target="_blank" rel="noopener noreferrer"`.
  - **`CiTab({ agent })`.** `useAgentCi`, plus one `useRefreshCiRuns().mutate({ agent_id })` on mount (ref-guarded effect).
    - **With installations:** the heading, the badge, `Update CI config` (→ `useUpdateCiConfig`, then show `updateDone` and any per-repo `updateFailed` lines) and `Add to CI`.
    - One row per installation: repo, `GitHub Actions`, the latest run status and relative time for that repo taken from `runs` (or `No runs yet`), and `Workflow v{agent_version}`.
    - A dashed `Add repository` button, the update note, the `Fail CI on` radio group, and `CiRunsTable showAgent={false}`.
    - **Fail CI on:** a `role="radiogroup"` of 3 buttons with `aria-checked`, calling `useUpdateAgent().mutate({ id, patch: { ci_fail_on } })` (PUT, [agents.ts:61-69](../client/src/lib/hooks/agents.ts:61)). Show the note. An agent on `any` has none checked.
    - **No installation:** `Not in CI yet`, the body text, and the `Add to CI` CTA.
- **Done when:**
  - `CiTab.test.tsx` (hooks mocked) asserts:
    - **AC-1:** with 2 installations, `CI deployment`, `Active in 2 repos`, both buttons, 2 rows with `GitHub Actions`, the latest-run status text and `Workflow v3`, and `Add repository`;
    - **AC-2:** exactly 3 radios `Critical`, `Warning +`, `Never`, with the checked state equal to `agent.ci_fail_on`; clicking `Never` calls the update mutation with `{ ci_fail_on: 'never' }`; the note is present;
    - **AC-14:** no Agent column header;
    - **AC-15 (tab):** with 0 installations, `Not in CI yet` + `Add to CI`.
  - `CiRunsTable.test.tsx` asserts:
    - **AC-13 columns:** all 9 headers with `showAgent`;
    - cost `null` → `—`;
    - `failed` + `result_rejected` → the text `Failed` and `result rejected` (**NFR-4**);
    - the job link `href` and `rel`.
- **Verify:** `node scripts/verify.mjs client --checks` · `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx"` · `node scripts/verify.mjs client --file client/src/components/ci-runs-table/CiRunsTable.test.tsx`

### 8. The Export to CI wizard
- **Files:** `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportCiModal/{ExportCiModal.tsx,ExportCiModal.test.tsx,index.ts,helpers.ts,styles.ts}` (new). Optional per-step sub-components live under its own `_components/`. `CiTab.tsx` (edit: mount the modal).
- **Track:** B
- **Skills:** as step 7, plus `next-best-practices` (the file is `'use client'`)
- **Do:**
  - **Container:** one `@devdigest/ui` `Modal`, and the only dialog. It holds a step index plus state for `repo`, `triggers` (default opened + synchronize), `postAs` (default `github_review`), `editedWorkflow: string | null` and `installMode`.
    - State lives in the modal component, so Back and Continue never lose it (AC-3).
    - The step header lists the 4 steps as text. Back, Continue and Install are real `<button>`s (NFR-4).
  - **Target:**
    - one selected card, `GitHub Actions`;
    - a `<select>` labelled `Target repository` over `useRepos()` full names;
    - with 0 repos, show `noRepos` and disable Continue (EC-11).
  - **Preview:**
    - `useCiPreview(agentId, { repo, triggers, postAs }, enabled)`;
    - the list shows **exactly the server's `files`**, so `.gitattributes` appears only when the server will write it (R41; no client-side logic);
    - selecting a file shows its full contents in a read-only `<pre>`;
    - the workflow in a `<textarea>` initialised from the edited text or the generated one, setting `editedWorkflow` on change;
    - list `skipped_skills` with `wizard.preview.skipped`;
    - when `bundle_missing` is set, show `bundleMissing` and disable Continue and Install (EC-10);
    - `helpers.ts` `validateWorkflow(text)` uses `yaml`'s `parse` plus a byte length ≤ `CI_MAX_BYTES`; on an error show `yamlError` and disable Continue and Install (EC-4).
  - **Configure:**
    - three trigger checkboxes; with none checked show `triggerRequired` and disable Continue;
    - three post-as radios;
    - the three static notes; `editedNote` when `editedWorkflow !== null`.
  - **Install:**
    - two choices, `Open a PR` and `Download zip`;
    - Install → `useExportCi` with `{ repo, action, post_as, triggers, workflow_yaml?: editedWorkflow ?? undefined }`;
    - PR success: `prDone`, a `View pull request` link to `pr_url`, `Next steps` with the 3 steps (AC-8);
    - zip success: `helpers.ts` `downloadZip(base64, 'devdigest-ci-<repo>.zip')` and `zipDone` (AC-9);
    - an error with code `ci_github_failed` or `config_error`: `githubError` with the server message plus `Download zip instead`, which re-submits with `action: 'files'` (EC-1);
    - `ci_repo_taken`: show the server message, which names the agent (EC-2).
- **Done when:** `ExportCiModal.test.tsx` (hooks mocked, `fireEvent`) asserts:
  - **AC-3:** step labels; only `GitHub Actions` as a target; repo options from `useRepos`; a choice made on Configure survives Back → Continue.
  - **AC-4:** the preview lists all the kinds of paths, and only the workflow is editable.
  - **R41:** a mocked preview **with** `.gitattributes` lists it; one **without** it does not.
  - **EC-4:** typing `a: [b` shows `The workflow is not valid YAML:` and disables Install.
  - **EC-10:** `bundle_missing` shows the `pnpm build` message and disables both paths.
  - **EC-11:** 0 repos shows `noRepos` and disables Continue.
  - **AC-7:** the trigger defaults; unchecking all disables Continue; the 3 post-as labels and the 3 notes are present.
  - **AC-8 UI:** `View pull request` + the 3 steps.
  - **EC-1 UI:** the message + `Download zip instead`.
  - **AC-9 UI:** the zip path calls the mutation with `action: 'files'`.
  - **NFR-4:** every step control is a `button`, `input` or `select`.
- **Verify:** `node scripts/verify.mjs client --checks` · `node scripts/verify.mjs client --file "client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportCiModal/ExportCiModal.test.tsx"`

### 9. `/ci-runs` page and the GLOBAL nav entry
- **Files:** `client/src/app/ci-runs/page.tsx` (new; an `async` server component, copying `repos/[repoId]/context/page.tsx`) · `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,CiRunsView.test.tsx,index.ts}` (new) · [`client/src/vendor/ui/nav.ts`](../client/src/vendor/ui/nav.ts) (edit, app-owned) · [`client/src/components/app-shell/nav.test.ts`](../client/src/components/app-shell/nav.test.ts) (edit) · [`client/README.md`](../client/README.md) (edit: route map + API rows)
- **Track:** B
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **Do:**
  - **Nav:** append `{ section: "GLOBAL", items: [{ key: "ci-runs", label: "CI Runs", icon: "Zap", href: "/ci-runs" }] }` to `NAV`.
  - **`CiRunsView`:**
    - the title and subtitle;
    - agent and repository `<select>`s over `useAgents()` / `useRepos()`, both feeding `useCiRuns`;
    - `Refresh` (shows `Refreshing…`) and one refresh on mount (ref-guarded);
    - `CiRunsTable showAgent`;
    - on refresh error, `ErrorState` with `title={t('runs.refreshError')}` and `onRetry`, while the stored table stays rendered (EC-9);
    - empty and unfiltered: `No CI runs yet`, the body, and a `Set up CI for an agent` link to `/agents` (AC-15).
- **Done when:**
  - `CiRunsView.test.tsx` asserts **AC-13** (columns, the agent filter passes `agentId`, Refresh calls the mutation), **AC-15** (empty state + `href="/agents"`) and **EC-9** (error title + retry **and** stored rows).
  - `nav.test.ts` adds **AC-16:** the `GLOBAL` group contains `{ key: 'ci-runs', label: 'CI Runs', href: '/ci-runs' }` and `activeKeyFor('/ci-runs') === 'ci-runs'`.
- **Verify:** `node scripts/verify.mjs client --checks` · `node scripts/verify.mjs client --file client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` · `node scripts/verify.mjs client --file client/src/components/app-shell/nav.test.ts`

### 10. Integration — the one full run
- **Files:** none planned. A file of Track A or B is edited only to fix a mismatch between a client hook and a server route.
- **Track:** shared
- **Skills:** the owning track's skills, only if a fix is needed.
- **Do:**
  1. Check that every hook path and shape in `client/src/lib/hooks/ci.ts` matches `server/src/modules/ci/routes.ts`.
  2. Check that `git status --short agent-runner` shows only ` M agent-runner/src/index.ts` (no `dist/`), and that `git diff HEAD --stat -- server/src/modules/reviews server/src/modules/pulls reviewer-core` is empty.
  3. Check that the vendored copies are equal with `diff --strip-trailing-cr`.
  4. Run the full verify.
  5. Run `cd evals && pnpm eval:quality onion-architecture`, because `layers.md` changed (static, no model call).
- **Done when:** all of the commands below are green, and `ci.it.test.ts` executed with no skips (`docker info` succeeded first).
- **Verify:** `node scripts/verify.mjs server client` · `docker info && node scripts/verify.mjs server --it`

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `node scripts/verify.mjs server --file server/test/ci-contracts.test.ts` | R7, R34 |
| server | `node scripts/verify.mjs server --file server/test/ci-helpers.test.ts` | AC-5, AC-6, AC-11 boundaries, EC-4 (server), EC-6 decision table, R41 (assembly) |
| server | `node scripts/verify.mjs server --file server/test/ci-service.test.ts` | EC-1, EC-2, EC-4, EC-5, EC-10, AC-9, R41 (exists / absent / unknown), refresh skip and known-run behaviour, EC-9 (502) |
| server | `node scripts/verify.mjs server --file server/test/ci.it.test.ts` (Docker) | AC-8, AC-9, AC-10, AC-11, AC-12, EC-1, EC-2, EC-3, EC-6, EC-7, EC-8, NFR-1, NFR-2, R38, R41 |
| client | `node scripts/verify.mjs client --file …/CiTab/CiTab.test.tsx` | AC-1, AC-2, AC-14, AC-15 (tab) |
| client | `node scripts/verify.mjs client --file client/src/components/ci-runs-table/CiRunsTable.test.tsx` | AC-13 columns, NFR-4, null cost |
| client | `node scripts/verify.mjs client --file …/ExportCiModal/ExportCiModal.test.tsx` | AC-3, AC-4, AC-7, AC-8 UI, AC-9 UI, EC-1 UI, EC-2 UI, EC-4, EC-10, EC-11, NFR-4, R41 (preview list) |
| client | `node scripts/verify.mjs client --file client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` | AC-13 filters + Refresh, AC-15 (page), EC-9 |
| client | `node scripts/verify.mjs client --file client/src/components/app-shell/nav.test.ts` | AC-16 |
| server | `node scripts/verify.mjs server` | lint · typecheck · arch · hermetic suite |
| server | `node scripts/verify.mjs server --it` | + integration lane (Docker) |
| client | `node scripts/verify.mjs client` | lint · typecheck · components; NFR-3 is checked statically by plan-verifier |
| manual | Spec "Acceptance scenario" steps 1–7 on a fork of a demo repo; also confirm the runner files show as collapsed "generated" in the PR diff | End-to-end |

## Risks & rollback
- **The 1.6 MB `index.js` is sent inline in `git.createTree`** ([octokit.ts:285-296](../server/src/adapters/github/octokit.ts:285)). A size rejection surfaces as EC-1 (502 + zip offered). Follow-up: `git.createBlob` for large files.
- **`.gitattributes` omitted when GitHub cannot be read.** The zip without a token, or a transient error in preview, gives no `.gitattributes`. That is cosmetic only: the bundle diff is simply not collapsed. It never overwrites the repo's own file. A repo that already has one keeps its own and gets no linguist hint (accepted per the user's "don't merge").
- **Refresh on every mount costs GitHub calls:** at most 1 list call + 20 downloads per installation on the first pass. The rate limit shows as EC-9. Rollback: lower `REFRESH_RUNS_PER_REPO`.
- **CI `agent_runs` rows count in skills usage stats** ([skills/repository.ts:277-278](../server/src/modules/skills/repository.ts:277)). Accepted. Follow-up: a `source` filter.
- **Edited workflows are overwritten by "Update CI config".** The CI tab states this.
- **A stale local bundle:** its sha256 is recorded per installation and shown in each trace.
- **The migration:** additive only. Rollback is a new generated migration that drops the columns.
- **The injection-scan move** could break skills imports. It shows up in `--checks` and the skills scan test. Rollback: `git mv` back.
- **Client deps absent in the worktree:** step 0 runs `pnpm install --frozen-lockfile` in `client/`. If that fails on Windows junctions, follow [INSIGHTS.md:212-221](../INSIGHTS.md:212).

## Out of scope
- Everything under the spec's "Out of scope (later iterations)".
- Any `agent-runner/` edit beyond the already-made direct-run guard fix. Building, minifying or committing `dist/`.
- Merging DevDigest's line into an existing `.gitattributes`.
- `scripts/dev.sh` changes.
- `modules/reviews/**` (the multi-run service) and `modules/pulls/**` (the PR feed).
- e2e browser flows for this feature (Follow-up).
- Follow-ups:
  - the stale root `.gitignore:3-6` comment;
  - `createBlob` for large files;
  - the `source` filter in skills stats.
- No track edits a file owned by another track.
- Writing or amending the spec. A gap goes back to `spec-creator` or to the person who owns the decision.
- Architectural review and security review. Separate agents own those.
- Opening or pushing a PR. `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking:** the "job link" is the workflow run's `html_url`, which opens the run page listing the job. Default taken.
- **Non-blocking:** "manifest version" = the agent version at export (`ci_installations.agent_version`). Default taken.
- **Non-blocking:** runs whose conclusion is `skipped` (fork PRs whose job never ran) are not listed. Default taken.
