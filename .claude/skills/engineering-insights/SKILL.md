---
name: engineering-insights
description: "Reads and appends to the module's INSIGHTS.md, the repo's durable engineering memory. Use BEFORE starting work in a module to load what earlier sessions learned about it, and AFTER a substantive task to record what this one learned. Also use mid-task the moment something non-obvious surfaces: a gotcha, a dead end, a library quirk, an error hit twice, a decision worth its rationale. Trigger phrases: insights, learnings, wrap up, what did we learn, record this."
argument-hint: "[module]"
---

# Engineering Insights

`INSIGHTS.md` is this repo's engineering memory: what a past session learned the
hard way, written for the next session to read cold. One file per module, next
to the code it is about.

Not architecture (that is `README.md`), not rules (that is `CLAUDE.md`), not a
changelog (that is `git log`).

---

## Routing — one insight, one file

| Work touched | File |
|---|---|
| `server/**` (incl. `src/modules/repo-intel`) | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| two or more of the above, or `scripts/`, `docs/`, Docker, DB wiring | `INSIGHTS.md` (root) |

A task that touched three modules writes each finding where it belongs. Never
copy one entry into three files. `$1` overrides the routing when it is
ambiguous.

## The seven sections — fixed, never invent new ones

| Section | Holds |
|---|---|
| `What Works` | An approach that solved something and should be reached for again |
| `What Doesn't Work` | A dead end, an antipattern, a thing that looked right and was not |
| `Codebase Patterns` | A convention or architectural decision **and the why behind it** |
| `Tool & Library Notes` | A dependency quirk: version, limit, flag, surprising default |
| `Recurring Errors & Fixes` | An error seen twice or more, paired with its fix |
| `Session Notes` | Dated summary of a substantive session |
| `Open Questions` | What is still unresolved, so the next session does not re-derive it |

`What Doesn't Work` is the most valuable section and the one most often left
empty. At wrap-up, check it deliberately before concluding there is nothing to
write.

---

## Read first — always, before writing code

1. **Load.** Before changing anything in a module, read that module's
   `INSIGHTS.md` and the root `INSIGHTS.md`.
2. **Summarise.** State the 3 entries most relevant to the task, one line each.
   This forces the content through the model instead of letting it sit unread in
   context, and proves the file was actually opened.
3. **Trust.** Treat entries as high-confidence guidance unless this session
   proves otherwise. If it does, that is itself an insight — record it.

## Read again — before appending

- **Already there** → write nothing. Say so.
- **Close, but this session sharpened it** → refine that line in place. Do not
  add a near-duplicate.
- **Contradicts an existing entry** → resolve it in the text
  (`supersedes the 2026-03-04 note: …`). Never leave two rules fighting; the
  next agent will pick at random.

---

## When to write

**Double trigger:**
- *As you go* — the moment something non-obvious surfaces, not only at the end.
- *Wrap-up* — at the end of the task.

**Cadence.** Worth a wrap-up when the session ran over ~30 minutes **and**
contained a problem, a decision, or a discovery. Trivial config edits and
routine work produce nothing.

**Skip rule.** If nothing clears the bar below, write nothing and say so
explicitly. Signal quality, not volume. An empty section is honest; a padded one
is noise.

## Entry format

```
- YYYY-MM-DD — <imperative statement naming the concrete symbol, path or number> (`path/file.ts:42`)
```

One line, three at most. The `file:line` citation is required for any claim
about code behaviour — the same discipline `reviewer-core` enforces on findings
through its grounding gate. A `Codebase Patterns` entry carries its *why*, not
just the rule.

`Session Notes` is the one exception, keeping a dated sub-entry:

```
### YYYY-MM-DD — short title
One or two lines: what we were doing, what turned out to be true, what we now do
differently.
```

---

## The bar: actionable cold

> If this would be obvious to anyone reading the code, don't write it.

Secondary test: would it save 5+ minutes next session? An entry must be specific
enough that an agent reading it cold knows what to do, without re-investigating.

| ❌ Noise | ✅ Insight |
|---|---|
| "Be careful with tests" | "A test that hits Postgres must be named `*.it.test.ts` — the CI split is filename-driven (`--exclude '**/*.it.test.ts'`), so a mis-named file runs in the hermetic lane and fails with no Docker." |
| "Indexing matters" | "An unindexed repo degrades to diff-only review with **no error** — the repo-map prompt section is silently omitted. If quality drops for one repo, check `repoIntel` indexing state before touching prompts." |
| "Watch out for shared types" | "`@devdigest/shared` is two physical copies behind one alias; a typecheck in `server/` cannot see drift in `client/`. Mirror a contract change into both in the same commit." |

---

## Append-only

Add entries. Never rewrite, reorder or delete another session's entry — that
causes merge conflicts in PRs and loses lessons. Refining a line this session
sharpened is the one exception.

Commit `INSIGHTS.md` with the work it came from, so the knowledge and the code
land together and a bad wrap-up can be reverted.

## Hygiene — the five failure modes

1. **Inconsistent triggering** — the loop only pays off if it runs every time.
2. **Generic entries** — see the bar above.
3. **File too long** — past ~200 entries signal drowns in noise; split by domain
   (`INSIGHTS-db.md`, `INSIGHTS-prompts.md`).
4. **Conflicting entries** — resolve explicitly, do not accumulate.
5. **Skipping `What Doesn't Work`** — the section that saves the most time.

Review monthly and delete entries a library or schema change has invalidated: a
stale note is worse than no note, because it is followed. `INSIGHTS.md` is a
**draft under human review**, not truth — a wrap-up can mis-summarise, so it is
git-versioned and spot-checked.

> Triggering is manual for now — the description plus `/engineering-insights`.
> A `Stop` hook makes it automatic later.

---

## Before you finish

- [ ] Read the target `INSIGHTS.md` **and** the root one before touching code
- [ ] Named the 3 most relevant existing entries out loud
- [ ] Re-read the target section — this is not a duplicate of what is there
- [ ] Routed to the module that owns the finding, not to root by default
- [ ] Checked `What Doesn't Work` for anything this session ruled out
- [ ] Every entry names a concrete symbol, path or number, with `file:line`
- [ ] Appended under an existing section; no section invented, none rewritten
- [ ] Nothing cleared the bar → wrote nothing and said so
