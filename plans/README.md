# plans — implementation plans

A plan says **how** a feature gets built: numbered steps with file paths, the layer each
file lives in, the skills the implementer must load, an observable "done when" and a
verify command per step. It is produced by the `implementation-planner` agent from a spec
and consumed by `implementer` (one invocation, or one per track in multi-agent mode) and
`plan-verifier`.

A plan is **not** a spec. The spec (`specs/YYYY-MM-DD-short-name.md`, see
[`specs/README.md`](../specs/README.md)) says *what* and *why* — problem and user, goals,
EARS acceptance criteria, edge cases, design review, untrusted inputs — and is drafted by
`spec-creator` and approved by a person before planning. The planner never fills a
missing spec section; it reports the gap and asks.

## Convention

One file per plan: `YYYY-MM-DD-short-name.md`, with the **same stem** as the spec it
implements (`specs/2026-09-29-copy-finding-markdown.md` →
`plans/2026-09-29-copy-finding-markdown.md`); a plan without a spec takes the date it was
written. A pre-template spec keeps its number (`specs/09-blast-radius.md` →
`plans/09-blast-radius.md`). The header carries the Plan ID,
the spec path and the execution mode (`single-agent` or `multi-agent`); a multi-agent plan
also has a `## Tracks` table with exclusive file ownership per track.

The planner writes the file here itself and returns a short **Plan Report** with the path;
the implementer and the verifier are handed that path, never a summary. When the planner
returns a *Requirements review* instead, nothing is written yet.

Delete a plan or move it to `done/` once the feature ships — do not leave a stale plan
where an agent will read it as current work.
