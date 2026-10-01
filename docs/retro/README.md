# docs/retro — retrospectives of agent workflow runs

The ledger of how our multi-agent workflows actually ran: the Spec Driven Development
chain (`spec-creator` → `implementation-planner` → `/run-plan`), a single `/run-plan`,
or any session that fanned work out to subagents. One entry per run, written by
`/workflow-retro` after the run finished.

`INSIGHTS.md` remembers what we learned about the **code**. This folder remembers what
we learned about the **process and the agents**: what each one found hard or easy, what
was read twice, what slipped through to the next stage, how many tokens the run cost, and
what we proposed to change. The two never copy each other.

## How an entry is made

```
/workflow-retro                                  # the run happened in this session; numbers from tool results
/workflow-retro --deep --stem <plan-stem>        # + tokens per session and per agent from the transcripts
/workflow-retro --deep --since 2026-09-29        # a workflow spread over several sessions
```

**Manual only.** The skill is user-invocable and nothing else: it is not a `/run-plan`
phase, not a `Stop` hook, and `disable-model-invocation: true` in its frontmatter keeps the
model from loading it on its own. Making it automatic is a decision to record here first.

The numbers come from `node scripts/retro-usage.mjs`, which reads the Claude Code
transcripts under `~/.claude/projects/<project-slug>/` (read-only) and prints sessions,
per-model tokens and cost, every agent in spawn order with its own summed usage and an
estimated cost in USD (Anthropic list price, cache writes priced by TTL — the harness's
own cost-state line is shown next to it as a lower bound), files read by more than one
agent, and the markers in each hand-back report. Transcripts are
local and unversioned — run the retro before they are cleaned up; the entry is the
durable record.

## Entry format

`ledger/YYYY-MM-DD-<plan-stem-or-title>.md`, the template in
[`.claude/skills/workflow-retro/SKILL.md`](../../.claude/skills/workflow-retro/SKILL.md):
Numbers · Agent timeline · Per agent (input, hard, easy, duplicated, missed, report) ·
Cross-cutting findings · Proposals · Earlier proposals · Impressions · Not measured.

Rules the entries follow:

- a number is measured (tool result, report file, script) or written as `not measured`;
- a judgement cites a report line, a script row or a `path:line`, or sits under *Impressions*;
- a proposal names a target file, a change, its evidence, the expected effect and a cost,
  and stays `open` until a later retro marks it `adopted` or `declined`;
- the retro edits nothing outside this folder — proposals are adopted by hand, in their own change.

## Index

| Date | Workflow | Sessions | Agents | Cost | Top proposal | Entry |
|---|---|---|---|---|---|---|

(`/workflow-retro` adds one row per entry, newest first.)
