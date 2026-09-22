---
name: frontend-ui-architecture
description: >-
  UI architecture and code organization for React and Next.js frontends — where code belongs,
  not how to write it. Use whenever adding or moving a component, hook, constant, util, type or
  feature; when deciding whether something is shared or feature-local; when a folder has grown
  into a dumpster, a file is hard to find, or something feels like it is in the wrong place;
  when reviewing or refactoring frontend structure; and whenever the question touches folder
  structure, project layout, layering, module boundaries, barrel files, feature folders,
  colocation, or where business logic should live. Reach for it even when the request is only
  "add a component" or "where should this go" — placement is what teams get wrong silently, and
  wrong placement is expensive to undo later. Covers component splitting, shared-vs-local
  promotion, constants and config, utils vs helpers, business-logic placement, unidirectional
  imports, and Next.js App Router colocation. It does not cover how to write components and
  hooks (see react-best-practices) or Next.js runtime behaviour and rendering (see
  next-best-practices).
version: 1.0.0
---

# Frontend UI Architecture

This skill answers one class of question: **where does this code live, and what may it
import?** It deliberately says nothing about how to write a component, how to avoid a
re-render, or how `useEffect` works — `react-best-practices` and `next-best-practices` own
those, and duplicating them here would produce two sources of truth that drift.

Placement decisions are cheap to make and expensive to reverse. A util dropped into a global
`utils/` folder on day one is imported from nine places by month three, and by then nobody
knows which of them still needs it. So the rules below all push in the same direction: **start
as local as possible, move outward only when reality forces you to.**

## The one question

Before creating any file, ask: *does this change together with the thing next to it?*

Code that changes together belongs together. This is colocation, and it is the single
highest-leverage structural principle in a frontend codebase — it beats any particular folder
taxonomy. It works because it optimises for the two things you actually do all day: finding
the code that implements a behaviour, and changing every piece of that behaviour at once
without hunting.

Colocation also tells you when to stop colocating: the moment a second, *independent* consumer
appears, the file no longer changes together with only its original neighbour, and it has
earned a move outward.

## The promotion ladder

Every artifact — component, hook, constant, helper, type — starts at the lowest rung and moves
up **one rung at a time**, only when a second independent consumer appears.

```
1. inline, in the file that uses it
2. a sibling file inside that component's own folder
3. the parent's  _components/  (or the feature's own folder)
4. the feature root:            features/<name>/
5. the shared layer:            src/components, src/lib, src/hooks, src/config
```

Two corollaries people skip:

- **One rung, not five.** A helper used by two siblings moves to their shared parent, not to
  `src/utils`. Jumping straight to global is how the dumpster folder gets built.
- **The ladder runs downward too.** When a shared module is left with one consumer after a
  refactor, push it back down. Shared code with a single caller is indirection with no payoff.

The promotion trigger is a **second independent consumer**, not a guess that one might appear.
Speculative sharing is the most common form of over-engineering in frontend codebases, and
duplicating a twenty-line component for a while costs far less than the wrong abstraction.

## Layers and allowed imports

Whatever the folder names, a frontend has three layers and imports only ever flow **downward**.
Enforce it with a lint rule rather than a code-review habit; see
[references/boundaries.md](references/boundaries.md) for the config.

| Layer | Holds | May import from |
|---|---|---|
| `routes` / `app` | pages, layouts, providers, route-level composition | features, contracts, shared |
| `features` | one business domain each: its UI, hooks, model, api | contracts, shared — **never another feature** |
| `contracts` (optional) | types/schemas shared by several features | shared |
| `shared` | UI primitives, pure utils, configured clients, config | nothing above it |

The rule that does the real work is **no feature imports another feature.** When two features
need the same thing, that thing is not feature code — push it down into `shared` or
`contracts`, or compose both features at the route layer, which is allowed to know about
everything. Cross-feature imports are what turn a structured app back into a ball of mud, and
they are invisible in review because each individual import looks reasonable.

For projects that need a stricter, more granular version of this model — many teams, hundreds
of modules — Feature-Sliced Design formalises it into six layers. Do not adopt it by default;
[references/boundaries.md](references/boundaries.md) explains when it starts paying for itself.

## Where each kind of thing goes

| Artifact | Default home | Moves to shared when | Smell it is misplaced |
|---|---|---|---|
| Component | folder of the component that renders it | a second feature renders it | it lives in `src/components` but only one route imports it |
| UI hook | next to its component | two components use it | a `hooks/` folder where most files have one importer |
| Data hook | the feature's `api/` (or `lib/hooks`) | the endpoint serves several features | a component calls `fetch` directly |
| Domain constant | the module that owns the meaning | two features assert on the same value | the same literal appears in three files |
| Config / env | one typed module, always shared | — from the start | `process.env.X` read in a component |
| Pure util | next to its caller | a second unrelated caller | `utils/index.ts` with 40 unrelated exports |
| Domain helper | inside the feature, always | it stops being domain-aware | a "helper" in `shared` that imports a feature type |
| Type | next to the contract it describes | several features speak it | a global `types/` folder mirroring the app |
| Business rule | a pure module in the feature | it is domain-generic | rules written inline in JSX |
| Test | next to its subject | never — tests do not get shared | a `__tests__/` tree mirroring `src/` |
| User-facing string | the i18n message file | — by definition | a string literal in JSX |

Per-artifact rules, with before/after examples and the utils-vs-helpers criterion spelled out,
are in [references/placement-rules.md](references/placement-rules.md).

## Splitting components

Size is a symptom, not a criterion. A 300-line form with one reason to change is healthier
than three 40-line components that must always be edited together. Split on **reasons to
change**, which show up as these concrete signals:

- a block owns state that nothing outside it reads
- a block has its own loading / error / empty branch
- a block needs `'use client'` while the rest of the tree does not — in Next.js this is a
  genuine architectural seam, not a style preference
- you want to test the block without mounting its parent
- the same JSX shape is rendered twice with different data

Equally, resist splitting when the only motivation is a line count, when the extracted piece
would have exactly one consumer and no independent identity, when the new component just
forwards props, or when it only calls a hook and returns `null` — call the hook directly.

Composition beats configuration: a component that takes `children` or named slots stays
reusable, while one that grows a seventh boolean prop is being asked to be two components.
[references/component-architecture.md](references/component-architecture.md) covers the
splitting patterns and the prop-drilling escape routes.

## Where business logic lives

Business logic in a component body is the default failure mode, because it is the path of
least resistance. Separate it into three tiers that each have a different testing story:

1. **Rules** — pure functions: no React, no IO, no network. `canRerun(run)`,
   `scoreFromFindings(findings)`. They live in the feature, next to the data they describe, and
   are the cheapest code in the app to test.
2. **Orchestration** — hooks: state, effects, cache, calling the rules, calling the API. This
   is where React-specific concerns belong, and the only tier that needs a React test renderer.
3. **Rendering** — components: take data and callbacks, return JSX, hold only UI state.

The reason for the split is that tiers 1 and 3 are the parts you change most often, for
completely unrelated reasons — a pricing rule changes because the business changed, a layout
changes because design changed. Keeping them in one file couples two independent change
frequencies.

A separate framework-agnostic "service layer" is usually unnecessary on top of this: tier 1 is
already framework-agnostic. Add one only when non-React callers exist — a CLI, a worker, a
second app — or when the logic must outlive the framework choice.

In Next.js, server-side data access is its own tier: a `server-only` module that performs
authorization and returns narrow DTOs, not ORM rows. See
[references/nextjs-app-router.md](references/nextjs-app-router.md).

## Anti-patterns worth naming

Named things get caught in review. These are the recurring ones:

- **The `utils/` dumpster** — a folder defined by what its contents are *not*. It never
  shrinks, and nothing in it can be safely deleted because ownership is nobody's. Fix by
  splitting on subject (`date.ts`, `diff.ts`) and pushing domain-aware entries back into
  features.
- **Barrel as public API** — `index.ts` files that re-export everything. They make imports
  prettier and cost you tree-shaking, `tsc` throughput, and a class of
  `Cannot access 'X' before initialization` cycles that is genuinely hard to debug. Justify
  each barrel; do not add them by reflex.
- **`components/` that isn't shared** — a top-level folder used as "components I wrote",
  containing route-specific UI. It defeats the whole point of having a shared layer.
- **Cross-feature reach-in** — `features/reviews` importing `features/repos/lib/x`. Each such
  import looks harmless and together they delete your module boundaries.
- **Speculative shared** — an abstraction created for a second consumer that never arrives.
- **The global `types/` folder** — types divorced from the code that produces them drift
  silently, because nothing fails when they do.
- **Fat route file** — a `page.tsx` holding data fetching, transformation and layout. Routes
  should compose; the code being composed lives in features.
- **Folder-type scaffolding** — `components/ hooks/ utils/ types/` created inside a feature
  that has one file of each. Add the folder when the second file arrives.

## Review checklist

When reviewing structure — yours or someone else's — these seven questions find most of it:

1. Does every file in a shared folder have at least two independent consumers?
2. Does any feature import another feature?
3. Can you delete a feature folder without breaking unrelated screens?
4. Is there business logic that cannot be tested without rendering a component?
5. Does any component read `process.env` or call `fetch` directly?
6. Do the folder names describe the product, or only the framework?
7. Is a barrel file the reason an import graph is circular?

## Where to read next

| Question | File |
|---|---|
| Where exactly does a constant / util / type / hook go? | [references/placement-rules.md](references/placement-rules.md) |
| Layers, lint enforcement, barrels, and is FSD worth it? | [references/boundaries.md](references/boundaries.md) |
| How do I cut this component apart, and where does the logic go? | [references/component-architecture.md](references/component-architecture.md) |
| How does all this map onto the App Router? | [references/nextjs-app-router.md](references/nextjs-app-router.md) |
| What does this mean in *this* repo's `client/`? | [references/devdigest-client.md](references/devdigest-client.md) |

Adjacent skills, for the questions this one deliberately does not answer: **react-best-practices**
(how to write components, hooks and state) and **next-best-practices** (App Router runtime,
RSC boundaries, rendering and data-fetching mechanics). Sources behind every claim here are
listed in [README.md](README.md).
