# Report contracts

Everything is written under `.devdigest/pr-self-review/` (git-ignored). Files the skill
writes are marked *skill*; the rest are written by `pr-self-review-gate.mjs`.

| File | Written by | Purpose |
|---|---|---|
| `scope.json` | `scope` | what is under review, routing, cache hits, static findings |
| `checks.json` | `checks` | lint / typecheck / arch results per package |
| `findings.json` | *skill* | the review's own findings (array) |
| `waivers.json` | *the user* | accepted CRITICALs with a reason |
| `report.json` | `finalize` | the certified report the gates read |
| `pr-body.md` | `finalize` | ready for `gh pr create --body-file` |
| `cache.json` | `finalize` | path → blob hash of every file covered by `report.json` |
| `history.jsonl` | `finalize` | one line per run, for tuning the rules |

## Finding (what the skill writes to `findings.json`)

```json
{
  "severity": "CRITICAL",
  "skill": "onion-architecture",
  "rule": "Rule 5 — row type in a ring-2 signature",
  "file": "server/src/modules/reviews/service.ts",
  "line": 42,
  "summary": "resolveTargets() exposes AgentRow in its public signature",
  "evidence": "export async function resolveTargets(agents: AgentRow[])",
  "fix": "Map the row to the 3–4 fields the use case reads in helpers.ts and take that type instead."
}
```

| Field | Required | Rules |
|---|---|---|
| `severity` | yes | one of the values in `scope.json → severity_enum` (today `CRITICAL`, `WARNING`, `SUGGESTION`); `HIGH`/`MEDIUM`/`LOW` are normalised, anything else drops the finding |
| `skill` | yes | a routed skill name, or `insights` |
| `rule` | yes | the section / rule name inside that skill, quoted closely enough to be found |
| `file` | yes | a path from `scope.json → files` |
| `line` | yes | inside one of that file's `hunks` ranges (new-file side) |
| `summary` | yes | one sentence, the defect, no rationale |
| `evidence` | no | the offending line or symbol, verbatim |
| `fix` | no, but expected | what to change, in one or two sentences |
| `id` | no | defaults to `<skill>:<file>:<line>:<slug(rule)>`; set it only to keep a stable id across runs |

`finalize` drops findings that break a rule above and lists them with the reason under
*Dropped*. Read that list: a dropped finding is either a hallucinated line or a real issue
outside the diff, and the second kind belongs in a separate ticket, not this PR.

## `report.json`

```json
{
  "version": 1,
  "generated_at": "2026-09-18T18:02:11.000Z",
  "started_at": "2026-09-18T17:59:40.000Z",
  "duration_ms": 151000,
  "branch": "feat/x",
  "base": { "ref": "origin/main", "sha": "db2cb62…" },
  "head": "…",
  "fingerprint": "sha256 of (diff vs base ‖ untracked blobs)",
  "verdict": "PASS | BLOCK",
  "counts": { "CRITICAL": 0, "WARNING": 2, "SUGGESTION": 3 },
  "waived": 1,
  "checks": [ { "pkg": "server", "cmd": "pnpm run lint", "ok": true, "exit": 0, "ms": 8120 } ],
  "skills_applied": ["onion-architecture", "fastify-best-practices"],
  "groups": { "backend": { "skills": ["…"], "files": 4, "reviewed": 3, "cached": 1 } },
  "files": 12,
  "changed_lines": 340,
  "findings": [ { "id": "…", "severity": "…", "skill": "…", "rule": "…", "file": "…", "line": 0,
                  "summary": "…", "evidence": "…", "fix": "…",
                  "waived": true, "waiver_reason": "…", "carried": true } ],
  "dropped": [ { "file": "…", "line": 0, "summary": "…", "reasons": ["line 99 is outside every hunk …"] } ],
  "stale_waivers": []
}
```

- `counts` keys are the `Severity` enum from `findings.ts`, so a report can never count a
  level the product does not know. Waived findings are listed but not counted.
- `verdict` is `BLOCK` iff `counts.CRITICAL > 0`.
- `fingerprint` is content-based: committing the same working tree does not invalidate the
  report; changing any byte in the diff does.
- `carried: true` marks a finding copied from the previous report because the file's blob
  hash did not change. Static and check findings are never carried; they are recomputed.

## `waivers.json`

```json
[
  { "id": "static:do-not-touch:reviewer-core/src/grounding.ts",
    "reason": "Agreed in #12: grounding now also accepts repo-map citations.",
    "author": "dmitrii" }
]
```

A waiver with an empty `reason` is ignored. A waiver whose `id` matches no finding is
reported as stale so the file does not accumulate dead entries. Waivers are per-branch,
local, and show up verbatim in `pr-body.md` — that is the point.

## `pr-body.md`

Verdict line, the checks table, the skills applied, non-SUGGESTION findings in a
`<details>` block, every waiver with its reason, and the fingerprint in a footer. Use it as
the PR body (or append it): `gh pr create --body-file .devdigest/pr-self-review/pr-body.md`.

## `history.jsonl`

```json
{"at":"…","branch":"…","verdict":"BLOCK","counts":{…},"waived":0,"files":12,"lines":340,
 "duration_ms":151000,"rules":["static:secret","onion-architecture:Rule 2"],"checks_failed":["server:pnpm run lint"]}
```

One line per `finalize`. After a few weeks, `rules` tells you which rule fires most and
whether it is finding real defects or noise — that is the input for moving a rule between
CRITICAL and WARNING in `routing.md`.

## Markdown summary (what the user sees)

Printed by `finalize`, in this order: header with verdict · branch/base/size line · checks
table · groups table (skills, files, reviewed, cached) · findings grouped by severity, each
with `file:line`, summary, `skill · rule · evidence`, fix and id · dropped findings ·
stale waivers · the closing line (`BLOCK — N critical …` or `PASS — … unlocked`).
