# Writing a flow that will not flake

The flow format and the coverage table are in `../README.md`. This is the
narrower question: what makes a flow deterministic, and which assertions this
suite can actually express.

## `wait` is the assertion

There is no `expect` here. A non-zero exit from a step fails the step and the
flow, so `wait --text` / `wait --url` **are** the assertions and every meaningful
claim has to be phrased as "this eventually appears".

## There is no negative text assertion

`wait --text X` waits for X to appear. There is no supported "wait until X is
gone". This shapes how a filter or a delete gets tested.

The wrong instinct is to approximate it with a sleep and a screenshot. The right
one is to assert a **positive consequence** of the thing having disappeared, and
to leave the disappearance itself to a component test, which can count rendered
nodes directly.

Worked example, the severity filter (`08-findings-severity.flow.json`):

| Claim | e2e | Component test |
|---|---|---|
| clicking a pill engages the filter | the "Show all findings" control appears | — |
| the CRITICAL finding survives | `wait --text` on its title | — |
| the WARNING finding is gone | *not expressible* | `ReviewRunAccordion.test.tsx` counts the cards |
| clearing restores everything | `wait --text` on the WARNING title | — |

The flow still proves the wiring end to end — real API, real DB, real browser —
and the assertion that needs counting lives where counting is cheap.

## Locators must be deterministic

`--url`, `--text`, and `find role|text|label` only. The AI `chat` command is
never used: that is what keeps runs stable and key-free.

Practical consequence: **an accessible name has to be unique on the page**. While
building the severity filter, the active pill's tooltip and the clear-filter link
initially both read "Clear severity filter", which would have made
`find role button --name "Clear severity filter"` ambiguous. The fix was to give
the link its own string ("Show all findings") — better for screen readers too.
If a flow needs a locator the UI cannot provide unambiguously, change the UI; do
not reach for a positional selector.

## Flows run against seeded data, in order

- `run.ts` discovers `specs/*.flow.json` and runs them in filename order against
  one shared browser session.
- Flows target read-only seeded fixtures (`acme/payments-api`, PR #482, the
  seeded agents), so nothing can trigger a model call.
- **Run hermetically.** Several flows follow the home redirect to the *first*
  repo and so assume the seeded demo repo is the only one. Against a real dev DB
  they land on the wrong repo and fail.

## Seed changes break flows

Flow assertions are strings from the seed. Changing `seed.ts` — adding a finding,
renaming an agent — will break any flow that asserted the old number or name.
Adding a third seeded finding to PR #482 turned `wait --text "2 findings"` into a
failure in `04-pr-findings.flow.json`.

That coupling is a feature: it is what makes these flows assert real data rather
than the presence of a container element. But it means a seed change is not done
until `./scripts/e2e.sh` is green.
