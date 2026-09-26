# Smart Diff (L03)

**Status:** Approved for implementation (2026-09-23). The second half of README's
*"Intent layer · Smart Diff"*; the Intent half is `06-intent-layer.md`.

Decisions taken with the author:

1. **Which findings count** — the latest `kind='review'` review **per agent**
   (`agent_id`; `null` is its own bucket). Re-running an agent replaces its old
   findings; different agents add up. Server (`finding_lines`) and client (dots,
   inline cards) apply the same rule.
2. **One Show/Hide comments toggle** covers GitHub comments *and* findings, and
   defaults to **shown** (today it defaults to hidden).
3. The classifier is **pure code** — no LLM call, no new dependency.

## Problem

The **Files changed** tab lists files in GitHub's order, so `pnpm-lock.yaml` sits
next to the business logic and the reviewer has to find the part that matters by
hand. The agent's findings live only on **Agent runs**, so matching a finding to
its code means switching tabs and counting lines.

## Scope

In:

- `SmartDiffRole` widened to `core | tests | wiring | docs | boilerplate`
  (server copy canonical, client copy mirrored byte-for-byte).
- A new module `server/src/modules/smart-diff/`: an ordered, path-based
  classifier (`classifyFile`), a pure builder (`buildSmartDiff`), and
  `GET /pulls/:id/smart-diff` with a `response` schema.
- Classifier rules, first match wins:
  1. **boilerplate** — lock files (`*.lock`, `pnpm-lock.yaml`,
     `package-lock.json`, `yarn.lock`), `dist/`, `build/`, `__snapshots__/`,
     `*.snap`, `*.generated.*`, `*.min.js`;
  2. **tests** — `*.test.ts(x)`, `*.it.test.ts`, `*.spec.ts(x)`, `test/`,
     `tests/`, `__tests__/`, `e2e/`;
  3. **wiring** — basename `index.(ts|tsx|js|mjs)`, `*.config.*`,
     `tsconfig*.json`, `.eslintrc*`, `.env*`, `docker-compose*.y(a)ml`,
     `.github/`, `.claude/`;
  4. **docs** — `*.md`, `docs/`, `README*`, `CHANGELOG*`, `LICENSE*`;
  5. **core** — everything else.
  Paths are normalized (`\` → `/`); names match case-insensitively.
- Files changed tab: five role groups in the order above, each with a sticky
  header (label, hint, `● N` files with findings, file count); `docs` and
  `boilerplate` collapsed by default; a Smart / Original order toggle.
- Findings in the diff: a severity dot on the file card, a severity bar and label
  on the line, and the `FindingCard` (Accept / Dismiss) under the line. A finding
  whose line is not in the patch is shown in a *findings outside the diff* block
  at the end of the file.
- Counters refresh after **Run review** completes, without a page reload.

Out:

- `pseudocode_summary` and a real `split_suggestion` (`too_big` is always
  `false`, `proposed_splits` always `[]`).
- Any change to the **Agent runs** tab or to how a review is produced.
- Reusing the classifier from `modules/reviews` (L08 — it would have to move to
  `modules/_shared/` or behind a container port first).

## Contract

```ts
SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate'])
```

`GET /pulls/:id/smart-diff` → `200 SmartDiff` · `404` unknown PR in the workspace.

- `groups` — non-empty groups only, in role order; GitHub order within a group.
- `files[].finding_lines` — sorted, unique `start_line` of the file's
  non-dismissed findings from the counted reviews.
- `split_suggestion` — `{ too_big: false, total_lines: Σ(additions + deletions),
  proposed_splits: [] }`.

UI copy lives in `client/messages/en/prReview.json` → `smartDiff`.

## Acceptance

**P1 — must:**

- The route returns 200 and parses as `SmartDiff`, including before the PR has
  any review (all `finding_lines` empty).
- `pnpm-lock.yaml` lands in `boilerplate`; `src/x.test.ts` in `tests`;
  `vite.config.ts` in `wiring`; `docs/x.md` in `docs`;
  `server/src/modules/x/service.ts` in `core`. Disputed cases pinned by test:
  `src/__tests__/__snapshots__/x.snap` → `boilerplate`,
  `.claude/skills/security/SKILL.md` → `wiring`, `e2e/README.md` → `tests`.
- Files changed shows the five groups in order; the lock file is in the collapsed
  boilerplate group.
- After a review, a file with findings shows a dot, and its finding card appears
  under the matching line **without toggling anything** (comments shown by
  default).

**P2 — must not regress:**

- Opening Files changed makes **no LLM call**.
- A finding never disappears: one whose line is outside the patch is shown at the
  end of its file.
- Only the latest review per agent counts; a dismissed finding adds no dot and no
  line number.
- Original order still renders today's flat list; e2e `05-pr-diff.flow.json`
  passes.

**P3 — should:**

- Group headers are sticky; a finding card collapses to one line.
- With no review yet, the tab says so instead of showing zero counters.
- Counters and cards refresh when Run review finishes, without a reload.
- Accept / Dismiss on an inline card change the finding's state.

## Open questions

- None blocking. Where the classifier lives once `modules/reviews` needs it (L08)
  is decided then, not now.
