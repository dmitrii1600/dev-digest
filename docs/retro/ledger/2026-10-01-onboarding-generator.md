# Retro: spec → plan → hand-driven build chain — 2026-10-01-onboarding-generator

**Date:** 2026-10-01 · **Branch:** feat/lab5-hw5 · **Sessions:** caadeda7 · **Mode:** deep (`node scripts/retro-usage.mjs --stem 2026-10-01-onboarding-generator`)
**Workflow:** spec-creator → implementation-planner → implementer (step 0 → A ∥ B → Integration) → plan-verifier ↺ → (architecture-reviewer ∥ test-writer) → implementer fix → plan-verifier delta → /engineering-insights → doc-writer. The person drove each stage by hand, **not** via `/run-plan`, with one commit per stage (`ecdff92` … `fb83008`).
**Result:** STOPPED before the gate, at the person's choice (`/pr-self-review` not run yet; last verify PARTIAL, 0 NOT MET) · **Facilitator:** claude-opus-5-5

## Numbers
| Metric | Value | Source |
|---|---|---|
| Agents spawned (top-level / nested) | 14 / 0. spec-creator was resumed 4× and implementation-planner 1× via SendMessage, and those count inside their rows. | script *Agents* |
| Fix-loop iterations (verify / arch / gate) | 1 / 1 / 0. The arch fix also carried test-writer's AC-6 bug. The gate did not run. | 21-fix-1.md, 31-arch-fix-1.md |
| Rounds with the person | 27 prompts, of which 7 were `AskUserQuestion` calls (one was dismissed) | script *Sessions* · chat |
| Wall clock (first prompt → last agent) | 2.6 h | script *Sessions* |
| Session tokens — output / cache read / cache create | main 89,229 / 23,720,149 / not split; all calls: opus 168,374 / 38,507,923 / 1,320,486, and sonnet 75,951 / 22,838,287 / 1,319,567 | script *Tokens per model* |
| Session cost — harness cost-state | not measured (no cost-state line in this transcript) | script |
| Session cost — estimated at list price (main + agents) | $27.04 = main $8.50 + agents $18.54. This is the equivalent API spend on a subscription plan, not a bill. | script |
| Most expensive agent | implementation-planner $6.29 (13 min, 64 API calls) | script row 2 |
| Lines added / removed | +6,150 / −116 over 77 files (`git diff --shortstat 4f798ee..HEAD`); code only +3,083 / −101 | git |

## Agent timeline
| # | agent | parent | model | started | duration | gap before | API calls | output | final ctx | tools | +/- | errors | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | spec-creator | main | opus | 12:35 | 6m | — | 42 | 7,179 | 141,157 | 64 | +246/-2 | 0 | spec, then 2 resumes for answers, then a superseding spec on A1 |
| 2 | implementation-planner | main | opus | 12:57 | 13m | 16m (person: 15 Q + approval) | 64 | 71,966 | 265,301 | 70 | +682/-0 | 0 | plan, 4 contradictions with the tree (A1–A4) |
| 3 | implementer step 0 | main | sonnet | 13:34 | 75s | 24m (person: A1–A4, spec amendment, commit) | 8 | 1,384 | 69,009 | 12 | +20/-5 | 0 | DONE, 1 deviation (Provider TDZ) |
| 4 | implementer track A | main (bg) | sonnet | 13:35 | 7m | 10s | 35 | 13,231 | — | 62 | — | 0 | DONE, 5 deviations |
| 5 | implementer track B | main (bg) | sonnet | 13:35 | 7m | 0s | 33 | 18,389 | — | 50 | — | 1 | DONE, 4 deviations |
| 6 | implementer Integration | main | sonnet | 13:43 | 9m | 7m (orchestrator: waiting for A) | 16 | 1,932 | 83,377 | 19 | +18/-2 | 0 | PARTIAL (reviews.it red) |
| — | orchestrator baseline proof | main | opus | ~13:52 | ~20m | — | — | — | — | — | — | — | clean-HEAD worktree: reviews.it FAIL/PASS/FAIL, a pre-existing flake |
| 7 | plan-verifier pass 1 | main | sonnet | 14:20 | 7m | 27m (person: commit, timeout questions) | 28 | 920 | 178,567 | 36 | 0 | 0 | DIVERGES, 3 NOT MET |
| 8 | implementer fix 1 | main | sonnet | 14:27 | 33s | 22s | 7 | 713 | 54,841 | 7 | 0* | 0 | DONE (title string) |
| 9 | plan-verifier delta | main | sonnet | 14:28 | 29s | 9s | 4 | 199 | 33,630 | 6 | 0 | 0 | PARTIAL, 0 NOT MET |
| 10 | architecture-reviewer | main (bg) | sonnet | 14:30 | 2m | 2m | 16 | 1,301 | — | 23 | — | 0 | CONCERNS, 3 SUGGESTION |
| 11 | test-writer | main (bg) | sonnet | 14:30 | 7m | -2s | 30 | 17,096 | — | 41 | — | 0 | DONE, found the AC-6 bug |
| 12 | implementer fix (bug + arch 1, 2) | main | sonnet | 14:40 | 3m | 10m (person: which fixes) | 19 | 7,684 | 108,339 | 35 | +135/-11 | 1 | DONE, 1 gap (OpenRouter non-JSON) |
| 13 | plan-verifier delta | main | sonnet | 14:47 | 3m | 4m | 13 | 940 | 90,489 | 17 | 0 | 0 | PARTIAL, 0 NOT MET, 1 new PARTIAL |
| 14 | doc-writer | main | sonnet | 15:00 | 3m | 9m (person + /engineering-insights) | 24 | 12,162 | 112,843 | 43 | +304/-28 | 0 | DONE, 3 drift fixes |

\* The script counts 0 lines for #8, but the commit `4c84b10` changed 3 lines in 3 files (Bash-side edits are not counted).

## Per agent

### spec-creator — spec, answers, A1 amendment
- **Input:** a path set plus a 3,560-char prompt with a file list to research (script row 1). It found the rest in the tree ("Research: none").
- **Hard:** 11 re-reads of its own spec (script *opened more than once*). spec-lint was read 8×.
- **Easy:** 6 PNGs read in one pass, 7 design gaps, and the first lint was OK. Resumes for Q-answers took 57 s and 79 s (tool results).
- **Duplicated:** nothing found beyond shared inputs.
- **Missed:** AC-16 required paths to be "present in the index", but the index holds only `.ts/.js` (`server/src/modules/repo-intel/pipeline/walk.ts:7`). The planner caught it (Plan Report "Where the spec, the tree and INSIGHTS disagree", A1), and the spec had to be amended after approval.
- **Report:** 7,990 chars, with numbered open questions plus a recommendation each. They became `AskUserQuestion` options with no rework. Writing a superseding spec on A1 followed its *Never* rule (`.claude/agents/spec-creator.md:46`). That is a chain-design finding (see below), not an agent miss.

### implementation-planner — plan
- **Input:** an 889-char prompt with paths only.
- **Hard:** the longest and most expensive agent: 13 min, $6.29, final ctx 265 k. A plan of 681 lines and 47 ledger rows.
- **Easy:** nothing found.
- **Duplicated:** re-read the spec's research targets (knowledge.ts, repo-intel, feature-models), which spec-creator had already read (script *Files read by two or more*). That is by design, since it checks the spec against the tree.
- **Missed:** step 6 said "exact AC-2 titles" but did not inline them. The implementer wrote "Suggested reading path" (20-verify-1.md rows 59/149/182). D4 left OpenRouter's 90 s SDK timeout and 2 transport retries as a follow-up. That made the 120 s spec number unreachable for the default provider, and the person hit it at runtime (chat, "120 секунд не вистачило").
- **Report:** 5,295 chars. The four contradictions (A1–A4) were exactly what the person needed to decide; 3 of 4 took the default.

### implementer — step 0, A, B, Integration, 2 fix loops
- **Input:** a plan path plus a track; 139–338 chars for the build prompts.
- **Hard:** track B had 1 tool error and needed a typecheck fix (3 `noUncheckedIndexedAccess`). Integration took 9 min, most of it e2e plus a `--it` run with a red flake. `e2e.sh` failed 0/15 until `AGENT_BROWSER_BIN`, which `e2e/INSIGHTS.md:115` already documented.
- **Easy:** step 0 ran in 75 s. Fix 1 took 33 s.
- **Duplicated:** `scripts/verify.mjs` was read 10× by track A and 8× by track B (script *opened more than once*).
- **Missed:** the AC-2 title (verifier pass 1). It also missed the root-level junk-dir bug behind AC-6, which test-writer found (25-tests.md *Production code I did NOT change*). The bug is in pre-existing code (`587c46a`) that the plan did not ask it to read.
- **Report:** 3–7.5 k chars each. *Deviations* were complete; the verifier turned each one into a PARTIAL row rather than a new finding (20-verify-1.md rows 2, 68, 87).

### plan-verifier — pass 1, 2 deltas
- **Input:** plan path plus previous-report path. The deltas took 29 s and 3 min.
- **Hard:** pass 1 was 194 rows and 36,508 chars, the largest hand-back. Rows 120–126 (skill loading) and 94/135/148/186 (e2e) were NOT VERIFIABLE in every pass by design. It may not run `./scripts/e2e.sh` (`.claude/agents/plan-verifier.md:34`).
- **Easy:** the deltas re-checked only changed rows.
- **Duplicated:** the third pass reports "20-verify-1.md and 22-verify-2.md keep only the non-MET rows" (40-verify-delta). The orchestrator had condensed the saved reports, so the delta could not carry MET rows by number.
- **Missed:** AC-6 was marked MET on pass 1 (row 153) while root-level `test/` still leaked. It checked the sort and the test for `foo.test.ts`, not the junk predicate's boundaries.
- **Report:** good shape (verdict line, then detail, then *Not my job*), but pass 1 was 7× the length of the delta.

### architecture-reviewer
- **Input:** a 542-char scope.
- **Hard:** nothing found. It finished in 2 min.
- **Easy:** CONCERNS with 3 SUGGESTION, each with path:line and a smallest fix. Two were adopted.
- **Duplicated:** nothing found.
- **Missed:** nothing found within its remit. The AC-6 bug is behaviour, not boundaries.
- **Report:** the script shows 0 chars for this row. The hand-back came as a message, and the script does not capture async agents' reports (see cross-cutting).

### test-writer
- **Input:** a 731-char prompt with surface plus spec criteria.
- **Hard:** nothing found.
- **Easy:** 5 new files plus 3 edits, green on the first full run.
- **Duplicated:** nothing found.
- **Missed:** nothing found.
- **Report:** it found the one real behaviour bug of the run, and found it by constructing boundary inputs (root-level paths). That is the evidence for proposal 1.

### doc-writer
- **Input:** a 1,553-char prompt that named what to document plus known limitations.
- **Hard:** nothing found.
- **Easy:** 3 drift fixes in `repo-intel/README.md` on the way.
- **Duplicated:** re-read service files the arch reviewer read (shared input, by design).
- **Missed:** no root `AGENTS.md` pointer. It deliberately left that out because of unrelated uncommitted edits (its report).
- **Report:** 8,329 chars with a claims → evidence table.

## Cross-cutting findings
- **Only boundary-input tests caught the one real bug.** The AC-6 root-level leak passed the implementer, verifier pass 1 (row 153 MET) and the arch review. test-writer caught it because it wrote negative and boundary cases (25-tests.md).
- **A spec contradiction surfaced after approval and cost an extra spec file plus a round.** The planner found A1 eight minutes after approval. spec-creator then had to supersede (its rule) and wrote `specs/2026-10-01-onboarding-tour.md`, and the person chose an in-place amendment instead (chat).
- **The orchestrator condensed reports and lost rows.** run-plan's "save verbatim" rule (`.claude/skills/run-plan/SKILL.md`, *Hard rules*) was not followed for 20-/22-verify. The delta verifier flagged the gap (40-verify-delta caveat).
- **The orchestrator repeated a recorded dead end.** It ran `pnpm exec` inside a junctioned worktree, against root `INSIGHTS.md:209`, because it skipped reading root INSIGHTS first. No damage this time.
- **e2e was never verified independently.** AC-1 and NFR-10 stayed NOT VERIFIABLE in all three verifier passes; only the implementer's claim covered them (12-build-integration.md).
- **A numeric spec bound that a lower layer silently overrides went unflagged.** EC-4's 120 s was unreachable via OpenRouter's 90 s SDK timeout (`reviewer-core/src/llm/openrouter.ts:54-55`). No agent ran a real generation: e2e never clicks Generate, and every test uses mocks.
- **`scripts/verify.mjs` is the most-read file.** 13 readers, 53 reads (script). Agents re-read it to learn flags.
- **retro-usage gaps.** Background agents (#4, 5, 10, 11) show 0 report chars and no final ctx. The marker counter counts "NOT MET" inside "Was NOT MET" columns: row 9 shows NOT MET ×3 for a 0-NOT-MET verdict.

## Proposals
| # | Target | Change | Evidence | Expected effect | Cost | Status |
|---|---|---|---|---|---|---|
| 1 | `.claude/agents/implementation-planner.md` | For every filter, exclusion or cap criterion, the Test plan names at least one boundary input (root-level path, case variant, near-miss negative) and the step that owns it. | AC-6 leak found only by test-writer (25-tests.md); verifier row 153 MET | Catches predicate bugs in the build, not after review | ~5 lines in the planner body; slightly longer Test plans | adopted (2026-10-01, same day) |
| 2 | `.claude/agents/plan-verifier.md` (+ `run-plan` save step) | The verifier writes its own report to `.devdigest/sdd/<stem>/NN-verify-*.md` (the trade the planner already made) instead of relying on the orchestrator to save it verbatim. | 40-verify-delta caveat: earlier reports kept only non-MET rows | Deltas can carry every row by number; no orchestrator condensation | Gives a read-only agent `Write` scoped to `.devdigest/sdd/` | adopted (2026-10-01, same day) |
| 3 | `.claude/agents/implementation-planner.md` | A spec number (timeout, cap, size) that a lower layer can override (SDK default, provider client, DB limit) must be checked down the stack. Either a step fixes it, or it is raised as a blocking question, never a follow-up. | D4 follow-up, then the person hit the 90 s cut at runtime (chat) | No shipped bound that cannot fire | One checklist line; a few more reads per plan | adopted (2026-10-01, same day) |
| 4 | `.claude/skills/spec-writing/SKILL.md` + `.claude/agents/spec-creator.md` | Allow an in-place amendment of an `approved` spec while no commit implements its plan, with a dated amendment line. Supersede only after build has started. | `onboarding-tour.md` written, then deleted; an extra person round (chat) | One fewer file and round per late contradiction | Lifecycle rule text; spec-creator must check `git log` for the plan stem | adopted (2026-10-01, same day) |
| 5 | `.claude/agents/implementation-planner.md` | Inline the literal user-visible strings an AC fixes (section titles, button labels) into the step that writes the copy, instead of "the exact AC-n titles". | 20-verify-1.md rows 59/149/182 (one wrong title, 3 NOT MET, 1 fix loop) | Removes a cheap class of NOT MET | A few lines per plan | adopted (2026-10-01, same day) |
| 6 | `scripts/retro-usage.mjs` | Capture hand-back text for background agents (SubagentHandback messages), and count markers only in verdict or detail lines, not in "Was" columns. | Rows 4, 5, 10, 11 show 0 report chars; row 9 shows NOT MET ×3 at 0 NOT MET | Accurate retro numbers | Script change, no agent cost | adopted (2026-10-01, same day) |
| 7 | `AGENTS.md` (Commands) or a preloaded skill | Add a 4-line `verify.mjs` flag table (`--checks`, `--tests`, `--file`, `--it`, the cache) so agents stop opening the script. | verify.mjs: 13 readers, 53 reads (script) | Fewer reads per agent | 4 lines in an always-loaded file | adopted (2026-10-01, same day) |

## Earlier proposals
| Entry | # | Target | Status now | Note |
|---|---|---|---|---|
| — | — | — | — | First ledger entry; nothing earlier to re-check. |

## Impressions
- Driving each stage by hand with a commit per stage made the person's review points explicit. It also put ~1.2 h of gaps between agents (gap column), most of it the person deciding. That is the price of the control, not waste.
- Sonnet on verifier and reviewer gave usable, well-cited verdicts at ~$0.1–1.1 per pass. Nothing here argues for moving them back to opus.

## Not measured
- The person's review time vs the orchestrator's time inside each gap: the script does not split them, and the labels in *gap before* are from chat order.
- Cost of the orchestrator's own baseline-proof runs (bash, ~20 min): part of main's $8.50, not separable.
- Harness cost-state: absent from this transcript.
- Whether the `/pr-self-review` gate would pass: not run in this workflow.

## Adoption note (2026-10-01, same day, at the person's request)
All seven proposals were applied right after this retro:
- **Proposals 1, 3, 5:** `.claude/agents/implementation-planner.md` (§4 boundary inputs and literal copy; *Constraints*: a spec bound must hold down the stack).
- **Proposal 2:** `.claude/agents/plan-verifier.md` (`Write` for its own `report to:` file only), `.claude/skills/run-plan/SKILL.md` (verifier prompts carry `report to:`; never condense a saved report), `.claude/agents/README.md` (tools table and the read-only trade).
- **Proposal 4:** `.claude/skills/spec-writing/SKILL.md` *Lifecycle → Before building starts* and `.claude/agents/spec-creator.md`.
- **Proposal 6:** `scripts/retro-usage.mjs` (hand-back from `SubagentHandback` for background agents, final ctx from the last call, marker counts from the `**Items:**` header).
- **Proposal 7:** the `verify.mjs` flag table in `AGENTS.md`.
- **Added beyond proposal 1:** `plan-verifier` marks a filter, exclusion or cap criterion MET only with boundary-case evidence; otherwise it is PARTIAL.

The next retro should check whether these changed agent behaviour, not only whether the files changed.
