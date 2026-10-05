# Agents

Subagent definitions for this repo. Each `*.md` here is a separate agent session with its
own system prompt, its own tool grant and no access to the calling conversation — Claude
Code discovers them by filename.

An **agent** is not a **skill**. A skill (`.claude/skills/*/SKILL.md`) is knowledge loaded
into the current session on demand; an agent is a fresh session that does a bounded job
and hands back a report. Skills say *how* to write something; agents decide *who* writes
it and with what tools.

**The agent files are the source of truth.** This README is a map — it does not restate
their rules or report templates. If the two disagree, the agent file is right and this
file is stale.

## Catalog

| Agent | Model | Tools | Preloaded skills | Input | Output | Never |
|---|---|---|---|---|---|---|
| [`researcher`](researcher.md) | sonnet | Read, Grep, Glob, Bash, WebSearch, WebFetch | — | a concrete question — repo or external | research report: conclusions, evidence with `path:line` or URLs, **Could not establish** | edits anything |
| [`spec-creator`](spec-creator.md) | opus | Read, Write, Edit, Grep, Glob, Bash, Skill, Agent (→ `researcher` only) | `spec-writing` | a feature idea + optional design paths under `specs/designs/<slug>/`; on a second round, the answers and researcher reports | `specs/YYYY-MM-DD-name.md` or `<pkg>/specs/YYYY-MM-DD-name.md` (`Status: draft`, lint-clean) + **Spec Report** — or a **Need clarification** / **Research needed** block | edits outside the five spec folders, changes a `Status`, edits an approved spec or a pre-template `01`–`09` file, delegates anything but research, plans, implements, reviews |
| [`implementation-planner`](implementation-planner.md) | opus | Read, Write (→ `plans/<stem>.md` only), Grep, Glob, Bash, Skill | — | a spec path and/or request text + `mode: single-agent \| multi-agent` | `plans/<stem>.md` (written by the agent) + **Plan Report** — or a **Requirements review** block (ledger, questions, recommendations, mode question) when the mode or an answer is missing | writes anything but the plan file, writes specs, implements, reviews |
| [`implementer`](implementer.md) | sonnet | Read, Write, Edit, Grep, Glob, Bash, Skill | — | path to a plan file + Plan ID; multi-agent: + the track; fix loop: + a Plan Conformance report path and item numbers | **Implementation Report** | pushes, opens PRs, commits, reviews architecture or security, widens scope, loads review-time skills |
| [`test-writer`](test-writer.md) | sonnet | Read, Write, Edit, Grep, Glob, Bash, Skill | — | a surface to cover + the behaviour to pin | tests + **Test Report** | edits production code, reviews, opens PRs, adds a dependency |
| [`plan-verifier`](plan-verifier.md) | sonnet | Read, Grep, Glob, Bash, Skill, Write (own report only) | — | path to a plan or spec + the branch; delta mode: + the previous Plan Conformance report | **Plan Conformance Report** — a per-item ledger | edits anything, implements the gaps, gives general review advice |
| [`architecture-reviewer`](architecture-reviewer.md) | sonnet | Read, Grep, Glob, Bash, Skill | `onion-architecture`, `frontend-ui-architecture` | a scope — branch, `base…HEAD`, or a file list | **Architecture Review**, advisory verdict | edits anything, fixes, reviews security, gates the PR |
| [`architecture-reviewer-lite`](architecture-reviewer-lite.md) | sonnet | Read, Grep, Glob, Bash, Skill | `onion-architecture`, `frontend-ui-architecture` | — **eval-only** B side of the A/B in `evals/agents/architecture-reviewer-lite/`; never dispatched | same as `architecture-reviewer`, minus the required `Rule:` line | everything `architecture-reviewer` refuses |
| [`doc-writer`](doc-writer.md) | sonnet | Read, Write, Edit, Grep, Glob, Bash, Skill | `mermaid-diagram` | a shipped feature + the plan or report behind it | docs + **Documentation Report** | edits code, writes specs, appends to `INSIGHTS.md` |

## The chain

```
feature idea (+ designs under specs/designs/<slug>/)
         →  spec-creator           →  Need clarification (questions + default), or
                                      Research needed (questions for researcher), or
                                      specs/YYYY-MM-DD-name.md (Status: draft) + Spec Report
            (research: spec-creator fans out to researcher itself when the harness gives
             it the Agent tool; otherwise the caller runs the researchers in parallel)
         →  caller relays the questions, re-invokes with the answers + reports
         →  a person reads the draft and sets Status: approved
spec (specs/YYYY-MM-DD-name.md, approved) + request
         →  implementation-planner →  Requirements review (ledger, questions,
                                      recommendations, single-agent / multi-agent?)
         →  caller relays the questions to the user, re-invokes with the answers + mode
         →  implementation-planner →  writes plans/YYYY-MM-DD-name.md (same stem as the
                                      spec, never under specs/) + Plan Report
         ── everything below is one command: /run-plan plans/<stem>.md ──
         →  implementer            →  Implementation Report
            (multi-agent: step 0 first, then one implementer per track in parallel,
             then the Integration step)
         →  plan-verifier          →  Plan Conformance Report (pass 1: code; Test plan
                                      rows are NOT VERIFIABLE, expected)
            ↺  DIVERGES → implementer in the fix loop (plan path + report path + item
               numbers) → plan-verifier in delta mode · at most 2 iterations
         →  test-writer            →  only with --with-tests (off by default: tokens)
         →  architecture-reviewer  →  Architecture Review (advisory)
            ↺  CRITICAL / WARNING → implementer in the fix loop (review path + finding
               numbers) → architecture-reviewer on the changed files · at most 2
         →  plan-verifier (delta)  →  only when a fix or tests changed the tree after pass 1
         →  doc-writer             →  only with --docs
         →  /engineering-insights  →  the implementer's Deviations, the verifier's "Plan
                                      claims the tree contradicts", the reviewer's "Could
                                      not establish" go to INSIGHTS.md
         →  /pr-self-review        →  BLOCK → one implementer fix on the CRITICAL ids →
                                      again; PASS → summary in .devdigest/sdd/<stem>/
         ── PR: a separate request from the person ──
```

[`/run-plan`](../skills/run-plan/SKILL.md) is the orchestrator for the build half. It
saves every agent's final message verbatim to `.devdigest/sdd/<stem>/NN-<agent>.md`,
hands the next agent a path and item numbers, stops at any `BLOCKED`, at a `draft` spec
or when a loop hits its cap, and can resume from the reports on disk (`--from`). The spec
and the plan are made by hand before it, because a person approves each of them.

The one rule that is easy to get wrong: **the implementer's prompt carries the plan's file
path, not a retelling of the plan.** A subagent inherits none of the caller's context, and
the caller may summarise a subagent's reply — so the plan has to exist as a file, and the
planner writes it there itself (its `Write` is limited by prompt text to `plans/`, the same
way `spec-creator`'s is limited to the spec folders) and returns only a short Plan Report.
The same applies to `plan-verifier`: it gets the path, never a summary, because a
summarised plan has already lost the items it would have checked.

**Verification runs through one script.** `scripts/verify.mjs <pkg> [--checks | --tests |
--file <p>] [--it]` is the only way `implementer`, `test-writer`, `plan-verifier` and
`architecture-reviewer` run lint, typecheck, arch or vitest. It prints one line per
command, the tail only on failure, runs vitest with the dot reporter, and caches green
results under `.devdigest/verify/` keyed by a fingerprint of the working tree. The cache is
what stops the chain from paying for the same suite four times: the verifier sees a
`cached` line for a run the implementer already made on the identical tree, and because
the script wrote it, not the implementer, "re-run, do not trust the report" still holds. A
step verifies with the narrowest command (`--checks`, `--file`); the full run happens once
per package, in the last step.

**The fix loop has an input.** A DIVERGES verdict does not go back to the main session to
patch by hand — that is the most expensive context in the chain. The implementer is
re-invoked with the plan path, the Plan Conformance report path and the item numbers to
close; then `plan-verifier` runs in delta mode over the previous ledger, re-checking only
the rows that were not MET or whose evidence file changed.

Questions travel the same way, in the other direction. A subagent **cannot prompt the
user**: `AskUserQuestion` is stripped from every subagent even when its `tools:` lists it
(docs, fetched 2026-09-28). So "ask if unclear" is implemented as a structured block that
is the agent's whole reply — `spec-creator`'s *Need clarification*, the planner's
*Requirements review* with its execution-mode question — and the caller relays it with its
own `AskUserQuestion`, then invokes the agent again with the answers (and, for the planner,
`mode:` in the prompt). Two invocations are the normal case, not a failure; a caller that
already has the answers can state them up front and get the file in one.

A spec and a plan are different documents. The spec (`specs/README.md`: Problem and user,
Goals / Non-goals, EARS acceptance criteria, Edge cases, Design review, NFRs, provenance,
Untrusted inputs) is the **input**; `spec-creator` drafts it and a person approves it
before planning. The plan (`plans/README.md`) is what the planner derives from it. The
planner never fills a missing spec section — it reports the gap, and the gap goes back to
`spec-creator` or to the person who owns the decision.

**Models.** `spec-creator` and `implementation-planner` stay on opus: they make the
decisions everything downstream inherits, and each runs once per feature. `plan-verifier`
and `architecture-reviewer` moved to sonnet on 2026-09-29: their bodies force a
structured output (a fixed four-status ledger; a finding with `path:line`, verbatim
evidence and a severity read from a table), which is exactly the shape a smaller model
holds well, and both run two to four times per feature inside the fix loops, so their
cost multiplies where the planner's does not. Reversible per agent in one line if a
review starts missing boundary breaks the opus version caught.

Why that order. `plan-verifier` runs **first after the implementer**, before tests and
before the architecture review: a tree that diverges from the plan goes back to the
implementer, and tests written against the wrong behaviour are rewritten, while the
architecture of work that is not the agreed work is not worth grading; cheapest gate
first. Its Test plan rows come out NOT VERIFIABLE on that pass, which is expected and
cheap. `test-writer` and `architecture-reviewer` then run **in parallel**: the test-writer
touches only test files, which `routing.md` classes as convention-only, so the reviewer
has nothing to say about them, and the reviewer only reads. The delta pass of
`plan-verifier` closes the Test plan rows without rebuilding the ledger. `doc-writer` runs
last, because docs describe the final tree, and `/engineering-insights` runs before the
gate so the lessons the agents reported are not lost in the orchestrator's context.

**`/pr-self-review` is the only thing that produces a PASS/BLOCK verdict and the only thing
the hook honours.** Every review agent above is advisory, and each says so in its own body.

There is deliberately **no `security-reviewer` agent.** Security review today is the
`security` skill, routed inside `/pr-self-review` onto `routes.ts`, the auth/secrets/github
adapters and the engine's prompt/grounding/llm files, with a confidence-based severity
mapping and an explicit "LOW → do not report" rule. A standalone agent needs its own
evidence discipline — attacker-controlled input traced to a sink, not pattern matches — and
that is its own piece of work.

`researcher` sits outside the chain; call it when the question is "how does X work" or
"is this still current", before planning.

## Permissions

A subagent's only gate is its `tools:` list. It is an allowlist that **replaces**
inheritance — a tool left out is not in the session at all, with no prompt and no error.
That is how `researcher` and `architecture-reviewer` are read-only: they simply have no
`Write` and no `Edit`. `implementation-planner` has `Write` and no `Edit`, limited by
prompt text to `plans/<stem>.md`; it gave up structural read-only for the guarantee that
the plan reaches the implementer unsummarised, the same trade `spec-creator` already makes
for the spec folders. `plan-verifier` made the same trade on 2026-10-01: it has `Write`,
limited by prompt text to the one `report to:` file under `.devdigest/sdd/<stem>/`. The
cause was an orchestrator that condensed a 194-row ledger while saving it, so the next
delta pass could not carry MET rows by number
(`docs/retro/ledger/2026-10-01-onboarding-generator.md`, proposal 2).

What does **not** work, and why it is absent here:

- `disallowedTools: Bash(git push:*)` would remove the **whole** `Bash` tool, not the
  pattern. Command-level limits only exist in `settings.json → permissions.deny`, which is
  session-wide and committed; we deliberately add none.
- `permissionMode` in frontmatter is ignored under auto mode, so it is no guarantee. Not
  declared.

`Agent` is granted to one agent only, `spec-creator`, and only for `researcher` fan-out;
the docs say the harness withholds `Agent` below the spawn-depth limit, so the body
handles both cases (fan out when present, return a *Research needed* block when not) and
the grant costs nothing when it is stripped.

`Bash` is granted to all eight agents, and what it is allowed to do differs:

| | read-only on the tree — `researcher`, `implementation-planner`, `architecture-reviewer`, `plan-verifier` | `implementer` | write-limited — `spec-creator`, `test-writer`, `doc-writer` |
|---|---|---|---|
| What for | `git log -S`, `git blame`, `git show`, `git diff --name-only`, `rg`, `cat`, `sed -n` — plus, for `architecture-reviewer` only, `node scripts/verify.mjs server --checks`, and for `plan-verifier` only, the `verify` commands its plan lists, through the same script | `node scripts/verify.mjs <pkg> …` — never `pnpm test`, `vitest`, `eslint` or `tsc` directly | `test-writer`: `node scripts/verify.mjs <pkg> [--file …] [--it]`. `spec-creator`: read-only inspection plus `node scripts/spec-lint.mjs <spec>` on the file it wrote. `doc-writer`: read-only inspection only — no build, no server, no test run |
| Limited by | prompt text only — no redirects, no mutating git, no install/build/migrate/seed/server, no `--fix`; `implementation-planner` additionally writes `plans/<stem>.md` and nothing else; `plan-verifier` writes only its `report to:` file under `.devdigest/sdd/<stem>/` | prompt text only — no pushing, no `gh pr` anything, no commits, no `--no-verify`, no `docker compose down -v` | prompt text only — `spec-creator` may touch `*.md` under the five spec folders only (`specs/`, `server/specs/`, `client/specs/`, `reviewer-core/specs/`, `mcp/specs/`), never a `README.md` there, never `specs/designs/**`, never a `Status` line; `test-writer` may touch test files and `server/test/helpers/` only; `doc-writer` may touch `*.md` outside `.claude/`, never a `CLAUDE.md` or an `INSIGHTS.md` |
| Hard enforcement | none | none, **except** `.claude/hooks/pr-self-review-gate.mjs` — a `PreToolUse` hook on `Bash` that blocks PR creation, PR merge and pushing until `/pr-self-review` passes | none, except the same hook |

So one layer is technical (push and PR creation) and the absence of `Write`/`Edit` is
structural; everything else is convention carried by the agent body, and each body says so
out loud rather than implying a sandbox that does not exist.

`architecture-reviewer` and `plan-verifier` keep `Bash` deliberately. Anthropic's SDK docs
show a read-only agent with `tools: Read, Grep, Glob` and no `Bash`; its own best-practices
page ships a read-only `security-reviewer` that includes `Bash`. Both are documented, so it
is a judgement call: without it, `architecture-reviewer` cannot establish its own scope with
`git diff` or run `pnpm arch` — it would restate rules instead of checking them — and
`plan-verifier` could not re-run a plan's `verify` commands, leaving it to believe the
Implementation Report, which is the exact failure it exists to prevent. Reversible in one
line if that trade stops paying. Tightening further by committing `permissions.deny` rules
was considered and declined: they are session-wide and would bind every developer.

## Skills inside an agent

Skills do **not** auto-trigger inside a subagent the way they do in the main session. An
agent reaches a skill in one of two ways:

- `skills:` in the frontmatter preloads the full skill body at startup — always, whether
  the run needs it or not;
- the `Skill` tool, kept in `tools:`, lets the agent load one on demand.

All eight grant `Skill`; three also preload a small standing set — the skill that agent
cannot do its job without:

| Agent | `skills:` | Why this one is standing |
|---|---|---|
| `spec-creator` | `spec-writing` | it *is* the template, EARS, traceability, the *Validation vocabulary* for Untrusted inputs and the self-check — kept in a skill rather than the agent body because the registry snapshots an agent's body at registration and a repo file reaches every run fresh (root `INSIGHTS.md` 2026-09-29). `security` was preloaded until 2026-09-29 for one table and cost ~270 lines of Express/Mongo/JWT per run; it is now loaded only for an auth, secrets or outbound-network feature |
| `architecture-reviewer` | `onion-architecture`, `frontend-ui-architecture` | these two *are* its rulebook; getting a rule number wrong makes the whole review wrong |
| `doc-writer` | `mermaid-diagram` | it draws a diagram on nearly every run |
| `plan-verifier` | — | its rulebook is the plan file. Preloading a review skill is what would push it toward generic review advice, which is the one thing it must not produce |
| `test-writer` | — | `react-testing-library` was preloaded until 2026-09-29; 600 lines of jsdom guidance on every server or engine test run. It now arrives through routing (the *frontend-tests* group) for client tests only, and the `fireEvent` hard rule that overrides it stays in the body regardless |

Everything else stays on demand: a frontend task should not pay for the
`onion-architecture` body, and vice versa. Only skills that already exist under
`.claude/skills/` are ever named here.

Two further rules keep skill loading from being the implementer's largest cost:

- **A skill is loaded once per run.** The `Skill` tool appends the whole body to the
  context every time it is called; an implementer told to "load the skills per step"
  loaded `onion-architecture` three times on a three-step server plan. The agent keeps a
  list and loads at the first step that needs a skill.
- **Write-time versus review-time.** `routing.md` names every skill that *reviews* a
  file. Only some help *write* one. `security` and `typescript-expert` are review-time
  catalogues — confidence-based findings on a finished diff — and together cost ~700
  lines; they are applied by `/pr-self-review` and never appear in a plan's Skill
  contract. The split is the *Write-time vs review-time* table in
  [`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md).

This is why the plan has a **Skill contract** section. `implementation-planner` cannot
enable a skill on the implementer's behalf — it can only name which skills each file group needs, and the
implementer invokes them. The routing both sides use is the canonical table in
[`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) (machine
source: `ROUTES` in `../hooks/pr-self-review-gate.mjs`). There is exactly one such table;
do not write a second.

## Sources

The rules in the eight agent files come from two places.

**External** (fetched 2026-09-22):

- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) and
  [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents) — the
  frontmatter field set, `tools` as a replacing allowlist, `disallowedTools` semantics,
  what a subagent inherits (nothing from the parent but the prompt string), the `skills`
  field, the absence of any structured-output mechanism.
- [Choose a permission mode](https://code.claude.com/docs/en/permission-modes) —
  `permissionMode` in a subagent's frontmatter is ignored under auto mode.
- [Configure permissions](https://code.claude.com/docs/en/permissions) — `deny > ask >
  allow`, `Bash(...)` rule syntax, `Agent(<name>)` rules.
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  — third-person, keyword-dense descriptions; the template pattern for fixed output.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  — each agent needs an objective, an output format and hard task boundaries; vague
  hand-offs cause duplicated work.

Sources added for `test-writer`, `architecture-reviewer`, `plan-verifier` and `doc-writer`
(fetched 2026-09-22):

- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) —
  "add an adversarial review step": a reviewer subagent in a fresh context; "have one
  Claude write tests, then another write code to pass them". The writer and the reviewer
  must be different calls. Its own read-only `security-reviewer` example includes `Bash`.
- [Building effective AI agents](https://www.anthropic.com/engineering/building-effective-agents)
  — the evaluator-optimizer split, "when we have clear evaluation criteria": the shape of
  `plan-verifier` and `architecture-reviewer`.
- [ImpossibleBench (arXiv:2510.20270)](https://arxiv.org/abs/2510.20270) — measured: an
  agent with access to unit tests will delete a failing test rather than fix the bug.
  `test-writer`'s hard stop on weakening an assertion comes from this.
- [Are coding agents generating over-mocked tests? (arXiv:2602.00409)](https://arxiv.org/abs/2602.00409)
  — agent commits add mocks at 36% vs 26% for humans; the paper's own recommendation is
  explicit mocking guidance in the agent's config file.
- [Testing Library — queries](https://testing-library.com/docs/queries/about/) —
  `getByRole` first, `getByTestId` last resort. (`user-event` is the library's default
  interaction API; this repo overrides it because the package is not installed.)
- [Systematic overcorrection in requirement conformance judgement (arXiv:2603.00539)](https://arxiv.org/abs/2603.00539)
  and [Bias in the loop: auditing LLM-as-a-judge for SE (arXiv:2604.16790)](https://arxiv.org/abs/2604.16790)
  — LLM reviewers misjudge conforming code, and asking them to explain themselves makes it
  worse; judge verdicts shift with prompt framing on unchanged code. Hence
  `plan-verifier`'s forced per-item ledger and fixed four-status vocabulary.
- [HalluJudge (arXiv:2601.19072, FSE'26)](https://arxiv.org/abs/2601.19072) — AI review
  comments drift ungrounded from the code; a structured semantic label beat a free-text
  verdict. Hence `architecture-reviewer`'s evidence-or-it-is-not-a-finding rule.
- [Fitness functions, *Building Evolutionary Architectures* ch. 2](https://www.oreilly.com/library/view/building-evolutionary-architectures/9781491986356/ch02.html)
  and [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
  — boundary checks belong in the pipeline, and a static tool only sees statically resolved
  edges. That split is exactly `pnpm arch` versus what `architecture-reviewer` adds.
- [NIST glossary — traceability matrix](https://csrc.nist.gov/glossary/term/traceability_matrix)
  (citing ISO/IEC/IEEE 24765:2017) — each requirement mapped to the artifact that satisfies
  it. `plan-verifier`'s ledger is this. (ISO/IEC/IEEE 29148 itself is paywalled and was not
  opened.)
- [Diátaxis](https://diataxis.fr/) — four documentation needs that do not mix in one
  document; [Google documentation best practices](https://google.github.io/styleguide/docguide/best_practices.html)
  — "change your documentation in the same CL as the code change";
  [Mermaid in Markdown](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/)
  — diagrams as text that diff and review like code.
- [Mitigating code LLM hallucinations with API documentation (arXiv:2407.09726)](https://arxiv.org/abs/2407.09726)
  — grounding generation in retrieved real source is the mitigation for invented APIs.
  Hence `doc-writer`'s verify-every-claim rule and its `path:line` evidence table.

Source added for `implementation-planner` (fetched 2026-09-28):

- [Create custom subagents — available tools](https://code.claude.com/docs/en/sub-agents)
  — `AskUserQuestion` is removed from a subagent's tool set even when `tools:` lists it,
  and `Agent` is withheld at the spawn-depth limit. A subagent that must "ask the user"
  can only return the question; the caller relays it. This is the whole reason the
  *Requirements review* is a returned block with a `mode:` question and not a prompt.

Source added for `spec-creator` (2026-09-29):

- [Easy Approach to Requirements Syntax (EARS)](https://www.researchgate.net/profile/Alistair_Mavin/publication/224079416_Easy_approach_to_requirements_syntax_EARS/links/568ce3bf08aeb488ea311990/Easy-approach-to-requirements-syntax-EARS.pdf)
  — Mavin, Wilkinson, Harwood and Novak, IEEE RE'09. Five patterns (ubiquitous,
  event-driven, state-driven, unwanted behaviour, optional feature) that separate the
  condition from the system's response. Every acceptance criterion and edge case in a
  spec uses one of them, which is what lets `plan-verifier` turn each into a ledger row.

**Frontmatter fields.** `name`, `description`, `tools` and `model` were confirmed by two
independent primary sources from the start. As of 2026-09-22, **`skills:` meets the same
bar** — documented on both [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
and [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents): it
preloads the named skills at startup, and skills *not* listed stay invocable through the
`Skill` tool. It is used by three agents (see *Skills inside an agent*). `disallowedTools`,
`permissionMode`, `maxTurns` and `color` are also documented but deliberately unused here:
`disallowedTools` would remove a whole tool rather than a command pattern, `permissionMode`
is ignored under auto mode and is not a safety boundary, and the other two solve problems
we do not have. `initialPrompt`, `hooks` and `experimental.cacheTtl` remain avoided.

**In-repo**: [`researcher.md`](researcher.md) set the house shape;
[`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) owns skill
routing; the five `AGENTS.md` files own the conventions the plan must respect; the
`INSIGHTS.md` files are what `implementation-planner` is required to read and cite;
[`../../specs/README.md`](../../specs/README.md) is the shape of the **input** a plan is
derived from — `spec-creator` writes it, the planner never does — and
[`../../plans/README.md`](../../plans/README.md) is where the plan itself lives.

## Adding an agent

- File: `.claude/agents/<name>.md`. `name` must match the filename.
- Required frontmatter: `name`, `description`. Safe to use beyond that: `tools`, `model`,
  and `skills` when the agent genuinely cannot work without a skill in context. Prefer
  nothing else — see *Sources* for which fields are documented and why the rest are still
  avoided.
- `description` is the **only** auto-delegation signal. Third person, keyword dense, with
  an explicit "use when" and an explicit boundary ("never edits", "does not review").
  Keep it short — detail belongs in the body, which only loads when the agent runs.
- Body shape, as all three follow it: **Hard rules** → **Step 0** (when to refuse or ask
  instead of proceeding) → **Method** → **Report format** (an exact markdown template) →
  **Quality bar**.
- Grant the smallest tool set that does the job, and state in the body what the granted
  tools may *not* be used for — that text is the only limit `Bash` has.
- Add a row to the catalog above.
