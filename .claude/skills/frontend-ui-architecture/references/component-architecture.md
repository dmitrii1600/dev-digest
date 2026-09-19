# Component architecture: splitting, composing, and extracting logic

How to decide where one component ends and the next begins, and how to get business logic out
of the render path without inventing layers nobody needs.

## Contents

- [Split on reasons to change](#split-on-reasons-to-change)
- [When not to split](#when-not-to-split)
- [Composition over configuration](#composition-over-configuration)
- [Container and presentational, in 2026](#container-and-presentational-in-2026)
- [Extracting business logic](#extracting-business-logic)
- [Do you need a service layer?](#do-you-need-a-service-layer)
- [The server/client seam](#the-serverclient-seam)
- [A worked example](#a-worked-example)

## Split on reasons to change

Line count is a symptom. The criterion is **how many independent reasons this file has to
change** — a 300-line form that only changes when the form changes is healthier than three
40-line components that must always be edited together, because the latter has the same
complexity plus three files of indirection.

Concrete signals that a block has become its own reason to change:

- **It owns state nothing outside reads.** That state is the block's private business, and
  keeping it where it is used also means updates re-render less of the tree. (Kent C. Dodds
  frames colocated state as both a maintenance and a performance win, and the maintenance half
  is the part that always applies.)
- **It has its own loading / error / empty branch.** A block with its own async lifecycle is a
  separate unit of behaviour; splitting it also lets you give it its own Suspense or error
  boundary.
- **It needs `'use client'` and the rest of the tree does not.** In Next.js this is a real
  architectural seam — the split decides what ships to the browser, so it is worth making even
  when the extracted component is tiny.
- **You want to test it without mounting the parent.** If a test would need to construct
  elaborate parent state to reach this behaviour, it is asking to be its own component.
- **The same JSX shape renders twice with different data.** Two occurrences is the promotion
  trigger; one is not.

## When not to split

Extraction is not free — it costs a file, a name, a prop interface, and an indirection every
future reader must follow. Do not pay that for:

- **Line count alone.** "This file is long" is not a reason to change. "This file has three
  jobs" is.
- **A single consumer with no independent identity.** An abstraction with one caller is
  indirection with no payoff. Wait for the second one.
- **A pass-through wrapper.** A component whose body is `<Inner {...props} />` adds a hop and
  nothing else.
- **A component that only calls a hook and returns `null`.** Call the hook from the parent.
- **Speculative reuse.** Duplicating twenty lines for a while is much cheaper than the wrong
  abstraction, which is paid back with interest every time the two callers need to diverge.

## Composition over configuration

When a component grows its seventh boolean prop, it is being asked to be two components. The
usual escape is not more props but more composition.

```tsx
// ✗ configuration: every new variant adds a prop and a branch
<Panel title="Findings" collapsible showCount count={12} actionLabel="Re-run" onAction={run} />

// ✓ composition: the parent supplies the parts, Panel owns only layout
<Panel>
  <Panel.Header>
    Findings <Badge>{12}</Badge>
    <Button onClick={run}>Re-run</Button>
  </Panel.Header>
  <Panel.Body>{...}</Panel.Body>
</Panel>
```

Two further moves worth knowing:

- **Lift content up.** When a wrapper takes a prop only to pass it to something it renders, take
  `children` instead. The wrapper stops knowing about the domain and becomes reusable.
- **Push state down.** When state is used by one subtree, move it into that subtree. Prop
  drilling is usually a symptom of state that was lifted higher than it needed to be, and the
  fix is relocating the state rather than reaching for Context.

Context is for dependency injection — theme, auth, locale, a client instance — not a
replacement for passing props. Reaching for it to avoid drilling two levels trades a visible
dependency for an invisible one and re-renders every consumer on every change.

## Container and presentational, in 2026

The strict version of this pattern — every component paired with a "container" — died with
hooks, which let any component acquire data without a wrapper. What survives is the underlying
idea, now applied at the **feature boundary** rather than per component:

- One component near the top of the feature knows how data arrives: it calls the data hook and
  handles loading, error, and empty states.
- Everything below takes plain data and callbacks and can be rendered from a fixture in a test
  or a story.

The value is testability and the ability to reason about a subtree without knowing where its
data came from. The failure mode is applying it mechanically and producing a container for
every leaf — pure ceremony.

## Extracting business logic

Three tiers, each with a different testing story. The split is worth making because tiers 1 and
3 change for completely unrelated reasons and at different rates.

```
1. rule          pure function        no React, no IO        table-driven unit test
2. orchestration hook                 state, effects, cache  hook test / integration
3. render        component            JSX only               component test with fixtures
```

```ts
// 1. rule — features/reviews/model/verdict.ts
export function verdictFor(findings: Finding[]): Verdict {
  if (findings.some(f => f.severity === 'critical')) return 'blocked'
  return findings.length > 0 ? 'changes-requested' : 'approved'
}

// 2. orchestration — features/reviews/useReviewVerdict.ts
export function useReviewVerdict(pullId: string) {
  const { data, isPending, error } = useReviewRuns(pullId)
  const verdict = data ? verdictFor(data.findings) : null
  return { verdict, isPending, error }
}

// 3. render — VerdictBanner.tsx
export function VerdictBanner({ pullId }: { pullId: string }) {
  const { verdict, isPending } = useReviewVerdict(pullId)
  if (isPending) return <Skeleton />
  return <Banner tone={TONE[verdict]}>{t(`verdict.${verdict}`)}</Banner>
}
```

Note what tier 2 does *not* do: it does not recompute `verdict` in a `useEffect` and store it in
state. Anything derivable from data you already have is computed during render — a rule worth
internalising because the effect-plus-state version is the most common way business logic ends
up unreachable by tests.

**How to spot logic that needs extracting:** a conditional in JSX that a domain expert would
recognise as a policy; a test that mounts a component in order to assert a calculation; the same
`if` repeated in two components.

## Do you need a service layer?

Usually not. Tier 1 is already framework-agnostic — pure functions with no React import are
exactly what a "service" would be, minus a class and a folder.

The distinction that matters: a service can be called from anywhere, a hook only from a
component, and a hook can reach React state and context while a service cannot. So a service
layer earns its place when:

- non-React callers exist — a CLI, a worker, a second app, a server route;
- the logic must survive a framework migration;
- there is real dependency injection to do (swapping a transport per environment).

If none of those hold, a service layer is a folder that adds a hop between the hook and the pure
function. Keep the two tiers you need.

## The server/client seam

In an RSC framework, the `'use client'` boundary is an architectural decision before it is a
performance one — it decides what code ships to the browser and what data crosses the wire.

Push it as far down the tree as possible. A page marked `'use client'` because one button needs
`onClick` drags its entire subtree into the bundle. Extract the interactive leaf, mark that, and
leave the rest on the server.

The corollary for placement: a Server Component may read from the data layer directly, while a
Client Component may not. That makes the seam a natural home for the container/presentational
split — server component fetches and narrows, client leaf renders and reacts. See
[nextjs-app-router.md](nextjs-app-router.md).

## A worked example

A `RunTraceDrawer` that started as one file and grew:

```
RunTraceDrawer/
├── RunTraceDrawer.tsx        owns which tab is active + raw-output copy state
├── RunTraceDrawer.test.tsx
├── constants.ts  helpers.ts  styles.ts
└── _components/
    ├── TraceBody/            composes the trace view                → split: own branch
    ├── TraceSection/         owns its own expand state              → split: private state
    ├── PromptBlock/          owns open / fullscreen / copied state  → split: private state
    ├── PromptModalBody/      rendered only by PromptBlock           → split: own subject
    ├── ToolCallRow/          rendered once per tool call            → split: repeated shape
    └── FindingsSection/      owns its own empty branch              → split: own branch
```

Each child is here because of a signal from the list above, not because the parent was long —
the drawer itself is 107 lines and its children run 34 to 118, so nobody was splitting to hit a
number. `PromptModalBody` sitting at this level rather than being hoisted to the route is the
ladder working: only `PromptBlock` imports it, so it stays here until a sibling needs it.

Note what is *not* a signal here: the whole drawer is already `'use client'`, so the
server/client seam plays no part in this particular split. That seam is a strong reason to
extract when it applies, and no reason at all when it does not.

What would be wrong in this folder: a `Divider` (generic — belongs in shared), a
`useDisclosure` used by three of the children (belongs one rung up, at the drawer root), or a
`formatDuration` util (domain-free — belongs in shared).
