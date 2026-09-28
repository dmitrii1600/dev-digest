# `blast` — Blast Radius

`GET /pulls/:id/blast-radius` shows, per PR: the symbols declared in its changed
files, who calls them (`file:line`), and the HTTP endpoints and crons that live
in those callers' files. It only **reads** the `repo-intel` index — no LLM, no
re-indexing (see `server/src/modules/repo-intel/README.md`).

`GET /pulls/:id/history` — "Prior PRs touching these files" (spec 09, P3-d) —
shows prior **merged** PRs that touched the same files, from GitHub. No LLM,
no index read; see *Prior PRs touching these files* below.

## Data flow

```
pr_files (persisted, written only by GET /pulls/:id)
  → BlastRepository.getPrScope        (repoId + changed paths, ring 3)
  → repoIntel.getBlastRadius / getIndexState   (facade, read-only)
  → helpers.ts: resolveDegraded → toBlastRadius → BlastRadius contract
```

`BlastService.forPull` calls the facade **once** per method (`Promise.all`),
never `indexRepo`/`refreshIndex`/`resyncRepo`, and logs one line proving the
read: `blast radius read from repo-intel index (no re-index)`.

## Degraded

`degraded`/`reason` are resolved by `helpers.ts#resolveDegraded`, first match
wins:

| Condition | `degraded` | `reason` |
|---|---|---|
| repo-intel disabled (`REPO_INTEL_ENABLED=false`) | true | `flag_off` |
| index state is `degraded`/`failed`, or no state row (never indexed) | true | the index's own reason, default `index_failed` (`no_data` when never indexed) |
| index state is `partial` | true | `index_partial` |
| the facade itself returned `degraded` | true | its reason, default `no_data` |
| otherwise | false | `null` |

When the flag is off, or the index isn't `full`/`partial`, `repoIntel.getBlastRadius`
falls back to a ripgrep read of the clone at request time (logged as
`source:'fallback'` in the one log line above) rather than the persistent
index (`source:'index'`).

## Limits

`MAX_CALLERS_PER_SYMBOL` (`repo-intel/constants.ts`) caps callers per symbol
group. `BFS_DEPTH` is not used here — blast is one hop by construction.

## Known limitations

- The facade caps callers **globally** across all changed symbols, not per
  symbol (`repo-intel/service.ts:372,386`) — with more than the cap resolved
  in total, a low-rank symbol can show zero callers even though the mapper's
  per-symbol cap has room. This module does not change the facade (out of
  scope for `specs/09-blast-radius.md`).
- Two changed symbols sharing the same bare name in different files are
  merged into one `downstream` entry (`viaSymbol` is a bare name); the
  declaring-file guard can then drop a genuine cross-file caller in that case.
- On the fallback (ripgrep) path there is no `factsByFile`, so endpoints/crons
  per symbol are always empty — the degraded badge is the explanation, not a
  bug in the mapper.

## "Prior PRs touching these files"

```
GET /pulls/:id/history
  → BlastRepository.getPrHistoryScope   (repoId + owner/name + number + head_sha + changed paths, ring 3)
  → cache check: pr_brief.json.history.computed_for_sha === head_sha?
      hit  → return the cached PrHistoryItem[]
      miss → GitHubClient.listCommitsForPath (per candidate file, capped)
           → GitHubClient.listPullsForCommit (per unique commit, capped)
           → helpers.ts: selectHistoryFiles → collectUniqueCommits → buildPrHistory
           → BlastRepository.upsertHistory (persist, keyed by head_sha)
```

No LLM. `notes` is a fixed, code-built sentence
(`Touched {n} of this PR's files; merged {date}.`), never model text.

**Caps** (`constants.ts`): `MAX_HISTORY_FILES` (12, preferring non-test source
files over test files, skipping docs/lockfiles entirely), `MAX_HISTORY_COMMITS_PER_FILE`
(5), `MAX_HISTORY_UNIQUE_COMMITS` (40, deduped across files), `MAX_HISTORY_PRS`
(5, most recently merged first). The PR being viewed and any unmerged PR are
excluded — `PrHistoryItem.merged_at` is required by the contract.

**`files_overlap`** is derived from the commit lookups already made — which of
the viewed PR's candidate files led (via a shared commit) to a prior PR — never
an extra `GET /pulls/:n/files` call.

**Cache.** The result is persisted in `pr_brief.json.history` (the same jsonb
document the future `PrBrief` composes — `contracts/brief.ts:157-164`), merged
in rather than overwriting the whole document. A cache hit at the PR's current
`head_sha` makes zero GitHub calls.

**Failure mode.** When the GitHub adapter throws (no `GITHUB_TOKEN`, rate
limit, network) the route returns `{ history: [] }` and logs a warning — it
never 500s and never persists a failed attempt as if it were a real result.

## Demo data

`acme/payments-api` (the seeded demo repo) has no clone, so nothing can index
it. `src/db/seed-blast.ts` therefore seeds a small **synthetic** `full` index
for it — `repo_index_state`, `symbols`, `references`, `file_edges`, `file_rank`
and `file_facts` for PR #482 — written through `RepoIntelRepository` so
`decl_file` resolution is the indexer's own SQL, plus one cached prior merged
PR in `pr_brief.json.history`. The Overview tab then shows a real map (3
symbols, 4 callers, 3 endpoints, 1 cron) and `e2e/specs/13-blast-radius.flow.json`
asserts it. The fixture is rebuilt by `pnpm db:seed` whenever its
`repo_index_state` row is missing or carries an older `INDEXER_VERSION`; a
Resync on this repo is a `no_clone` no-op and never overwrites it.
