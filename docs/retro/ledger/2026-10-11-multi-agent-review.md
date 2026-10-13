# Retro: spec → plan → /run-plan → gate — 2026-10-11-multi-agent-review

**Date:** 2026-10-13 · **Branch:** emdash/multi-agent-review-az60w · **Sessions:** e23cac2e · **Mode:** deep
**Workflow:** spec-creator → implementation-planner → /run-plan plans/2026-10-11-multi-agent-review.md (multi-agent, 3 tracks) → /pr-self-review ×3 · **Result:** DONE (gate PASS with one user-authorised waiver, uncommitted) · **Facilitator:** claude-opus-5-5

Deep mode was needed even though the run happened in this session. The session was compacted after the gate, so the `Agent` tool results now exist only as a summary, and every figure below comes from `scripts/retro-usage.mjs`.

## Numbers
| Metric | Value | Source |
|---|---|---|
| Agents spawned (top-level / nested) | 13 / 0 | script, *Agents, in spawn order* |
| Fix-loop iterations (verify / arch / gate) | 0 / 0 / 1 | `20-verify-1.md` PARTIAL with no NOT MET · `30-arch-1.md` 2 SUGGESTIONs only · `71-gate-fix.md` |
| Gate runs | 3: BLOCK (C1 W21 S6) → BLOCK (C1 W16 S5) → PASS (C0, 1 waived) | `.devdigest/pr-self-review/history.jsonl` |
| Rounds with the person | 17 | script, *Sessions* |
| Wall clock (first agent → last agent end) | 10:03 → ~11:58, about 1 h 55 m. The session itself spans 52.7 h, most of it idle | script |
| Session tokens: output / cache read / cache create (main + agents) | 199,832 / 55,425,927 / 2,105,783 | script, per-model transcript rows |
| Session cost: harness cost-state | not measured (no cost-state line in this transcript) | script |
| Session cost: estimated at list price | $24.03 = main $9.23 + agents $14.80 | script (`est. cost`); on a subscription plan this is equivalent API spend, not a bill |
| Most expensive agent | implementation-planner, $4.91 (306,680 final ctx) | script |
| Lines added / removed | not measured: the agent rows carry no `+/-`. The gate reports 144 files and about 16,799 lines vs origin/main, including the base commit's agent-runner | `73-gate-3.md:3` |

## Agent timeline
| # | agent | parent | model | started | duration | gap before | API calls | output | final ctx | tools | +/- | errors | outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | spec-creator (revision 3) | main | opus | 10:03 | 35m | — | 54 | 14,994 | 167,630 | 94 | — | 0 | spec written; 3 hand-backs (resumed twice after the person's answers) |
| 2 | implementation-planner | main | opus | 10:44 | 16m | 41m (person: questions on design, endpoint, simplicity, implementer cap) | 75 | 39,635 | 306,680 | 82 | — | 1 | plan, 3 tracks, ≤3 concurrent |
| 3 | implementer, step 0 | main | sonnet | 11:18 | 3m | 34m (person: spec approval and flags; orchestrator: `pnpm install` / `npm ci`) | 13 | 6,194 | 106,516 | 28 | — | 1 | DONE |
| 4 | implementer, track S (bg) | main | sonnet | 11:21 | 5m | 3m | 21 | 922 | 122,385 | 29 | — | 2 | DONE |
| 5 | implementer, track A (bg) | main | sonnet | 11:21 | 4m | 0 | 26 | 13,392 | 136,711 | 35 | — | 1 | DONE |
| 6 | implementer, track B (bg) | main | sonnet | 11:21 | 5m | 0 | 25 | 22,209 | 137,758 | 43 | — | 1 | DONE |
| 7 | implementer, Integration | main | sonnet | 11:26 | 3m | 5m | 9 | 523 | 67,415 | 9 | — | 0 | PARTIAL (e2e 0/18, ENOENT) |
| — | orchestrator re-runs e2e with `AGENT_BROWSER_BIN` | — | — | — | — | — | — | — | — | — | — | — | 18/18 |
| 8 | plan-verifier | main | sonnet | 11:30 | 7m | 4m | 15 | 21,855 | 162,401 | 18 | — | 0 | PARTIAL (196 rows: 176 MET, 1 PARTIAL, 19 NV) |
| 9 | architecture-reviewer | main | sonnet | 11:36 | 68s | 7m (orchestrator: e2e, insights) | 9 | 371 | 67,312 | 10 | — | 0 | CONCERNS (2 SUGGESTIONs) |
| 10 | general-purpose, gate backend group | main | opus | 11:46 | 62s | 10m (orchestrator: gate scope + checks) | 11 | 818 | 107,656 | 18 | — | 0 | 0C 0W 2S |
| 11 | general-purpose, gate frontend group (bg) | main | opus | 11:47 | 2m | 0 | 15 | 193 | 113,498 | 18 | — | 0 | 0C 5W 2S |
| 12 | general-purpose, gate frontend-tests group (bg) | main | opus | 11:47 | 53s | 0 | 9 | 252 | 96,277 | 10 | — | 0 | 0C 1W 2S |
| — | gate 1 BLOCK, person: "skip the gate error, fix the feature warnings" | — | — | 11:50 | — | — | — | — | — | — | — | — | — |
| 13 | implementer, gate fix loop | main | sonnet | 11:55 | 3m | 5m | 11 | 719 | 63,203 | 13 | — | 1 | DONE |
| — | gate 2 BLOCK (only the agent-runner CRITICAL); person authorises a one-time waiver; gate 3 PASS | — | — | 11:58 → 12:21 | — | — | — | — | — | — | — | — | PASS |

## Per agent

### spec-creator — Write Multi-Agent Review spec
- **Input:** the prompt carried the design folder and the person's requirements. The prompt was 7,041 chars, the largest in the run (script, *Hand-back reports*).
- **Hard:** the spec was read 12 times by spec-creator and `scripts/spec-lint.mjs` 7 times (*Files one reader opened more than once*). The lint count likely includes executions; see earlier proposal pr-brief #7. Three hand-backs, "revision 3", show two resumptions after the person's rounds.
- **Easy:** nothing found.
- **Duplicated:** spec-creator and the planner both read `runs.ts`, `observability.ts`, `platform.ts`, `trace.ts`, `run-executor.ts`, `routes.ts`, `RunHistory.tsx`, `nav.ts`, `service.ts` and all three INSIGHTS files (*Files read by two or more readers*).
- **Missed:** nothing found. No verify row contradicts the spec, and `Plan claims the tree contradicts` is empty (`20-verify-1.md:243`).
- **Report:** 3,498 chars with one open question. Adequate.

### implementation-planner — Plan Multi-Agent Review implementation
- **Input:** a 2,207-char prompt with the spec path and the person's cap of "at most three or five" implementers.
- **Hard:** the most expensive agent of the run: $4.91, 306,680 final ctx, 76 Bash and 4 Read calls, 1 error. It read INSIGHTS.md 4 times and server/INSIGHTS.md 3 times.
- **Easy:** the tracks split cleanly. Three implementers ran 11:21–11:26 in parallel with no file conflicts, and every 1x report says DONE apart from Integration's environment PARTIAL.
- **Duplicated:** it re-read the same tree files spec-creator had just read (see above).
- **Missed:** the Skill-contract section became 9 ledger rows (107–115) that no verifier can check (`20-verify-1.md:119-127`).
- **Report:** 5,443 chars with one open question. Adequate.

### implementer ×6 — step 0, tracks S/A/B, Integration, gate fix
- **Input:** paths only, 116–145 chars, per the run-plan contract. The gate fix prompt was 1,271 chars because it listed finding ids.
- **Hard:**
  - Track B hit a typecheck failure after adding `INFO` to `SEVERITY_RANK` (`11-build-track-B.md:59`).
  - Track A had one failed heredoc (`11-build-track-A.md:52`).
  - Integration could not run e2e: `spawn agent-browser ENOENT` on Windows, 0/18 (`12-build-integration.md:23`).
  - The gate fix used a `"HIGH"` severity in a fixture (`71-gate-fix.md:42`).
- **Easy:** all four build waves finished in 3–5 minutes each, at $0.24–$1.02.
- **Duplicated:** `plans/...md` was read by 6 implementers (expected, a shared input). `scripts/verify.mjs` shows 32 "reads", which are executions (pr-brief #7).
- **Missed:**
  - Item 83, the summary rendered through `<Markdown>`, was the only PARTIAL (`20-verify-1.md:95`).
  - Gate-1 frontend WARNINGs: unhandled start rejection, loading/error states falling through to the empty state, a sibling import, a weak test assertion (`summary.md:21`).
- **Report:**
  - Track S stated the in-memory filter and the missing transaction up front (`11-build-track-S.md:49`), and both came back as SUGGESTIONs from the arch reviewer and the gate. The hand-off worked, but nobody acted on it.
  - Deviations were disclosed in every report.

### plan-verifier — pass 1
- **Input:** path plus a `report to:`. It wrote its own report (39,622 chars).
- **Hard:** nothing found. One pass, 7 minutes.
- **Easy:** a PARTIAL with no NOT MET meant no fix loop was needed.
- **Duplicated:** nothing found beyond reading the shared plan and spec.
- **Missed:** nothing found. It flagged item 83 and routed the markdown question to the gate (`20-verify-1.md:250`).
- **Report:** 19 NOT VERIFIABLE rows:
  - 9 are Skill-contract rows (107–115);
  - 5 are manual or person steps;
  - 3 are e2e.
  The skill rows are noise by construction.

### architecture-reviewer — pass 1
- **Input:** a 42-char prompt.
- **Hard:** nothing found.
- **Easy:** 68 s, $0.26, verdict CONCERNS with 2 SUGGESTIONs and no fix loop.
- **Duplicated:** finding #2 (filter by `multi_run_id` in memory) was already in `11-build-track-S.md:49` and was re-found by the gate backend agent.
- **Missed:** nothing found. It left client checks under "Could not establish" (`30-arch-1.md:68`), and the gate covered them.
- **Report:** 7,383 chars; it reviewed the base-commit agent-runner as well, which is outside worktree A.

### general-purpose ×3 — /pr-self-review group reviews
- **Input:** prompts of 1,288–1,680 chars carrying the group, skills and contract, per the skill.
- **Hard:** nothing found.
- **Easy:** each finished in 53 s – 2 m.
- **Duplicated:** the backend agent re-found the in-memory filter and the missing transaction (`summary.md:23`).
- **Missed:** nothing found. The 5 frontend WARNINGs were real and fixed in `71-gate-fix.md`.
- **Report:** 110–419 chars plus a findings JSON. Right-sized.

## Cross-cutting findings
- **Inherited CRITICAL.** The only CRITICAL in all three gate runs was `static:claude-md-stub:agent-runner/CLAUDE.md:1`, from base commit 6739e6d, outside the worktree's scope (`summary.md:18`; `history.jsonl` C=1, C=1, C=0). No fix loop could close it, so the run needed the person to rule on a waiver. It was found only at gate time, 1 h 47 m into the build chain, though the static rule could have reported it at intake.
- **e2e on Windows fails in the agent and passes for the orchestrator.** `agent-browser` resolves in Git Bash but not via `spawn` (`12-build-integration.md:23`). The orchestrator's re-run with `AGENT_BROWSER_BIN` passed 18/18 (`summary.md:12`). This is an environment gap that pr-brief #1, the Docker intake, does not cover.
- **The same two SUGGESTIONs were reported three times, and nobody owns them:**
  - the `getMultiReview` in-memory filter;
  - the missing transaction.
  They appear in the track S report, arch #2 and gate backend (`11-build-track-S.md:49`, `30-arch-1.md:21`, `summary.md:23`). The chain has no step that turns a SUGGESTION into a fix, so they stay open.
- **The orchestrator worked on the gate itself.** Main read `.claude/hooks/pr-self-review-gate.mjs` 11 times and `.devdigest/scope.json` 5 times (*Files one reader opened more than once*). `.devdigest/scope.json` sits in `.devdigest/` root, the kind of scratch that pr-brief #4 says belongs under `.devdigest/pr-self-review/`. Gate 3 took 1,396 s (`73-gate-3.md:3`).
- **Noise WARNINGs carried to PASS (`72-gate-2.md`):**
  - test-naming on two `.it` files that use the app harness (`:88-94`), the same issue as pr-brief #3;
  - `pr-size` from renames (`:84`);
  - `insights-rewrite` (`:76`);
  - unrouted agent-runner files and skills.
- **Model choice.** The three Opus gate reviewers cost $2.14 combined. The Sonnet arch reviewer covered the same tree for $0.26 with comparable precision; both re-found the same server SUGGESTION.

## Proposals
| # | Target | Change | Evidence | Expected effect | Cost | Status |
|---|---|---|---|---|---|---|
| 1 | `.claude/skills/run-plan/SKILL.md` (Step 0 intake) | Run `node .claude/hooks/pr-self-review-gate.mjs scope` at intake. List every static CRITICAL on a file outside the plan's files, and ask the person to fix or waive it before build. | Inherited agent-runner CRITICAL found only at gate 1 and still present at gate 2 (`history.jsonl`) | One gate run fewer; the waiver decision moves to the start, not the end | One command plus one question at intake | open |
| 2 | `scripts/e2e.sh` (or `e2e/run.ts`) | On win32, resolve the native `agent-browser` exe and export `AGENT_BROWSER_BIN` when it is unset. | `12-build-integration.md:23` 0/18 ENOENT; orchestrator 18/18 with the env var | The Integration implementer closes I1 itself; no PARTIAL from the environment | Small script change | open |
| 3 | `.claude/agents/plan-verifier.md` | Check Skill-contract rows against the implementer reports' *Skills applied* tables, not the tree. Mark them MET or NOT MET from there. | `20-verify-1.md:119-127`: 9 of 19 NV rows are Skill-contract | About 9 fewer NV rows per run, and real evidence that skills were loaded | The verifier reads the 1x reports | open |
| 4 | `.claude/skills/run-plan/SKILL.md` (summary) | Merge SUGGESTIONs repeated across the build report, arch and gate into one line with all three sources. Offer one optional fix iteration for them. | Same two SUGGESTIONs in 3 places (Cross-cutting #3) | The person sees one decision instead of three; a cheap fix is not lost | One summary rule | open |
| 5 | `.claude/agents/spec-creator.md` + `implementation-planner.md` | Spec report ends with a *Files that matter* list (`path:line`), and the planner starts from it before re-reading the tree. | Spec-creator and planner both read ≥10 of the same tree files; planner 306,680 final ctx, $4.91 | Lower planner context and cost | A longer spec report | open |
| 6 | `.claude/skills/pr-self-review/SKILL.md` (subagent-per-group) | Spawn the group reviewers with `model: sonnet`. | Opus group agents $2.14 vs Sonnet arch $0.26 on the same tree, with similar findings | About $1.5 saved per gate run | Possible precision drop; check with `eval:agents` | open |

## Earlier proposals
None of the six target files has changed since 2026-10-02:
- `run-plan`: last change 9780a1f, 2026-10-01;
- `plan-verifier`: 9780a1f;
- gate script: 289f8bb, 2026-09-29;
- `pr-self-review`: d49a6c7, 2026-09-19;
- `spec-writing`: 05dbf8f, 2026-10-02;
- `retro-usage`: 9780a1f.

| Entry | # | Target | Status now | Note |
|---|---|---|---|---|
| 2026-10-02-pr-brief | 1 | run-plan intake checks Docker | open | Docker was fine this run (`12-build-integration.md:21`). The Windows e2e failure is a sibling issue (proposal 2 above). |
| 2026-10-02-pr-brief | 2 | verifier tags `code`/`plan` closer | open | No fix loop this run, so untested |
| 2026-10-02-pr-brief | 3 | gate test-naming regex | open | Repeated: 2 test-naming WARNINGs on `.it` files (`72-gate-2.md:88-94`) |
| 2026-10-02-pr-brief | 4 | gate on committed tree; scratch only under `pr-self-review/` | open | Repeated: `.devdigest/scope.json` read 5× by main; 3 gate runs |
| 2026-10-02-pr-brief | 5 | layout NFR verified e2e/manual | open | Applied by hand this run: NFR-8 was `manual` (`20-verify-1.md:201`), and no jsdom layout test |
| 2026-10-02-pr-brief | 6 | verifier delta writes changed rows only | open | No delta this run, so untested |
| 2026-10-02-pr-brief | 7 | retro-usage stops counting `node <script>` as reads | open | Repeated: `scripts/verify.mjs` shows 32 "reads" across 10 readers |

This is the second retro in which all seven pr-brief proposals are still open; #3, #4 and #7 recurred.

## Impressions
- The build phase was the cheapest and smoothest part of the run: six implementers for $3.68, against $7.84 for spec plus plan. Most of the cost and wall time sits upstream with the person, which fits a spec that went through 4 decision rounds.
- The person's "simplest implementation" instruction probably explains why verify and arch needed no fix loop at all.

## Not measured
- Lines added and removed per agent: the script rows carry no `+/-`.
- Harness cost-state: there is no cost-state line in this transcript.
- How long each person-wait lasted, separate from orchestrator time inside the 41 m and 34 m gaps: the script gives only the gap.
- Whether the 7 `spec-lint.mjs` and 32 `verify.mjs` "reads" are reads or executions (pr-brief #7).
