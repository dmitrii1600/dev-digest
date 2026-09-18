# Severity counters and filter (studio)

**Status:** shipped on `feat/run-cost-badge`. The cross-package spec, including
the API contract, is [`../../specs/02-findings-severity.md`](../../specs/02-findings-severity.md);
this one covers only what lives inside `@devdigest/web`.

## Problem

Three screens show findings, and none of them let you see or use severity:

1. The PR list shows a SCORE donut and nothing about what caused it.
2. The run timeline shows `"3 findings · 2 blockers"` as flat text.
3. A review run lists every finding it produced, in one undifferentiated column.

The severity is already on every `FindingRecord`. The gap is entirely presentation.

## Scope

In:

- A FINDINGS column on the PR list with per-severity chips and a hover preview.
- Severity icons on timeline rows.
- A pill row inside the expanded Review-runs card that filters the findings below.

Out:

- Any change to `lib/api.ts` or to a hook's endpoint. The preview reuses
  `usePrReviews`.
- Filtering by anything other than severity.
- The run trace drawer (already done).

## Contract

**Component placement**

| Component | Location | Interactive? |
|---|---|---|
| `components/findings-preview/` | PR list, hover | chips filter it; rows are inert |
| `RunHistory` severity icons | timeline row | **no** |
| `_components/SeverityPills/` | expanded Review-runs card | yes — toggles |

**`SeverityPills`** takes `counts`, the active `severity`, and `onToggle`. It
renders only severities with a non-zero count, marks the active one
`aria-pressed` **and** outlined, and shows a "Show all findings" control while a
filter is on.

**Filter ownership.** The severity lives in `ReviewRunAccordion`, not in
`FindingsPanel`. `FindingsPanel` takes it as a prop and passes it to
`visibleFindings(findings, hideLow, severity)`. The pills and the list are
therefore two readers of one state, and the counts come from the same
`review.findings` array the cards are rendered from — that is what makes "the
number on the pill equals the cards below" true by construction rather than by
two computations agreeing.

**The preview is `position: fixed`.** Not a style preference: the PR-list table
card sets `overflow: hidden`, so an absolutely-positioned child of a row is
clipped at the card's edge. The card anchors to the hovered cell's
`getBoundingClientRect()` and clamps its left edge to the viewport.

**The preview is inert.** Severity icon, title, category, `file:line`,
confidence, two lines of rationale — and no buttons or links. Accept / Reject
belong on the PR page, where a finding can be read in full before it is acted on.

## Acceptance

- A severity with no findings renders no chip and no pill.
- `findings_counts === null` renders `—`; an all-zero object renders `0`.
- Clicking a chip on the PR list filters the preview and does **not** navigate;
  clicking the row still opens the PR.
- The preview contains zero elements matching `button, a`.
- A pill's count equals the number of finding cards of that severity below it.
- Clicking a pill filters; clicking the same pill again restores the full list;
  clicking a different pill switches rather than combining.
- Timeline severity icons are plain spans with no click handler.
- Narrowing the list never leaves the j/k cursor pointing past the end.

## Open questions

None.
