# Spec: Export to CI — deploy a tuned agent to a repository's GitHub Actions and read its CI runs back
Spec ID: SPEC-2026-10-11-export-to-ci
Status: approved
Supersedes: none
Packages: server, client

## Problem and user
An agent owner tunes a reviewer agent in the studio: its model, system prompt, skills and `ci_fail_on`. That agent only runs when someone presses Run Review on an imported PR. To have it review every PR of a repository, the owner today hand-writes a workflow and copies the config over. Nothing that runs in CI ever comes back to the studio.

This feature does three things:
- it serializes the agent into a manifest;
- it delivers a least-privilege workflow that runs the bundled `agent-runner`, either as a PR on a `devdigest/ci` branch or as a zip;
- it pulls each CI run's result back over a verified channel.

The user asked for the simplest implementation that meets the requirements, to iterate later. Scope is worktree B (the studio side). `agent-runner/` is a shared package that this feature consumes: any change to it stays minimal and separate. The multi-run service and the PR feed are not changed.

**Request vs tree:** matches in part. Already in the tree:
- `agent-runner/` is built. It reads exactly one `.devdigest/agents/*.yaml` (`agent-runner/src/manifest.ts:40`) and takes env vars only, no argv (`agent-runner/src/index.ts:31`). It writes `devdigest-result.json` with no commit SHA or repository id (`server/src/vendor/shared/contracts/eval-ci.ts:465`).
- The contracts `AgentManifest`, `CiExportInput`, `CiInstallation`, `CiRun` and `CiResultArtifact` exist (`eval-ci.ts:370-476`).
- The tables `ci_installations` and `ci_runs` exist (`server/src/db/schema/ci.ts:4,14`).
- `agent_runs.source` already allows `'ci'` (`server/src/db/schema/runs.ts:38`).
- `ci_fail_on` is already an agent field (`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:24`).

Missing from the tree:
- the `ci` server module;
- the CI tab (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11`);
- the `/ci-runs` page and its nav entry (`client/src/vendor/ui/nav.ts:33`);
- GitHub reads for workflow runs and artifacts (`server/src/vendor/shared/adapters.ts:143`).

## Goals / Non-goals
**Goals**
- "Add to CI" on the agent's CI tab opens a 4-step wizard: Target → Preview → Configure → Install.
- The wizard installs the files as a PR from `devdigest/ci`, or hands them over as a zip. It never writes to the default branch.
- The generated workflow is least-privilege, SHA-pinned, skips forks and contains no secrets.
- CI results reach the studio only by pull with the user's token, verified against the installation.
- Each verified result is stored in `agent_runs` with `source='ci'`, linked to repository, PR and commit SHA, and listed on CI Runs with a job link.
- Each installation records the exported manifest version, the model and the runner bundle identity. A CI run's trace can then show manifest version, model, dependencies and commit SHA.
- Existing tables and contracts are reused. A migration is acceptable only for a required field that has no existing home.
**Non-goals**
- CircleCI, Jenkins and Generic CLI targets.
- A published `devdigest/review-action`; the mock's `uses:` stays a placeholder.
- Any change to `agent-runner/`, with one exception: the direct-run guard fix in `agent-runner/src/index.ts` (`pathToFileURL(process.argv[1]).href` instead of `file://${argv[1]}`), already in the working tree (user-approved 2026-10-11).
- Any change to the multi-run service or the PR feed.
- Per-finding ingest.
- An inbound ingest endpoint.
- Reading or setting GitHub secrets.
- Configuring branch protection.
**Out of scope (later iterations)**
- An "out of date" badge per installation.
- Interval auto-refresh or background polling.
- A time-window filter on CI Runs.
- Policy linting of an edited workflow (permissions, triggers).
- Scanning generated files for secret values.
- Proactive detection of GitHub token scopes.
- Several agents in one repository.
- A fourth "Fail CI on" option (`any`).
- A "Secrets expected" status panel.
- Adding SHA, repo id or model to `devdigest-result.json`.
- Consuming `memory.jsonl` in the runner.

## User stories
- **US-1** As an agent owner, I want to export a tuned agent to a repository's GitHub Actions through a guided wizard, so that it reviews every PR without manual wiring.
- **US-2** As a repository maintainer, I want the export to arrive as a reviewable PR on a separate branch, with minimal permissions and no secrets, so that I can audit it before merging.
- **US-3** As an agent owner, I want to choose the triggers, the publication mode and when CI fails, so that a required check can block a merge.
- **US-4** As an agent owner, I want to see where an agent is installed, which version each repository runs, and its CI history.
- **US-5** As a workspace user, I want CI runs listed with repository, PR, agent, verdict, findings, cost, duration and a job link.
- **US-6** As a maintainer, I want results accepted only when their origin is verified, so that nobody can inject fake runs.

## Acceptance criteria (EARS)
- **AC-1** WHEN an agent has at least one CI installation, the CI tab shall show:
  - "CI deployment" with an "Active in N repos" badge;
  - the "Update CI config" and "Add to CI" actions;
  - one row per installation with the repository, "GitHub Actions", the latest run status and its relative time, and the workflow version (the agent version it was exported at);
  - a dashed "Add repository" action. · traces: US-4 · verify: component
- **AC-2** The CI tab shall show a "Fail CI on" control with exactly Critical, Warning + and Never, bound to the agent's `ci_fail_on`. A change shall save the agent and state that it takes effect in a repository after "Update CI config". · traces: US-3, DR-17, DR-18 · verify: component
- **AC-3** WHEN the user activates "Add to CI" or "Add repository", the system shall open the Export to CI modal with the steps Target, Preview, Configure and Install, keeping every choice across Back and Continue. The Target step shall offer GitHub Actions only and a repository picker listing the workspace's imported repositories. · traces: US-1, DR-14, DR-15 · verify: component
- **AC-4** WHEN the Preview step opens, the system shall list each file to be created with its full contents:
  - `.devdigest/agents/<slug>.yaml`;
  - one `.devdigest/skills/<slug>.md` per enabled skill;
  - `.devdigest/memory.jsonl`;
  - `.devdigest/runner/` holding every file of the locally built runner bundle `agent-runner/dist/` (`index.js`, `300.index.js`, `package.json`), read from disk at export time;
  - `.github/workflows/devdigest-review.yml`, the only editable file. · traces: US-1, US-2, DR-16 · verify: component
- **AC-5** The generated manifest shall parse under the same `AgentManifest` schema the runner uses (`eval-ci.ts:389`). It shall carry the agent's model, system prompt, skill slugs, strategy and `ci_fail_on`. · traces: US-1 · verify: unit
- **AC-6** The generated workflow shall:
  - trigger only on `pull_request` with the selected types;
  - declare `permissions: contents: read, pull-requests: write` and nothing else;
  - pin every external action to a full commit SHA;
  - run `node .devdigest/runner/index.js` with `OPENROUTER_API_KEY` from `secrets` and the built-in `GITHUB_TOKEN`;
  - pass the chosen publication mode to the runner;
  - skip PRs whose head repository is not the base repository;
  - upload `devdigest-result.json` as the `devdigest-result` artifact whenever it exists;
  - contain no `pull_request_target`. · traces: US-2, DR-8, DR-9, DR-10, DR-11 · verify: unit
- **AC-7** The Configure step shall offer the triggers `opened` and `synchronize` (on by default) and `reopened` (off by default), and require at least one. It shall offer three publication modes: GitHub review (default), PR comment, and None (exit code only). It shall state, as static text:
  - that `OPENROUTER_API_KEY` goes into the repository's Actions secrets;
  - that `GITHUB_TOKEN` is provided automatically;
  - that blocking a merge needs "Fail CI on" plus a required status check. · traces: US-3, DR-12, DR-20 · verify: component
- **AC-8** WHEN the user installs with "Open a PR", the system shall:
  - commit the previewed files, including the edited workflow, to `devdigest/ci`, branched from the repository's default branch;
  - reuse the open PR from that branch, or open one titled "Add DevDigest CI review";
  - record the installation with the exported manifest (agent) version, the model, and the runner bundle identity (the sha256 of the embedded `index.js`);
  - show the PR link and static next steps: add the secret, merge, make the check required. · traces: US-1, US-2, DR-21 · verify: integration
- **AC-9** WHEN the user installs with "Download zip", the system shall return a zip of exactly the previewed files at their repository paths, write nothing to GitHub, and record the installation. · traces: US-1 · verify: integration
- **AC-10** WHEN the user activates "Update CI config", the system shall regenerate the files from the agent's current version and settings for each installed repository, commit them to `devdigest/ci`, reuse or open the PR, and record the new workflow version. · traces: US-3, US-4 · verify: integration
- **AC-11** WHEN the CI Runs page or the CI tab opens, or the user activates Refresh, the system shall read the completed runs of each installed workflow from GitHub with the user's token. It shall accept a run only when all of the following hold:
  - its repository id equals the installed repository's;
  - its workflow path is the installed one;
  - it has a head SHA;
  - its artifact is at most 64 KiB and parses as `CiResultArtifact`;
  - the artifact's PR number is among the run's own pull requests. · traces: US-6 · verify: integration
- **AC-12** WHEN a run is accepted, the system shall store it once as an `agent_runs` row with `source='ci'`, carrying agent, model, status, cost, duration, findings count and blockers. The row shall be linked to the repository, PR number, commit SHA, per-severity counts and the job URL. Its trace shall record the manifest version, model and runner bundle identity from the installation, the skill slugs, and the commit SHA from the verified run metadata. · traces: US-5, US-6, DR-5, DR-6 · verify: integration
- **AC-13** The CI Runs page shall show a table, newest first, with these columns:
  - timestamp;
  - repository;
  - PR number and title;
  - agent;
  - status (succeeded, no findings, failed);
  - findings per severity;
  - cost;
  - duration;
  - a link that opens the GitHub Actions job.
  It shall offer agent and repository filters and a Refresh button. · traces: US-5, DR-13 · verify: component
- **AC-14** The CI tab shall list the agent's CI runs, newest first, with the same columns as CI Runs except agent. · traces: US-4 · verify: component
- **AC-15** WHILE the workspace has no CI run, CI Runs shall show "No CI runs yet" with "Set up CI for an agent", leading to the agents list. WHILE an agent has no installation, its CI tab shall show "Not in CI yet" with "Add to CI". · traces: US-4, US-5 · verify: component
- **AC-16** The sidebar shall list "CI Runs" under Global and mark it active on `/ci-runs`. · traces: US-5, DR-2 · verify: component

## Edge cases
- **EC-1** IF GitHub refuses the commit or the PR, THEN the system shall show GitHub's error message, record no installation and offer "Download zip". · traces: DR-19 · verify: integration
- **EC-2** IF the chosen repository already has a CI installation for another agent, THEN Install shall be refused with a message naming that agent. · traces: DR-19 · verify: integration
- **EC-3** IF Install is activated again for the same agent and repository, THEN the system shall leave one open PR from `devdigest/ci` and one installation. · traces: DR-19 · verify: integration
- **EC-4** IF the edited workflow does not parse as YAML, THEN Install shall be disabled and the parse error shown. · traces: DR-19 · verify: component
- **EC-5** IF an enabled skill is flagged by the existing injection scan, THEN it shall be left out of the export and Preview shall name it as skipped. · traces: DR-19 · verify: integration
- **EC-6** IF a completed run fails any check in AC-11, THEN it shall be listed as failed with "result rejected", and no counts or cost shall be taken from its artifact. · traces: US-6 · verify: integration
- **EC-7** IF a completed run has no `devdigest-result` artifact, or the artifact has expired, THEN it shall be listed as failed with "no result produced" and its job link. · traces: DR-19 · verify: integration
- **EC-8** IF Refresh covers runs already stored, THEN each GitHub run shall remain stored once. · traces: DR-19 · verify: integration
- **EC-9** IF GitHub is unreachable or rate-limited during Refresh, THEN stored runs shall stay visible and an error with a retry shall be shown. · traces: DR-19 · verify: component
- **EC-10** IF the runner bundle has not been built or cannot be read, THEN Preview shall show a message telling the user to run `pnpm build` in `agent-runner`, and both install paths shall be disabled. · traces: DR-7 · verify: integration
- **EC-11** IF the workspace has no imported repository, THEN the Target step shall say a repository must be imported first, and Continue shall be disabled. · traces: DR-15 · verify: component

## Design review
**Source:** specs/designs/export-to-ci/: `00`–`04` PNGs, `screen_export.jsx`, `screen_agent_ci_tab.jsx`, `screen_ci_runs.jsx`, `data_ci_runs.jsx`. The state checklist was run per screen against the tree.
### Gaps
- **DR-1** No `ci` module and no export, list or ingest routes exist (the directory listing of `server/src/modules/`). `POST /agents/:id/export-ci` is named in `eval-ci.ts:410` but not implemented.
- **DR-2** There is no `/ci-runs` page and no nav entry (`client/src/vendor/ui/nav.ts:33-36`). The active key is already mapped (`client/src/components/app-shell/helpers.ts:38`).
- **DR-3** There is no CI tab. The tabs are Config, Skills, Context and Evals (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11-15`).
- **DR-4** `GitHubClient` can commit files and find or open a PR, but cannot list workflow runs or download artifacts (`server/src/vendor/shared/adapters.ts:143-190`).
- **DR-5** `ci_installations` has no workflow-version field. `ci_runs` has no head SHA, run identity or per-severity counts (`server/src/db/schema/ci.ts:4-27`). They are stored where they fit; a migration is allowed only where no field fits.
- **DR-6** `CiResultArtifact` has no SHA, repository id or model (`eval-ci.ts:465`). These are taken from the verified run metadata and the installation (Q-6).
- **DR-7** The studio has nothing today that embeds the runner bundle. The bundle is a local build artifact: `cd agent-runner && pnpm build` produces `agent-runner/dist/` with three files that must ship together — `index.js` (ESM), `300.index.js` (a lazy chunk) and `package.json` (`"type":"module"`). It is git-ignored and not committed to the DevDigest repo (Q-5).
- **DR-8** The manifest has no `post_as` field, and the runner reads `DEVDIGEST_POST_AS` from env (`agent-runner/src/index.ts:25`). → AC-6
### Uncovered cases
- **DR-9** PNG 02 shows `uses: devdigest/review-action@v1` with `OPENAI_API_KEY`, while the jsx and the requirements use the bundled runner and `OPENROUTER_API_KEY`. → AC-6
- **DR-10** The jsx path `.devdigest/runner.mjs review … --fail-on` disagrees with the runner README's `.devdigest/runner/index.js`, which takes env only. → AC-6, and the threshold lives in the manifest.
- **DR-11** The design YAML has no `permissions:` block, uses `secrets.GITHUB_TOKEN`, pins actions to tags and uses Node 20. → AC-6
- **DR-12** The Configure "Secrets expected" panel shows `not set` / `ready`, which the studio cannot know. → AC-7, static text.
- **DR-13** The CI Runs mock has no repository column and no job link, and lists CircleCI as a source. → AC-13
- **DR-14** Target shows four targets; only GitHub Actions is implemented. → AC-3
- **DR-15** The wizard never picks a repository, yet Install names one. → AC-3, EC-11
- **DR-16** The export tree omits the runner bundle. → AC-4
- **DR-17** "Fail CI on" offers three options, while `CiFailOn` has four (`server/src/vendor/shared/contracts/knowledge.ts:480`). → AC-2 (Q-7)
- **DR-18** "Fail CI on" appears only in the jsx, not in PNG 00. → AC-2
- **DR-19** States the design does not show:
  - an install that fails or is repeated;
  - a repository taken by another agent;
  - an invalid edited workflow;
  - a flagged skill;
  - a rejected or missing artifact;
  - a repeated or failing Refresh.

  → EC-1 to EC-9.
- **DR-20** `client/messages/en/ci.json:71` says blocking needs a GitHub App, which contradicts the design note. → AC-7
### Module interactions
| From | To | Through | Contract |
|---|---|---|---|
| `client` CI tab | `server` `modules/ci` | `GET /agents/:id/ci` (installations + runs) | `CiInstallation`, `CiRun` in server/src/vendor/shared/contracts/eval-ci.ts · existing, extended |
| `client` "Fail CI on" | `server` `modules/agents` | `PATCH /agents/:id` | `Agent` in contracts/knowledge.ts · existing |
| `client` wizard | `server` `modules/ci` | preview, `POST /agents/:id/export-ci` (`open_pr` \| `files`), zip download | `CiExportInput`, `CiExport`, `CiFile` · existing; zip response · new |
| `client` CI Runs | `server` `modules/ci` | `GET /ci/runs`, `POST /ci/runs/refresh` | `CiRun` · existing, extended |
| `server` `modules/ci` | GitHub | `GitHubClient`: commit files, find/open PR (existing); list workflow runs, download artifact (new) | `CommitFilesPayload` in vendor/shared/adapters.ts · existing; run/artifact shapes · new |
| target repo workflow | `agent-runner` | `node .devdigest/runner/index.js`, artifact upload | `AgentManifest`, `CiResultArtifact` · existing |
### UX improvements
- **DR-21** *proposed, adopted (Q-8)*: static next steps in the Install success state. Motivated by US-3 → AC-8.

## Non-functional requirements
- **NFR-1** Secrets: the generator reads no secret. No generated file, zip, stored row, trace or log contains an LLM key or GitHub token value, and the studio's token never reaches the client. · verify: integration
- **NFR-2** Cost: export, update and ingest make zero LLM calls. · verify: integration
- **NFR-3** i18n: every user-facing string on the CI tab, wizard and CI Runs comes from `messages/en/ci.json`. · verify: static
- **NFR-4** Accessibility: the wizard is operable by keyboard. Status and severity are shown as text or icon, never by colour alone. · verify: component

## Traceability
| Requirement | Traces to | Verify how |
|---|---|---|
| AC-1 | US-4 | component |
| AC-2 | US-3, DR-17, DR-18 | component |
| AC-3 | US-1, DR-14, DR-15 | component |
| AC-4 | US-1, US-2, DR-16 | component |
| AC-5 | US-1 | unit |
| AC-6 | US-2, DR-8, DR-9, DR-10, DR-11 | unit |
| AC-7 | US-3, DR-12, DR-20 | component |
| AC-8 | US-1, US-2, DR-21 | integration |
| AC-9 | US-1 | integration |
| AC-10 | US-3, US-4 | integration |
| AC-11 | US-6 | integration |
| AC-12 | US-5, US-6, DR-5, DR-6 | integration |
| AC-13 | US-5, DR-13 | component |
| AC-14 | US-4 | component |
| AC-15 | US-4, US-5 | component |
| AC-16 | US-5, DR-2 | component |
| EC-1 | DR-19 | integration |
| EC-2 | DR-19 | integration |
| EC-3 | DR-19 | integration |
| EC-4 | DR-19 | component |
| EC-5 | DR-19 | integration |
| EC-6 | US-6 | integration |
| EC-7 | DR-19 | integration |
| EC-8 | DR-19 | integration |
| EC-9 | DR-19 | component |
| EC-10 | DR-7 | integration |
| EC-11 | DR-15 | component |
| NFR-1 | US-2, US-6 | integration |
| NFR-2 | US-1 | integration |
| NFR-3 | US-5 | static |
| NFR-4 | US-1 | component |

DR-1, DR-3 and DR-4 are closed by the surfaces in AC-1, AC-3, AC-8 and AC-11 to AC-14.

**Acceptance scenario (manual):**
1. Export to a fork of a demo repository that has been imported into the workspace.
2. Review the PR: permissions, triggers, secrets, and how PR code runs.
3. Add `OPENROUTER_API_KEY` under Settings → Secrets and variables → Actions, then merge.
4. Open a test PR in the same repository, not from a fork, and confirm the agent result is posted.
5. Set "Fail CI on: Critical", run Update CI config, make the check required, and confirm a CRITICAL finding turns it red.
6. Confirm no secret appears in logs or artifacts.
7. Refresh CI Runs and confirm the run shows the right repository, PR, SHA and job link.

## Inputs and provenance
| Source | Path or URL | What it settled |
|---|---|---|
| request | caller brief 2026-10-11 (user requirements, translated from Ukrainian) | Scope (worktree B), the 4 steps, the `devdigest/ci` PR, security rules, `agent_runs` with `source='ci'`, the acceptance flow |
| answers | coordinator, 2026-10-11, relaying the user: "very simple implementation, don't over-complicate, we'll iterate after we learn what users need — but per the requirements" plus decisions 1–11 | Q-1 to Q-11 resolved to the simplest option; the cuts listed under *Out of scope* |
| answers | coordinator, 2026-10-11, user-approved amendment | Non-goal exception for the `agent-runner/src/index.ts` direct-run guard fix; the installation records manifest version, model and runner bundle sha256 for the trace (Goals, AC-8, AC-12) |
| research | researcher report "GitHub PAT, workflow, artifact and merge-gating behaviour" (2026-10-11) | Pushing a workflow needs `workflow` / Workflows: write; the run object has `head_sha`, `repository.id`, `path`, `pull_requests`, `html_url`; artifact download returns a zip (90-day default retention); fork `pull_request` runs get no secrets and a read-only token; unspecified permissions are `none`; SHA pinning is the only immutable reference; only a required check reliably blocks a merge |
| design | specs/designs/export-to-ci/*.png, *.jsx | Screens, copy, the Fail CI on control, empty states, columns; inconsistencies DR-9 to DR-18 |
| repo | agent-runner/README.md; agent-runner/src/manifest.ts:40; agent-runner/src/index.ts:25; agent-runner/src/artifact.ts | Runner path, single manifest, env-only input, artifact fields, no artifact on a hard failure |
| repo | server/src/vendor/shared/contracts/eval-ci.ts:370-476; server/src/db/schema/ci.ts; server/src/db/schema/runs.ts:38; server/src/db/schema/knowledge.ts:20 | Existing contracts and tables; `memory` has repo scope and no agent column |
| repo | server/src/platform/container.ts:287-293; server/src/vendor/shared/adapters.ts:143 | The GitHub client is built from `GITHUB_TOKEN` via SecretsProvider and can commit, open and find PRs |
| repo | `remotes/upstream/full-functionality:specs/14-export-to-ci.md` (711a447) | A prior upstream design with pull ingest and one agent per repo; reference only |
| insights | INSIGHTS.md:299-304 | A contract change is mirrored to the client copy in the same commit (AC-12, AC-13) |
| insights | client/INSIGHTS.md:118-122 | A count the user sees comes from one source; per-severity counts are taken from the artifact |
| insights | INSIGHTS.md:351-357 | The injection scan is a vetting gate, reused as an export filter (EC-5) |

## Untrusted inputs
| Input | Source | Validation | On invalid |
|---|---|---|---|
| Repository choice | wizard form | Identity: an imported repository of this workspace | 404; Continue disabled |
| Edited workflow YAML | wizard Preview | Shape and bounds: ≤ 64 KiB, parses as YAML | Install disabled, parse error shown (EC-4) |
| Export body (triggers, publication mode, action) | client request | Shape and bounds: `.strict()` contract; triggers ⊆ {opened, synchronize, reopened}, at least 1 | 422 naming the field |
| Workflow run metadata | GitHub API | Identity: repository id and workflow path equal the installation's; head SHA present | Run listed as rejected (EC-6) |
| `devdigest-result.json` | artifact from the target repo's CI (PR authors can influence it) | Shape and bounds: `CiResultArtifact`, ≤ 64 KiB; PR number among the run's PRs | Rejected, no counts stored (EC-6) |
| PR title, agent name in the artifact | GitHub API / artifact | Text that is rendered: plain text, truncated | Rendered as text |
| Filter query params on `/ci/runs` | URL | Shape and bounds: uuids | 422 naming the param |

## Open questions
- None outstanding for the stated scope.

**Resolved decisions** (2026-10-11, the user via the coordinator, simplest option chosen)
- Q-1, resolved: ingest is pull only. The studio downloads the `devdigest-result` artifact with the user's token, on page open and on Refresh, and verifies it per AC-11. The PR check uses the run payload's own `pull_requests`, so it needs no extra call (AC-11, AC-12, EC-6).
- Q-2, resolved: the credential is the existing `GITHUB_TOKEN` from SecretsProvider. A permission error shows GitHub's message and offers the zip. No scope detection (EC-1).
- Q-3, resolved: `memory.jsonl` holds the repo-scoped `memory` rows (content and kind) when the repository is imported, else it is an empty file (AC-4).
- Q-4, resolved: "Fail CI on" is the agent's existing `ci_fail_on` and takes effect after "Update CI config" (AC-2, AC-10).
- Q-5, resolved: (amended 2026-10-11, user decision via the coordinator) the runner bundle is a local build artifact. `cd agent-runner && pnpm build` produces `agent-runner/dist/`, which is a documented setup step; whether `scripts/dev.sh` runs it is the planner's call. The folder stays git-ignored and is not committed to the DevDigest repo. The studio reads it from disk at export time and embeds it whole as `.devdigest/runner/` (3 files) in both the target-repo PR and the zip, and the workflow runs `node .devdigest/runner/index.js`. When the bundle has not been built, Install is disabled with a message telling the user to run `pnpm build` (AC-4, EC-10, DR-7). `agent-runner/` is a shared package; this feature consumes it.
- Q-6, resolved: no new fields in `devdigest-result.json` (DR-6).
- Q-7, resolved: three options exactly, Critical / Warning + / Never (AC-2).
- Q-8, resolved: the out-of-date badge is dropped. The post-install checklist is static text in the success state (AC-8, DR-21).
- Q-9, resolved: one agent per repository. A second agent is refused (EC-2).
- Q-10, resolved: no interval polling. Data is fetched on page or tab open and on Refresh (AC-11).
- Q-11, resolved: only enabled skills are exported. A skill flagged by the existing injection scan is left out, with no new scanning (EC-5).
