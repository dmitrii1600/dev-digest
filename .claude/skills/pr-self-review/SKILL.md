---
name: pr-self-review
description: >-
  Pre-PR gate for this repo. Reviews every local change on the branch (committed vs
  origin/main plus uncommitted and untracked) by routing each changed file to the skills
  that own it — frontend-ui-architecture / react-best-practices / next-best-practices for
  client/, onion-architecture / fastify / drizzle / postgres / security for server/,
  typescript-expert / security for reviewer-core/ — runs lint, typecheck and arch in the
  touched packages, applies the repo's own do-not-touch and naming rules, and writes a
  report with a PASS / BLOCK verdict. One CRITICAL finding blocks `gh pr create`,
  `gh pr merge` and `git push` through the PreToolUse hook and the git pre-push hook until
  it is fixed or waived. Use before opening or updating a pull request, when asked "is this
  ready for a PR", "self review", "pre-PR check", "can I push", or when the gate blocks a
  command. Review only — it never edits code.
argument-hint: "[base-ref] [--no-cache] [--offline]"
---

# PR Self Review

The gate between "it works on my machine" and a pull request. It answers one question:
**does this diff clear every rule this repo has written down, as judged by the skill that
owns each rule?** The deterministic half lives in `.claude/hooks/pr-self-review-gate.mjs`;
this file is the half that needs judgement.

Companions: **`routing.md`** (which skill reviews which file, and how their severities map
onto the repo's `CRITICAL | WARNING | SUGGESTION`), **`report.md`** (the finding and report
contracts, the waiver file, the PR body).

Hard rules of this skill:

- **It never edits code.** A gate that mutates the tree cannot be trusted by the thing it
  gates. Findings come with a `fix` — the developer applies it.
- **Every finding is grounded.** `file` must be in the diff and `line` must fall inside one
  of that file's hunks; `finalize` drops anything else and lists it under *Dropped*. A gate
  that blocks on a hallucinated line is worse than no gate.
- **Every finding names the rule.** `skill` + `rule` point at a real section or rule in
  that skill. "This looks wrong" is not a finding.
- **Machine checks and static rules are not re-derived by you.** The script runs them; you
  review what a linter cannot see.

---

## Workflow

All paths are relative to the repo root. Outputs land in `.devdigest/pr-self-review/`
(git-ignored).

### 0. Scope

```sh
node .claude/hooks/pr-self-review-gate.mjs scope $ARGUMENTS
```

Read the JSON it prints. It contains: `base`, `fingerprint`, `packages`, `checks` (what
step 1 will run), `insights_to_read`, `review_mode` (`inline` or `subagent-per-group`),
`groups` (skills + files per group, with `to_review` already minus cache hits), `files`
(per file: `group`, `skills`, `hunks`, `cached`), `static_findings` and `severity_enum`.

- `files` empty → say "nothing to review", stop. Do not write a report for an empty diff.
- `static_findings` already contains CRITICALs → tell the user now, before spending a
  review pass; they will block regardless of what the review finds. Continue anyway so the
  report is complete.
- `--no-cache` forces every file to be re-reviewed; use it after a routing change or when
  the user asks for a full pass.

### 1. Machine checks

```sh
node .claude/hooks/pr-self-review-gate.mjs checks
```

Runs `lint` / `typecheck` (/ `arch` in `server/`) with the package manager that owns each
touched folder. Takes one to three minutes. A red check becomes a CRITICAL finding on its
own; do not try to explain or soften it in the review — the tail of the output is the
evidence.

### 2. Read the INSIGHTS files

Open every path in `insights_to_read` (root + each touched package). You are looking for
two things:

- an entry under **What Doesn't Work** that the diff repeats — report it as a finding with
  `skill: "insights"`, `rule: "What Doesn't Work"`, the entry's date as evidence;
- an entry that explains a pattern the diff appears to violate — use it as the *why* in the
  finding's `fix`.

### 3. Review, one group at a time

For each group in `groups` with a non-empty `to_review`:

1. Load the group's skills with the `Skill` tool — only those skills, nothing else.
2. For each file in `to_review`, read the hunks (`git diff <base.sha> -- <file>`; untracked
   files in full) and enough surrounding code to judge placement and imports. The
   routing tells you *which* skill applies; the skill tells you *what* to check. Work
   through that skill's checklist / rules section explicitly — do not free-associate.
3. Write findings in the shape in `report.md`. Map the skill's own severity words onto the
   repo enum using the table in `routing.md`. When a skill has no severity vocabulary
   (onion rules, frontend placement), use the repo-specific mapping there.
4. Skip what the machine already caught: if `pnpm lint` failed on rule 2, do not also
   file an onion rule-2 finding for the same line.

**`review_mode: subagent-per-group`** (more than 10 files to review): spawn one
`general-purpose` agent per group, in parallel. Give each agent: the group's file list, the
base sha, the skill names to load, the finding contract from `report.md`, the severity
mapping from `routing.md`, and the instruction to return a JSON array of findings and
nothing else. Merge the arrays. Do not spawn per file, and do not spawn for the
`inline` mode — the fan-out only pays for itself when the skills would otherwise not fit
in one context.

Also check, for every group, the repo-specific rules in `routing.md` under *Judgement
rules the script cannot check* — they are the review-only half of the AGENTS.md
conventions (onion rules 5/6/9/11, `'use client'` placement, `fetch` in a component,
hardcoded strings, `$inferSelect` in a service signature, and so on).

### 4. Write findings and finalize

Write the merged array to `.devdigest/pr-self-review/findings.json`, then:

```sh
node .claude/hooks/pr-self-review-gate.mjs finalize
```

It validates and grounds each finding, adds static rules, failed checks and carried-over
cached findings, applies `waivers.json`, computes the verdict, writes `report.json`,
`pr-body.md`, `cache.json`, appends `history.jsonl`, and prints the markdown summary.
**Show that summary to the user verbatim** — it is the deliverable. Then add at most three
sentences: what blocks, what to do first, and (on PASS) that
`gh pr create --body-file .devdigest/pr-self-review/pr-body.md` carries the review into the PR.

If `finalize` says the tree changed since `scope`, start again from step 0 — the report
must describe exactly the tree it certifies.

### 5. Waivers

A CRITICAL that is a deliberate, discussed decision (a `grounding.ts` change, a migration
squash on an unreleased branch) is waived, not deleted: the user adds
`{ "id": "<finding id>", "reason": "<the decision>", "author": "<who>" }` to
`.devdigest/pr-self-review/waivers.json` and re-runs `finalize`. The finding stays in the
report and the PR body, marked *waived*. Never write a waiver yourself; propose the entry
and let the user paste it.

---

## When the gate blocks a command

The `PreToolUse` hook (`.claude/settings.json`) and the git `pre-push` hook run the same
script. When either says `pr-self-review: … Run /pr-self-review`, that is this skill: run
it from step 0, fix or waive what blocks, and retry the command. Do not work around the
hook (`--no-verify`, editing `report.json`, deleting `.devdigest/`); if the gate is wrong,
that is a bug in `pr-self-review-gate.mjs` and goes to `INSIGHTS.md` via
`/engineering-insights`.

---

## Before you finish

- [ ] `scope` → `checks` → review → `findings.json` → `finalize`, in that order, on one tree
- [ ] Every group's skills were loaded and their checklists walked, not paraphrased
- [ ] Every finding has `file`, `line` inside a hunk, `skill`, `rule`, `summary`, `fix`
- [ ] Nothing in the tree was edited by this skill
- [ ] The `finalize` summary was shown verbatim, then ≤ 3 sentences of guidance
- [ ] A gate false-positive or a routing gap was recorded with `/engineering-insights`
