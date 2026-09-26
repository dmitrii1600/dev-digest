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
| [`planner`](planner.md) | opus | Read, Grep, Glob, Bash, Skill | — | a change request + the packages in scope | **Development Plan**, emitted verbatim | writes files, implements, reviews |
| [`implementer`](implementer.md) | sonnet | Read, Write, Edit, Grep, Glob, Bash, Skill | — | path to a plan file + Plan ID | **Implementation Report** | pushes, opens PRs, commits, reviews architecture or security, widens scope |
| [`test-writer`](test-writer.md) | sonnet | Read, Write, Edit, Grep, Glob, Bash, Skill | `react-testing-library` | a surface to cover + the behaviour to pin | tests + **Test Report** | edits production code, reviews, opens PRs, adds a dependency |
| [`plan-verifier`](plan-verifier.md) | opus | Read, Grep, Glob, Bash, Skill | — | path to a plan or spec + the branch | **Plan Conformance Report** — a per-item ledger | edits anything, implements the gaps, gives general review advice |
| [`architecture-reviewer`](architecture-reviewer.md) | opus | Read, Grep, Glob, Bash, Skill | `onion-architecture`, `frontend-ui-architecture` | a scope — branch, `base…HEAD`, or a file list | **Architecture Review**, advisory verdict | edits anything, fixes, reviews security, gates the PR |
| [`doc-writer`](doc-writer.md) | sonnet | Read, Write, Edit, Grep, Glob, Bash, Skill | `mermaid-diagram` | a shipped feature + the plan or report behind it | docs + **Documentation Report** | edits code, writes specs, appends to `INSIGHTS.md` |

## The chain

```
request  →  planner               →  Development Plan (verbatim)
         →  caller saves the plan to a file (session scratchpad by default;
            specs/NN-name.md when it is a real feature spec)
         →  implementer           →  Implementation Report
         →  test-writer           →  tests + Test Report
         →  plan-verifier         →  Plan Conformance Report
         →  architecture-reviewer →  Architecture Review (advisory)
         →  doc-writer            →  docs + Documentation Report
         →  /pr-self-review       →  PASS  →  PR
```

The one rule that is easy to get wrong: **the implementer's prompt carries the plan's file
path, not a retelling of the plan.** A subagent inherits none of the caller's context, and
the caller may summarise a subagent's reply — so the plan has to exist as a file, and the
planner is told to emit it verbatim as its final message. The same applies to
`plan-verifier`: it gets the path, never a summary, because a summarised plan has already
lost the items it would have checked.

Why that order. `test-writer` runs after the implementer because the implementer only
verifies; it is not asked to design a suite — and the tests are part of the change under
review, so they must exist before anything judges the branch. `plan-verifier` runs before
`architecture-reviewer` because a tree that diverges from the plan goes back to the
implementer, and there is no point grading the architecture of work that is not the agreed
work; cheapest gate first. `doc-writer` runs last, because docs describe the final tree.

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
That is how `planner`, `researcher`, `architecture-reviewer` and `plan-verifier` are
read-only: they simply have no `Write` and no `Edit`.

What does **not** work, and why it is absent here:

- `disallowedTools: Bash(git push:*)` would remove the **whole** `Bash` tool, not the
  pattern. Command-level limits only exist in `settings.json → permissions.deny`, which is
  session-wide and committed; we deliberately add none.
- `permissionMode` in frontmatter is ignored under auto mode, so it is no guarantee. Not
  declared.

`Bash` is granted to all seven agents, and what it is allowed to do differs:

| | read-only — `researcher`, `planner`, `architecture-reviewer`, `plan-verifier` | `implementer` | write-limited — `test-writer`, `doc-writer` |
|---|---|---|---|
| What for | `git log -S`, `git blame`, `git show`, `git diff --name-only`, `rg`, `cat`, `sed -n` — plus, for `architecture-reviewer` only, `pnpm arch` and `pnpm lint` in `server/`, and for `plan-verifier` only, the `verify` commands its plan lists | `pnpm lint` / `typecheck` / `test`, `npm test` in `reviewer-core` | `test-writer`: the vitest lanes and `typecheck`. `doc-writer`: read-only inspection only — no build, no server, no test run |
| Limited by | prompt text only — no redirects, no mutating git, no install/build/migrate/seed/server, no `--fix` | prompt text only — no pushing, no `gh pr` anything, no commits, no `--no-verify`, no `docker compose down -v` | prompt text only — `test-writer` may touch test files and `server/test/helpers/` only; `doc-writer` may touch `*.md` outside `.claude/`, never a `CLAUDE.md` or an `INSIGHTS.md` |
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

All seven grant `Skill`; four also preload a small standing set — the skill that agent
cannot do its job without:

| Agent | `skills:` | Why this one is standing |
|---|---|---|
| `test-writer` | `react-testing-library` | its default (`userEvent`) contradicts this repo, so the agent must hold the skill and the Hard rule that overrides it in context together |
| `architecture-reviewer` | `onion-architecture`, `frontend-ui-architecture` | these two *are* its rulebook; getting a rule number wrong makes the whole review wrong |
| `doc-writer` | `mermaid-diagram` | it draws a diagram on nearly every run |
| `plan-verifier` | — | its rulebook is the plan file. Preloading a review skill is what would push it toward generic review advice, which is the one thing it must not produce |

Everything else stays on demand: a frontend task should not pay for the
`onion-architecture` body, and vice versa. Only skills that already exist under
`.claude/skills/` are ever named here.

This is why the plan has a **Skill contract** section. The planner cannot enable a skill on
the implementer's behalf — it can only name which skills each file group needs, and the
implementer invokes them. The routing both sides use is the canonical table in
[`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) (machine
source: `ROUTES` in `../hooks/pr-self-review-gate.mjs`). There is exactly one such table;
do not write a second.

## Sources

The rules in the seven agent files come from two places.

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

**Frontmatter fields.** `name`, `description`, `tools` and `model` were confirmed by two
independent primary sources from the start. As of 2026-09-22, **`skills:` meets the same
bar** — documented on both [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
and [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents): it
preloads the named skills at startup, and skills *not* listed stay invocable through the
`Skill` tool. It is used by four agents (see *Skills inside an agent*). `disallowedTools`,
`permissionMode`, `maxTurns` and `color` are also documented but deliberately unused here:
`disallowedTools` would remove a whole tool rather than a command pattern, `permissionMode`
is ignored under auto mode and is not a safety boundary, and the other two solve problems
we do not have. `initialPrompt`, `hooks` and `experimental.cacheTtl` remain avoided.

**In-repo**: [`researcher.md`](researcher.md) set the house shape;
[`../skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) owns skill
routing; the five `AGENTS.md` files own the conventions the plan must respect; the
`INSIGHTS.md` files are what the planner is required to read and cite;
[`../../specs/README.md`](../../specs/README.md) is the shape a plan graduates into when it
becomes a feature spec.

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
