# `blast` — Blast Radius

`GET /pulls/:id/blast-radius` shows, per PR: the symbols declared in its changed
files, who calls them (`file:line`), and the HTTP endpoints and crons that live
in those callers' files. It only **reads** the `repo-intel` index — no LLM, no
re-indexing (see `server/src/modules/repo-intel/README.md`).

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
