# Retro: spec → plan → /run-plan → gate — 2026-10-11-export-to-ci

**Date:** 2026-10-13 (run 2026-10-11) · **Branch:** emdash/export-to-ci-jnhpq · **Sessions:** bfd13dc8 · **Mode:** deep (the session was compacted, so the in-context `Agent` results were gone)
**Workflow:** spec-creator → implementation-planner → /run-plan (multi-agent, 2 tracks) → /pr-self-review · **Result:** DONE (gate PASS, 1 CRITICAL waived, nothing committed) · **Facilitator:** claude-opus-5-5

## Numbers
| Metric | Value | Source |
|---|---|---|
| Agents spawned (top-level / nested) | 15 / 1 (researcher under spec-creator) | script, *Agents* |
| Implementer instances (person's cap: 5) | 5 (step 0, A, B, integration, gate fix) | script rows 4–7, 13 |
| Fix-loop iterations (verify / arch / gate) | 0 / 0 / 1 | summary.md |
| Rounds with the person | 19 | script, *Sessions* |
| Wall clock: first agent → last agent | 09:58 → ~12:34 (≈2h36m). Session wall clock: 52.6 h, including idle time | script |
| Session tokens: output / cache read / cache create | main session: 84,439 / 24,118,475 / not split<br>all calls: opus 171,898 + sonnet 70,870 output · 53.5 M cache read · 3.04 M cache write | script, per-model rows |
| Session cost: harness cost-state | not measured (no cost-state line in this transcript) | script |
| Session cost: estimated at list price | $29.15 (main $9.44 + agents $19.71). On a subscription this is the equivalent API spend, not a bill | script |
| Most expensive agent | implementation-planner, $6.36. Next: spec-creator, $4.56 | script, `est. cost` |
| Diff size | 107 files · ~21,255 lines, including the embedded runner | 72-gate-2.md header |
| Lines added / removed per agent | not measured (the script's +/- column is empty) | script |

## Agent timeline
| # | agent | parent | model | started | duration | gap before | API calls | output | final ctx | tools | +/- | errors | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | spec-creator | main | opus | 09:58 | 47m | — | 45 | 13,089 | 181,995 | 73 | — | 0 | spec written |
| 2 | researcher | spec-creator | sonnet | 10:05 | 2m | — | 5 | 49 | 29,110 | 18 | — | 0 | 14 K-char external report |
| 3 | implementation-planner | main | opus | 10:44 | 46m | 46m (the person reviews the spec, sets approved) | 67 | 72,326 | 273,795 | 68 | — | 0 | plan (785 lines, 79 KB) + Q1–Q5 |
| 4 | implementer step 0 | main | sonnet | 11:32 | 3m | 48m (the person answers Q1–Q5; dist / .gitattributes discussion) | 14 | 6,125 | 97,801 | 29 | — | 2 | DONE |
| 5 | implementer track A (bg) | main | sonnet | 11:35 | 9m | 3m | 43 | 28,516 | 169,241 | 52 | — | 3 | DONE |
| 6 | implementer track B (bg) | main | sonnet | 11:35 | 8m | 0s | 31 | 613 | 152,216 | 57 | — | 2 | DONE |
| 7 | implementer integration | main | sonnet | 11:44 | 2m | 9m | 8 | 552 | 59,101 | 8 | — | 0 | DONE, no edits |
| 8 | plan-verifier | main | sonnet | 11:47 | 5m | 3m | 22 | 34,837 | 176,560 | 27 | — | 0 | PARTIAL (164/4/0/11) |
| 9 | architecture-reviewer | main | sonnet | 11:52 | 52s | 5m | 6 | 60 | 70,008 | 12 | — | 0 | CLEAN |
| 10–12 | gate reviewers ×3 (frontend, frontend-tests, backend) | main | opus | 11:57 | 46s–2m | 5m | 26 | 858 | 79–129 K | 33 | — | 0 | gate 1: BLOCK (1 static CRITICAL) |
| 13 | implementer gate fix | main | sonnet | 12:28 | 4m | 30m (the person decides the waiver and says "fix the rest") | 18 | 118 | 85,006 | 19 | — | 1 | 16 of 17 items done |
| 14–16 | gate re-reviewers ×3 | main | opus | 12:33 | 47s–72s | 5m | 18 | 1,186 | 68–100 K | 25 | — | 1 | gate 2: PASS |

## Per agent

### spec-creator: Spec for Export to CI
- **Input:** a 7,715-char prompt that pasted the person's request, plus PNG designs. It fanned out one researcher.
- **Hard:** it read `specs/2026-10-11-export-to-ci.md` 14 times and ran `scripts/spec-lint.mjs` 10 times (*Files one reader opened more than once*), so it kept going back to the lint. It took 47 min and 45 calls.
- **Easy:** the researcher came back in 2 min with 14 K chars of GitHub API facts. The spec never needed a second external pass.
- **Duplicated:** it read `agent-runner/src/index.ts`, `agent-runner/package.json` and `agent-runner/insights/INSIGHTS.md`. The main session and the planner read the same three files.
- **Missed:** the decision about committing `agent-runner/dist` was settled later, in chat. The person said "why put dist in the PR… 37k". The spec left open where the runner bundle comes from.
- **Report:** a 460-char path-only hand-back. That was enough.

### researcher: GitHub Actions/API facts
- **Input:** a 3,080-char prompt.
- **Hard:** nothing found. It made 15 WebFetch calls in 2 min.
- **Easy:** the whole task finished in one pass.
- **Duplicated:** nothing found.
- **Missed:** nothing found.
- **Report:** 14,313 chars inline. It went to spec-creator, not to a file, so later stages could not cite it.

### implementation-planner: Plan Export to CI
- **Input:** a 3,170-char prompt plus the spec path.
- **Hard:** it was the most expensive agent: $6.36, 72 K output, 274 K final context. It read the root `INSIGHTS.md` 6 times and `eslint.config.mjs` 4 times.
- **Easy:** the plan needed no fix loop. Verify had 0 NOT MET (20-verify-1.md).
- **Duplicated:** it re-read the three agent-runner files that spec-creator had read (script, *Files read by two or more readers*).
- **Missed:** two places.
  - Step 6 named the key `wizard.install` both as a button label and as a parent object (20-verify-1.md:240; 11-build-track-B.md, Deviations).
  - Its test plan had no boundary inputs for the 64 KiB artifact cap or the 200-char title (20-verify-1.md rows 77, 126, 151, 152 PARTIAL). The 2026-10-01 proposal #1 added boundary inputs for filters and caps. This time it covered the workflow cap but not the adapter cap.
- **Report:** a 684-char path hand-back, plus Q1–Q5, which the person answered in the 48-min gap.

### implementer ×5: step 0, track A, track B, integration, gate fix
- **Input:** each got a path-only prompt of 104–133 chars. The gate fix is the exception: 2,893 chars, because the orchestrator listed the items inline.
- **Hard:**
  - Step 0 dropped a regex backslash and had to fix it (10-build-step0.md, Deviations).
  - Track B ran `scripts/verify.mjs` 12 times.
  - The gate fix was the only implementer that had to undo its own tooling: it reverted a prettier rewrite (71-gate-fix.md, Deviations).
- **Easy:**
  - Integration finished in 2 min with no edits (12-build-integration.md).
  - Docker was available. Track A ran its own `--it` file, and integration ran the full `--it` lane (11-build-track-A.md:41; 12-build-integration.md:26).
- **Duplicated:** `plans/2026-10-11-export-to-ci.md` (79 KB) was read by all 5 implementers.
- **Missed:**
  - Track B put three components in one `steps.tsx`, used a barrel plus a deep import in `CiTab.tsx:14`, kept filters in `useState`, and hardcoded English in `relativeTime`. That is 17 gate items in total (71-gate-fix.md rows 1–17).
  - The gate fix then created `useRelativeTime.ts` (row 5) saved as Windows-1252, which the second gate flagged (findings-frontend.json, line 9).
- **Report:** 3–7 K chars each, with deviations and follow-ups. Integration repeated the plan's follow-ups in its own report (12-build-integration.md, Follow-ups).

### plan-verifier: Verify build against plan
- **Input:** a 141-char prompt. It wrote `20-verify-1.md` itself, as the 2026-10-01 proposal #2 intended.
- **Hard:** 9 of its 11 NOT VERIFIABLE rows were *Skill contract* rows (rows 80–88, "skill loading leaves no trace in the tree"). Yet the implementer hand-backs list the skills each one loaded (script, *Hand-back reports*, column "skills loaded").
- **Easy:** 164 MET rows in 5 min.
- **Duplicated:** the 35 K-char ledger re-lists every plan item.
- **Missed:** nothing the gate later caught was in its scope. The gate's 17 items were rules from the code skills, not plan items.
- **Report:** a 4,340-char hand-back with the file on disk. The orchestrator only grepped the verdict lines.

### architecture-reviewer: Architecture review of build
- **Input:** a 42-char scope.
- **Hard:** nothing found. It ran 52 s, 6 calls, 4 files read.
- **Easy:** CLEAN on the first pass.
- **Duplicated:** it read `server/src/db/schema/ci.ts` and `adapters.ts`, which the verifier had also read.
- **Missed:**
  - Gate 1 then filed client placement findings that are its job (`frontend-ui-architecture` is in its `skills:`; `.claude/agents/architecture-reviewer.md:14`): a barrel plus a deep import in `CiTab.tsx:14`, and three components in `steps.tsx` (71-gate-fix.md rows 12 and 15).
  - Its *Could not establish* says it ran only the server checks (30-arch-1.md:47). Its body runs `verify.mjs server --checks` only (`architecture-reviewer.md:29,102`), so this is a chain-design gap rather than an agent failure.
- **Report:** 7,105 chars. Most of it is *Could not establish*, which no later stage acted on.

### general-purpose ×6: gate reviewers, gate 1 and gate 2
- **Input:** 1,051–2,570 chars each, with the finding contract inline. They ran on opus while every implementer ran on sonnet.
- **Hard:** the summary records that a gate subagent left stray root files (`` ` ``, `f.name`). The main session read `pr-self-review-gate.mjs` 9 times while it ran the gate by hand.
- **Easy:** gate 2 reused the cache: backend reviewed 3 of 18 files, frontend-tests 3 of 5 (72-gate-2.md).
- **Duplicated:** `.claude/skills/pr-self-review/report.md` and `routing.md` were each read by 6–8 readers.
- **Missed:**
  - Both gates kept the test-naming false positive on `ci.it.test.ts` (71-gate-fix.md, item 10). It is the same heuristic as the pr-brief retro's proposal #3.
  - The Windows-1252 file got through gate 1, because it did not exist yet.
- **Report:** JSON arrays of 0.8–6.3 K chars. That fits the contract.

## Cross-cutting findings
- **The gate did the code review that the arch stage skipped.** Gate 1 was BLOCK on only one static CRITICAL, the waived `agent-runner/CLAUDE.md`. On the person's word it carried 17 WARNING/SUGGESTION items into the single fix iteration (71-gate-fix.md rows 1–17). Five of those were client placement or component-shape items, which arch never looked at because it ran server-only (30-arch-1.md:47). The fix costs an extra gate pair: 6 opus reviewers, about $3.5 together (script rows 10–16).
- **A fix loop introduced a new defect.** A file the gate fix created (row 5) came out as Windows-1252. No verify step checks encoding, and no one re-ran verify after the gate fix.
- **The person's wait was the critical path.** 46 + 48 + 30 min of gaps against ≈ 37 min of agent build-to-gate time (script, *gap before*). Each gap was a decision only the person could make: spec approval, Q1–Q5, the waiver.
- **The orchestrator did out-of-scope work.** It built `agent-runner/dist` unasked and was stopped ("why are you doing this now?"). It then had to learn that agent-runner is shared and that `dist` is never committed. Both are now in memory, not in the chain.
- **The implementer cap worked as a constraint.** Exactly 5 instances ran. Reviewers and verifiers sat outside the cap.
- **The 79 KB plan was read by 8 readers (13 reads).** It is the biggest shared input, and the planner was the most expensive agent.

## Proposals
| # | Target | Change | Evidence | Expected effect | Cost | Status |
|---|---|---|---|---|---|---|
| 1 | `.claude/agents/architecture-reviewer.md` | When the scope touches `client/`, also run `node scripts/verify.mjs client --checks` and walk the frontend-ui-architecture placement checklist on each new component folder. | 30-arch-1.md:47; 71-gate-fix.md rows 12, 15 | Placement findings land in the arch loop, where sonnet implementers fix them, not in the opus gate pair | ~1–2 min per run; more files read | open |
| 2 | `.claude/agents/plan-verifier.md` | Settle *Skill contract* rows from the implementer reports' "skills loaded" lines instead of marking them NOT VERIFIABLE. | 20-verify-1.md rows 80–88 (9 of 11 NV); script *Hand-back reports* "skills loaded" | NOT VERIFIABLE drops to the rows that really need a person | Reads 3–5 short reports | open |
| 3 | `.claude/skills/run-plan/SKILL.md` (phase 7) | After a gate fix that creates files, run `verify.mjs <pkg> --checks` plus a UTF-8/LF check on the new files before the second gate. | 71-gate-fix.md row 5 → findings-frontend.json (Windows-1252 `useRelativeTime.ts`) | Catches defects the fix itself introduced before the gate re-runs | One command | open |
| 4 | `.claude/agents/implementer.md` | Write every file as UTF-8 with LF. On Windows, check with `file <path>` after a write. | findings-frontend.json (two files, Windows-1252 + CRLF) | No encoding warnings at the gate | One rule line | open |
| 5 | `.claude/skills/run-plan/SKILL.md` (phase 7) | Write down the person's option to carry WARNINGs into the single gate-fix iteration, and pass the items as finding ids, not an inline list. | 71-gate-fix.md (17 items, 2,893-char prompt vs ≤141 elsewhere) | A repeatable gate fix with a path-only prompt | Two lines | open |
| 6 | `.claude/agents/spec-creator.md` | When the feature ships a build artifact into another repo, the spec states where the artifact is built and what is committed where. | the person's "why put dist in the PR… 37k"; the 48-min gap before build | One fewer late design round with the person | One checklist line | open |

## Earlier proposals
| Entry | # | Target | Status now | Note |
|---|---|---|---|---|
| 2026-10-02-pr-brief | 1 | `run-plan/SKILL.md` Docker at intake | open | Target unchanged since 9780a1f (2026-10-01). Not needed this run: Docker was up (12-build-integration.md:26) |
| 2026-10-02-pr-brief | 2 | `plan-verifier.md` code/plan closer | open | Target unchanged. 20-verify-1.md:240 has a plan-text row again |
| 2026-10-02-pr-brief | 3 | gate test-naming regex (`startPg`) | open | Target unchanged (289f8bb). Happened again: `ci.it.test.ts` false positive (71-gate-fix.md item 10). Open in 2 retros |
| 2026-10-02-pr-brief | 4 | `pr-self-review/SKILL.md` run on the committed tree | open | Target unchanged (d49a6c7). This run hit related trouble: scratch and stray files changed the tree fingerprint (session notes) |
| 2026-10-02-pr-brief | 5 | `spec-writing/SKILL.md` layout NFR ≠ component | open | No "layout" rule in the file. Not exercised this run |
| 2026-10-02-pr-brief | 6 | `plan-verifier.md` short delta reports | open | No delta pass this run, so no new evidence |
| 2026-10-02-pr-brief | 7 | `retro-usage.mjs` executions ≠ reads | open | Target unchanged. Happened again: `scripts/verify.mjs` shows 32 "reads" by 8 readers |

## Impressions
- Track B's output figure of 613 tokens for 23 written files looks wrong. The per-agent output accounting may not count all of `Write` content, so I would not compare output across agents.
- Putting the gate reviewers on opus while the implementers ran on sonnet looks backwards for cost. The gate findings were good, but most of them were rule lookups.

## Not measured
- Harness cost-state: the transcript has no cost-state line (`--deep` ran).
- Lines added or removed per agent: the script's +/- column is empty.
- Main-session cache-create split: only the per-model totals are available.
- The time the person spent outside the gaps (reading reports between turns).
