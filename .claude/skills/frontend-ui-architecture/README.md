# frontend-ui-architecture

**Version 1.0.0** · 2026-09-18

A skill about **where frontend code lives and what it may import** — placement, layering and
module boundaries for React and Next.js apps.

## Scope

**Covers**

- the colocation principle and the shared-vs-local promotion ladder
- the layer model (`shared → contracts → features → routes`) and unidirectional imports
- where components, hooks, constants, config, utils, helpers, types, business rules, API
  access, styles, tests, strings and assets go
- when and how to split a component; where business logic belongs
- Next.js App Router organisation: route colocation, private folders, route groups, the data
  access layer, the `'use client'` seam
- enforcement (`import/no-restricted-paths`), barrel files, and when Feature-Sliced Design
  is worth its ceremony

**Deliberately does not cover** — these have their own skills, and duplicating them would
create two sources of truth that drift:

| Question | Skill |
|---|---|
| How do I write this component / hook / piece of state? | `react-best-practices` |
| How does the App Router behave at runtime — rendering, caching, RSC mechanics? | `next-best-practices` |
| How do I test a component? | `react-testing-library` |

Performance is out of scope by design. Render counts, memoisation and bundle size are
architecture-adjacent but they are optimisation questions, and mixing them in turns every
placement decision into a performance debate.

## Files

```
frontend-ui-architecture/
├── SKILL.md                             # the spine: principles, layer model, placement table
├── README.md                            # this file — scope, version, sources
└── references/
    ├── placement-rules.md               # per-artifact rules with before/after
    ├── boundaries.md                    # layers, ESLint enforcement, barrels, FSD
    ├── component-architecture.md        # splitting, composition, business-logic tiers
    ├── nextjs-app-router.md             # App Router organisation and the DAL
    └── devdigest-client.md              # how it all maps onto this repo's client/
```

`SKILL.md` is self-sufficient for most questions; the references are read on demand.

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-09-18 | Initial release. Spine + five reference files, built on the sources below. |

## Sources

Grouped by what each contributed. Sources marked **read in full** were fetched and read while
writing this skill; the rest were located by search and their URLs verified to resolve.

### Structure and project layout

| Source | What came from it |
|---|---|
| [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) · *read in full* | the `shared → features → app` layer model, the per-feature folder shape, the `import/no-restricted-paths` config, "avoid barrel files to preserve tree-shaking" |
| [bulletproof-react — project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) | enforcing conventions with tooling rather than review habits |
| [Robin Wieruch — React Folder Structure](https://www.robinwieruch.de/react-folder-structure/) · *read in full* | the flat → type-based → feature-based progression; promotion and demotion between shared and feature scope |
| [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) · *read in full* | one folder per component named after the component; the utils-vs-helpers distinction; "the most important thing is that you *have* a convention" |
| [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) | corroboration on conventions and tooling |
| [dangz.dev — How to structure a React app](https://dangz.dev/blog/how-to-structure-a-react-app-in-2026) | contemporary framing of ownership and domain boundaries |
| [reboot — 4 folder structures to organize a React project](https://reboot.studio/blog/folder-structures-to-organize-react-project) | the comparison table of structures |

### Colocation

| Source | What came from it |
|---|---|
| [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) · *read in full* | the core principle, its three benefits (maintainability, applicability, ease of use), and the e2e-tests exception |
| [Kent C. Dodds — State Colocation](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) | colocated state as a maintenance win first, a performance win second |
| [Kent C. Dodds — Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react) | server cache vs UI state; composition and lifting before global state |
| [React — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) | Context as dependency injection, not a prop-drilling patch |

### Boundaries and enforcement

| Source | What came from it |
|---|---|
| [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) · *read in full* | layers / slices / segments; "import only from layers strictly below"; the six-layer list |
| [FSD — Usage with React Query](https://feature-sliced.design/docs/guides/tech/with-react-query) | where data-access code sits relative to UI in a layered model |
| [codecentric — Feature-Sliced Design and good frontend architecture](https://www.codecentric.de/en/knowledge-hub/blog/feature-sliced-design-and-good-frontend-architecture) | an outside assessment of when FSD's ceremony is justified |
| [Nx — Enforce Module Boundaries](https://nx.dev/docs/features/enforce-module-boundaries) · [ESLint rule guide](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries) | tag-based boundary enforcement as the monorepo equivalent |
| [Barrel files: why index.ts re-exports hurt tree shaking, Next.js dev memory and tsc](https://dev.to/childrentime/barrel-files-why-indexts-re-exports-hurt-tree-shaking-nextjs-dev-memory-and-tsc-2026-3kpm) | the three concrete costs of barrels, including the `Cannot access 'X' before initialization` failure mode |

### Business logic and components

| Source | What came from it |
|---|---|
| [React — Thinking in React](https://react.dev/learn/thinking-in-react) | decomposition by single responsibility; where state should live |
| [React — Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) | avoiding duplicated and derivable state |
| [React — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | derive during render rather than sync with an Effect — the reason tier-2 orchestration does not store computed values |
| [Felix Gerschau — Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) | hooks as the orchestration tier between pure logic and rendering |
| [Atomic Design in React](https://medium.com/@janelle.wg/atomic-design-pattern-how-to-structure-your-react-application-2bb4d9ca5f97) | the atomic-design position, and why it belongs to design systems rather than app code |

### Next.js

| Source | What came from it |
|---|---|
| [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) · *read in full* | colocation guarantees, `_private` folders, `(route groups)`, the three official organisation strategies, "choose a strategy and be consistent" |
| [Next.js — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) | grouping without URL impact; per-group layouts and multiple root layouts |
| [Next.js — Data Security](https://nextjs.org/docs/app/guides/data-security) · *read in full* | the Data Access Layer: `server-only`, authorization inside the layer, DTOs over ORM rows, only the DAL reads secret env vars, re-verify inside Server Actions, control action return values |
| [Next.js — How to Think About Security in Server Components and Actions](https://nextjs.org/blog/security-nextjs-server-components-actions) | the reasoning behind treating actions as public entry points |
| [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | the `'use client'` seam and environment poisoning |
| [React — Server Components](https://react.dev/reference/rsc/server-components) | the server/client module-system split |
| [Sentry — Next.js directory organisation best practices](https://sentry.io/answers/next-js-directory-organisation-best-practices/) | corroboration on colocation and route groups |

### Data layer

| Source | What came from it |
|---|---|
| [TkDodo — Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys) | query-key factories per resource as the invalidation contract |
| [Query keys: patterns for scaling TanStack Query](https://daily.dev/posts/query-keys-patterns-for-scaling-tanstack-query-iu21mq1nw) | the hierarchical `all / lists / detail` key shape |

### Considered and dropped

- `profy.dev` — *Path to a Clean(er) React Architecture: Business Logic Separation*. Covers the
  service-layer-vs-hooks question well, but the host did not respond when checked, so nothing
  in this skill rests on it.
- `lukemorales/query-key-factory` in the TanStack docs — the current docs URL 404s; the TkDodo
  article above covers the same ground and is maintained.
- Several Medium reposts of the barrel-file and folder-structure arguments — same content as
  the sources kept above, behind a metered paywall.
