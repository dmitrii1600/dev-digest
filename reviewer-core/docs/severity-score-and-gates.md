# Severity: what it decides, and what ignores it

Severity is the only field in a finding that other systems compute on. Four
different things read it, they read it differently, and confusing them produces
numbers that disagree on screen. This is the map.

Prompt-side conventions (how a model is told to choose a severity) live in
[`../../docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md) —
link, do not duplicate.

## The three levels

`CRITICAL | WARNING | SUGGESTION` (`@devdigest/shared`, `contracts/findings.ts`).
There is no `INFO` — the design-system token map has one, but the enum cannot
produce it, so nothing downstream should render an INFO bucket.

Severity is **free text in Postgres**, not a pg enum (`findings.severity` is
`text`). Consumers tally defensively: a value outside the three is ignored, never
thrown on.

## 1. Score — recomputed, never trusted

`reduce.ts`:

```
CRITICAL −35   WARNING −12   SUGGESTION −3      (from 100, clamped to 0)
```

The model's self-reported `score` is **discarded**. The score on screen is a pure
function of the findings that survived grounding, so a review can never show a
number its own findings do not justify.

Two consequences that matter outside this package:

- Anything that counts findings for display must count the same population the
  score was computed from — including dismissed ones. Filtering those out of a
  counter while the score still includes them puts two contradictory numbers in
  one table row.
- The weights are why severity inflation is a real cost, not a style issue: one
  over-called CRITICAL moves the score by 35 points.

## 2. Blockers — severity plus the agent's gate

`countBlockers(findings, failOn)` in `output/to-review.ts`, ranked by `SEV_RANK`
and thresholded by the agent's `ciFailOn` (`never | critical | warning | any`,
default `critical`). Persisted to `agent_runs.blockers`.

This is **not** the same as "count of CRITICAL". It is per-agent configurable,
and the CI merge gate is derived from it — deterministically, independent of the
model's `verdict`. A UI that hardcodes `severity === 'CRITICAL'` will disagree
with the stored value for any agent whose gate is not the default. There is such
a place in the client today (`ReviewRunAccordion`), noted in its INSIGHTS.

## 3. Grounding — severity-blind

`grounding.ts` drops a finding whose cited lines do not intersect a real diff
hunk, regardless of how severe it claims to be. A CRITICAL is not privileged: an
ungrounded critical is a hallucinated critical, and it disappears like any other.

The exception is `FULL_FILE_KINDS` (`secret_leak`, `lethal_trifecta`, `phantom`,
`hook`), which only need the file to be present in the diff — those findings are
about the file's existence, not a specific line.

Ordering matters: grounding runs **before** scoring, so the score describes what
survived, not what the model claimed.

## 4. Verdict — passes through untouched

`verdict` is taken from the model unchanged (`run.ts`). It is the one output
severity does **not** determine, which is why a wrong verdict reaches the UI
intact and why the verdict convention in the prompt docs is load-bearing rather
than advisory. See `../specs/01-deterministic-verdict.md` for the standing
proposal to derive it instead.

## At a glance

| Reads severity | Where | Rule |
|---|---|---|
| `score` | `reduce.ts` | 35 / 12 / 3 penalty, recomputed from grounded findings |
| `blockers` | `output/to-review.ts` | rank ≥ the agent's `ciFailOn` |
| grounding | `grounding.ts` | **ignores it** — citation is the only test |
| `verdict` | `run.ts` | **ignores it** — passed through from the model |
