# Deterministic verdict

**Status:** NOT implemented. This is a standing proposal, not a description of
current behaviour — today `verdict` is whatever the model returned. Do not read
it as a description of the engine.

## Problem

`score` is recomputed from the grounded findings and `blockers` is derived from
them against the agent's gate, but `verdict` is passed straight through from the
model (`src/review/run.ts`). So a review can, and occasionally does, show:

- `approve` alongside two CRITICAL findings, or
- `request_changes` on a review whose only finding is a SUGGESTION.

Both render in the UI as-is. The PR page shows the verdict banner next to a score
and a set of severity pills computed from a different source, and they contradict
each other.

The current mitigation is prose: `docs/agent-prompts/README.md` states the
convention (`request_changes` ⇔ at least one CRITICAL) and every agent prompt is
expected to restate it. That makes a documentation rule load-bearing for a
correctness property — the same mistake we deliberately avoided for `score`,
which is why `score` is recomputed rather than trusted.

It also means the CI gate and the on-screen verdict can disagree: the gate is
already deterministic (`countBlockers` vs `ciFailOn`), the verdict is not.

## Scope

In:

- Derive `verdict` in `reduce.ts` from the grounded findings and the agent's
  `ciFailOn`, the same inputs `blockers` already uses.
- Keep the model's verdict on the review record as a separate field, so the
  disagreement is observable rather than silently discarded.
- An engine test per branch — `npm test` is hermetic with a stubbed provider, so
  there is no excuse for an unverified gate.

Out:

- Changing `ciFailOn` semantics or its default.
- Any prompt change. The prompt convention stays; it stops being the only thing
  enforcing the rule.
- Any UI work. The UI already renders `review.verdict`.

## Contract

Proposed derivation, using the agent's gate rather than a hardcoded severity so
that the verdict and the CI gate cannot disagree:

```
blockers > 0                        → request_changes
no findings at all                  → approve
findings, none of them blocking     → comment
```

Contract change (`@devdigest/shared`): `ReviewRecord` gains
`model_verdict: Verdict.nullable()` — what the model said, kept for eval and for
agent-performance work. `verdict` becomes the derived value.

`.nullable()`, not required: reviews persisted before this exists have no such
field, and `ReviewRecord` is assembled per-request from columns.

## Acceptance

- A review with one CRITICAL and an agent on the default gate is
  `request_changes`, whatever the model returned.
- A review with zero findings is `approve`.
- A review with only SUGGESTIONs is `comment`, not `request_changes`.
- An agent with `ciFailOn: 'never'` never produces `request_changes` from this
  path.
- `verdict` and the CI gate agree on every fixture — asserted together, in one
  test, so they cannot drift.
- Where the model disagreed with the derived verdict, `model_verdict` records it.

## Open questions

- Should a disagreement be logged as a run-level signal (it is a cheap,
  per-run measure of prompt quality), or is keeping the field enough until the
  eval work in a later lesson needs it?
- `approve` on a review that found nothing may be too strong when grounding
  dropped everything the model proposed. Does "everything was dropped" deserve
  its own verdict, or is that an eval concern rather than a verdict concern?
