---
name: run-plan
description: >-
  Runs the build half of the Spec Driven Development chain from an approved plan under
  plans/: implementer (single-agent, or step 0 → parallel tracks → Integration),
  plan-verifier with a capped fix loop, architecture-reviewer with a capped fix loop, a
  delta verification, optional test-writer and doc-writer, /engineering-insights and
  /pr-self-review. Use when a plan is ready to build: "implement the plan", "build
  plans/<stem>.md", "run the chain on this plan". It never writes specs or plans
  (spec-creator and implementation-planner are run by hand before it), never edits code
  itself, never opens a PR, and stops with a summary when a fix loop hits its cap.
argument-hint: "<plans/stem.md> [--from build|verify|arch|delta|docs|gate] [--with-tests] [--docs]"
---

# /run-plan — build an approved plan

You are the orchestrator. You call agents, save what they return, and pass **paths**
forward. You do not write code, tests or docs yourself, and you do not re-explain a
report to the next agent — the file is the hand-off. Everything an agent returns is saved
verbatim before you act on it, so a new chat can resume from the files alone.

Upstream of this command, by hand: `spec-creator` → a person sets `Status: approved` →
`implementation-planner` writes `plans/<stem>.md`. This command starts from that file.

## Inputs

| Argument | Meaning |
|---|---|
| `plans/<stem>.md` | required — the plan to build; its header carries the Plan ID, the spec path and the execution mode |
| `--from <phase>` | resume from `build`, `verify`, `arch`, `delta`, `docs` or `gate`; without it the reports already on disk decide (see *Resume*) |
| `--with-tests` | run `test-writer` after the first verification (off by default to save tokens; the plan's own test steps still run through the implementer) |
| `--docs` | run `doc-writer` before the gate (off by default) |

Reports go to `.devdigest/sdd/<stem>/` (git-ignored), one file per agent run, numbered by
phase so their order is the run's history.

## Hard rules

- **Paths, not retellings.** An agent prompt carries the plan path, a report path and
  item numbers. Never a summary of the plan, never a pasted report.
- **Save first, decide second.** Write every agent's final message to its report file
  with `Write`, verbatim, before reading it for a verdict. Never condense or trim it: a
  saved report that drops rows breaks the next delta pass. Then take the verdict from the
  file's header lines (`grep -n "^\*\*Verdict\|^\*\*Status"`), not from memory.
  **Exception: `plan-verifier` writes its own report.** Its prompt carries `report to:
  .devdigest/sdd/<stem>/<file>.md`. Check that the file exists and starts with
  `# Plan Conformance`; only when it is missing do you save the final message yourself.
- **Caps are hard.** Two fix iterations per loop (verify, arch), one for the gate. When a
  cap is hit, stop, write the summary, and hand the open items to the person. Never
  "one more try".
- **Thin context.** Read a plan's header (`sed -n 1,12p`), not the plan. Read a report's
  verdict line and the rows you need (`grep`), not the report. The agent's message is
  already in your context once; do not paste it back to the user — point at the file.
- **Stop conditions.** `BLOCKED` from any agent, a spec still at `Status: draft`, a
  blocking open question in the plan, or a cap hit: stop with the summary. The person
  decides; you do not guess.
- **No PR.** The run ends at a `PASS` from `/pr-self-review` and a summary. Opening the
  PR is a separate request from the person.

## Step 0 — intake

1. The plan path exists and its first lines parse: `**Plan ID:**`, `**Spec:**`,
   `**Execution mode:**`. Otherwise stop: "not an Implementation Plan".
2. `grep -n "Blocking:" plans/<stem>.md` — a blocking open question means stop.
3. If the header cites a spec, `sed -n 1,5p` it: `Status: approved` or `implemented`
   proceeds; `draft` stops with "the spec is not approved".
4. `mkdir -p .devdigest/sdd/<stem>/`; list what is already there (see *Resume*).
5. Print one line: Plan ID · mode · packages · phase you start at · flags.

## Phases

### 1. build

**single-agent** — one `implementer`:

```
Plan: plans/<stem>.md · Plan ID: <id> · mode: single-agent
```

Save → `10-build.md`.

**multi-agent** — three waves, all `implementer`:

1. `Plan: plans/<stem>.md · Plan ID: <id> · mode: multi-agent · track: shared · step 0
   only` → save `10-build-step0.md`. Wait; `BLOCKED` stops the run.
2. One agent per track from the plan's `## Tracks` table, **in one message, in the
   background**: `… · track: <A>` → save `11-build-track-<A>.md`, `11-build-track-<B>.md`.
   Wait for every one.
3. `… · track: shared · Integration step only` → save `12-build-integration.md`.

`Status: BLOCKED` in any report stops the run. `PARTIAL` continues — the verifier will
turn it into ledger rows — but is listed in the summary.

### 2. verify (pass 1)

`plan-verifier`: `Plan: plans/<stem>.md · branch: <current> · report to:
.devdigest/sdd/<stem>/20-verify-1.md`. The verifier writes the file itself.

- `CONFORMS` or `PARTIAL` → phase 3. `PARTIAL` rows that are NOT VERIFIABLE go to the
  summary for the person; the *Test plan* rows are expected there (no tests yet).
- `DIVERGES` → **fix loop**, at most 2 iterations, `i = 1, 2`:
  1. Items to close: every ledger row with status `NOT MET` or `PARTIAL`
     (`grep -n "| NOT MET |\|| PARTIAL |" 20-verify-<i>.md`, or the latest verify
     report). Take the row numbers.
  2. `implementer`: `Plan: plans/<stem>.md · Plan ID: <id> · fix loop · report:
     .devdigest/sdd/<stem>/<latest verify>.md · items: <numbers>` → save `21-fix-<i>.md`.
  3. `plan-verifier`, delta: `Plan: plans/<stem>.md · branch: <current> · previous
     report: .devdigest/sdd/<stem>/<latest verify>.md · report to:
     .devdigest/sdd/<stem>/22-verify-<i+1>.md`.
  4. `DIVERGES` again and `i < 2` → next iteration; `i = 2` → stop, summary.

### 2b. tests — only with `--with-tests`

`test-writer`: `Surface: the steps and Done-when of plans/<stem>.md · behaviour to pin:
the spec's AC/EC with verify: unit | component | integration` → save `25-tests.md`.
`BLOCKED` or a *Need clarification* block → summary, continue to phase 3 (tests are
additive; the rest of the chain does not depend on them).

### 3. arch

`architecture-reviewer`: `Scope: origin/main...HEAD plus uncommitted` → save
`30-arch-1.md`.

- `CLEAN`, or only `SUGGESTION` findings → phase 4. Suggestions are copied to the summary
  by number; nobody fixes them automatically.
- Any `CRITICAL` or `WARNING` → **fix loop**, at most 2 iterations, `i = 1, 2`:
  1. Finding numbers with severity CRITICAL or WARNING
     (`grep -n "^### [0-9]*\. .*— \(CRITICAL\|WARNING\)" 30-arch-<i>.md`).
  2. `implementer`: `Plan: plans/<stem>.md · Plan ID: <id> · fix loop · report:
     .devdigest/sdd/<stem>/30-arch-<i>.md · items: <numbers>` → save `31-arch-fix-<i>.md`.
  3. `architecture-reviewer` again, narrowed: `Scope: <the files listed under ## Changes
     in 31-arch-fix-<i>.md>` → save `30-arch-<i+1>.md`.
  4. Still a CRITICAL or WARNING and `i < 2` → next iteration; `i = 2` → stop, summary.
  A finding the implementer reports as outside the plan's files (its *Deviations* or
  *Follow-ups*) is not retried: it goes to the summary as a decision for the person.

### 4. delta — only when something changed after `20-verify-1.md`

Skip when no `21-*`, `25-*` or `31-*` report exists. Otherwise `plan-verifier`, delta:
`Plan: plans/<stem>.md · branch: <current> · previous report: <latest 2x-verify>.md ·
report to: .devdigest/sdd/<stem>/40-verify-delta.md`. `DIVERGES` → one `implementer` fix
(`41-fix.md`) and one more delta (`report to: …/42-verify-delta-2.md`); still `DIVERGES`
→ stop, summary.

### 5. docs — only with `--docs`

`doc-writer`: `Feature: <Plan ID> · plan: plans/<stem>.md · report:
.devdigest/sdd/<stem>/10-build.md (or 12-build-integration.md)` → save `50-docs.md`.

### 6. insights

Run `/engineering-insights` yourself, in this session. Its material is what the agents
reported and would otherwise be lost: every *Deviations from plan* entry in the `1x`/`2x`/`3x`
reports, *Plan claims the tree contradicts* in the verify reports, *Could not establish* in
the arch reports, the test-writer's *Production code I did NOT change*. If nothing clears
the skill's bar, write nothing and say so in the summary.

### 7. gate

Run `/pr-self-review`. Save its markdown summary → `70-gate-1.md`.

- `PASS` → phase 8.
- `BLOCK` → **one** fix iteration: CRITICAL finding ids from
  `.devdigest/pr-self-review/report.json`; `implementer`: `Plan: plans/<stem>.md · Plan
  ID: <id> · fix loop · report: .devdigest/pr-self-review/report.json · items: <ids>` →
  save `71-gate-fix.md`; run `/pr-self-review` again → `72-gate-2.md`. Still `BLOCK` →
  stop, summary. A CRITICAL that is a deliberate decision (a `do-not-touch` waiver) is not
  fixed: propose the waiver entry in the summary and let the person paste it.

### 8. summary

Write `.devdigest/sdd/<stem>/summary.md`:

```
# /run-plan: <Plan ID>

**Result:** DONE | STOPPED at <phase> — <why>
**Mode:** single-agent | multi-agent (N tracks)  ·  **Reports:** .devdigest/sdd/<stem>/

| Phase | Report | Verdict | Iterations |
|---|---|---|---|
| build | 10-build.md | DONE | — |
| verify | 22-verify-2.md | CONFORMS | 1 fix |
| arch | 30-arch-2.md | CLEAN | 1 fix |
| delta | 40-verify-delta.md | CONFORMS | — |
| gate | 70-gate-1.md | PASS | — |

## For the person
- <NOT VERIFIABLE rows, one line each — needs Docker / a running stack / a judgement>
- <arch SUGGESTIONs by number>
- <follow-ups the implementer left>
- <a waiver to paste, if any>

## Next
- `gh pr create --body-file .devdigest/pr-self-review/pr-body.md` — when you say so.
```

Show the person the summary table and the *For the person* list, then at most three
sentences. Do not restate the reports.

## Resume

Without `--from`, the highest-numbered report in `.devdigest/sdd/<stem>/` decides where
to start: a `1x` report → verify; a `2x` → arch; a `3x` → delta; `40`–`42` → docs/gate;
`70`+ → the gate again. Whatever exists is not re-run. `--from <phase>` overrides that and
re-runs from the phase named, keeping the earlier reports. A plan whose `## Tracks` or
`## Steps` changed since the last report (`git log -1 --format=%ci plans/<stem>.md` newer
than the report) restarts from `build` regardless.

## What this command is not

- Not the spec or the plan: `spec-creator` and `implementation-planner` run by hand,
  before, with a person's approval between them.
- Not a reviewer: it relays verdicts; it never grades code itself.
- Not the gate: `/pr-self-review` decides PASS/BLOCK; this command only runs it.
- Not a PR: it ends with a `PASS` and a summary.
