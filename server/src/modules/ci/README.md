# modules/ci — Export to CI

Turns an agent into a pull request (or a zip) that installs the DevDigest review
into a repository's GitHub Actions, and pulls the workflow's results back as
verified **CI Runs**. No LLM call is made by export, update or ingest.

## Setup (once)

The exported runner is the locally built `agent-runner/dist/`. It is git-ignored
and embedded whole (every regular file; `index.js` and `package.json` must exist).

```sh
cd reviewer-core && npm install
cd ../agent-runner && pnpm install && pnpm build
```

Without it the preview says `bundle_missing: true` and both install paths are
refused with 422 `ci_bundle_missing`.

## Routes

| Route | Result | Errors |
|---|---|---|
| `GET /agents/:id/ci` | `AgentCi` (installations + runs) | 404 |
| `GET /agents/:id/export-ci/preview?repo=&post_as=&triggers=a,b` | `CiPreview` — nothing written | 404 · 422 |
| `POST /agents/:id/export-ci` | `CiExport` (`open_pr` or `files`) | 404 · 409 `ci_repo_taken` (`details.agent_name`) · 422 `ci_bundle_missing` / `ci_workflow_invalid` · 502 `ci_github_failed` |
| `POST /agents/:id/ci/update` (body `{}`) | `CiUpdateResult`, one entry per repo | 404 · 422 `ci_bundle_missing` |
| `GET /ci/runs?agent_id=&repo_id=` | `CiRun[]`, newest first | 404 unknown `repo_id` · 422 non-uuid |
| `POST /ci/runs/refresh` | `{ ingested }` | 502 `ci_github_failed` |

## The exported file set

In order: `.devdigest/agents/<slug>.yaml` (parses under `AgentManifest`), the
enabled skills at `.devdigest/skills/<slug>.md`, `.devdigest/memory.jsonl`,
`.devdigest/runner/*`, optionally `.gitattributes`, and
`.github/workflows/devdigest-review.yml`. Only the workflow is editable.

- A skill from an imported source that the injection scan flags is left out and
  named in `skipped_skills`.
- `.gitattributes` (`.devdigest/runner/** linguist-generated=true`) is written
  **only when the default branch has none**, never merged into an existing one,
  and omitted whenever GitHub cannot be read (no token, network, rate limit).
- The manifest path is recorded in `ci_installations.export_meta` and reused on
  update and re-install — the runner fails on more than one manifest.
- The workflow is a fixed template: `pull_request` only, `contents: read` +
  `pull-requests: write`, forks skipped, actions pinned to commit SHAs
  (`PINNED_ACTIONS` in `constants.ts`; re-resolve with
  `git ls-remote https://github.com/actions/<name> 'refs/tags/v*'` and replace the
  sha and the trailing version comment). No agent text is interpolated into it.
  A client-edited workflow is sent verbatim (≤ 64 KiB, must parse as YAML).

## Verification order (refresh)

For each installation, `listWorkflowRuns` (completed `pull_request` runs of the
workflow file), skipping `skipped` and already-stored run ids. Per run:
repository id equals the installation's → workflow path equals
`.github/workflows/devdigest-review.yml` (an `@ref` suffix is stripped) → head
SHA present → artifact `devdigest-result` present (`no_result` otherwise) and
≤ 64 KiB → `devdigest-result.json` parses as `CiResultArtifact` → its
`pr_number` is one of the run's pull requests. Any miss stores the run as
`failed` / `result_rejected` with no counts or cost. Stored once, keyed by the
GitHub run id.

## `agent_runs.pr_id` stays NULL

A CI run is an `agent_runs` row with `source='ci'` and **no** `pr_id`; the link
to repository, PR number, SHA and job URL lives on `ci_runs`. That keeps CI runs
out of the PR-list rollup (`pulls/routes.ts`) and the PR run history
(`reviews/repository/run.repo.ts`), which both key on `pr_id`.

## Layout

`constants.ts` / `helpers.ts` / `service.ts` / `types.ts` are ring 2 (pure; the
`CiStore` and `RunnerBundleSource` ports live in `types.ts`). `repository.ts`
(queries) and `repository-bundle.ts` (reads `agent-runner/dist/`) are ring 3.
Tests swap the bundle through `ContainerOverrides.runnerBundle`.
