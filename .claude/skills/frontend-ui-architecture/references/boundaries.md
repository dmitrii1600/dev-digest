# Boundaries: layers, enforcement, barrels, and FSD

Folder structure is a suggestion; **import rules** are the architecture. This file covers the
layer model, how to make a machine enforce it, why barrel files quietly undermine it, and when
a heavier methodology like Feature-Sliced Design starts paying for itself.

## Contents

- [The layer model](#the-layer-model)
- [Enforcing it with ESLint](#enforcing-it-with-eslint)
- [What to do when two features need the same thing](#what-to-do-when-two-features-need-the-same-thing)
- [Barrel files](#barrel-files)
- [Feature-Sliced Design](#feature-sliced-design)
- [Choosing a structure](#choosing-a-structure)

## The layer model

```
  routes / app        pages, layouts, providers, route composition
       ↓
  features            one business domain each
       ↓
  contracts           schemas and types several features speak (optional)
       ↓
  shared              UI primitives, pure utils, configured clients, config
```

Imports flow strictly downward. Concretely:

| From ↓ / To → | shared | contracts | features | routes |
|---|---|---|---|---|
| **routes** | ✓ | ✓ | ✓ | — |
| **features** | ✓ | ✓ | ✗ | ✗ |
| **contracts** | ✓ | — | ✗ | ✗ |
| **shared** | — | ✗ | ✗ | ✗ |

Three properties fall out of this, and they are the reason to bother:

- **Deletability.** A feature folder can be removed without touching unrelated screens. If it
  cannot, something reached in.
- **Predictable blast radius.** Changing a feature cannot break another feature. Changing
  `shared` can break everything — which is exactly why promotion into it should be earned.
- **No cycles by construction.** A downward-only graph is acyclic, so you never debug
  `Cannot access 'X' before initialization` caused by module-init order.

The single most important row is `features → features: ✗`. Everything else is bookkeeping;
this one is what keeps a large app from collapsing back into a ball of mud. It is also the one
that erodes invisibly, because each individual cross-feature import looks entirely reasonable
at the moment someone writes it.

## Enforcing it with ESLint

A boundary that only lives in a document is a boundary that decays. `import/no-restricted-paths`
turns each arrow above into a build error. The shape below is the one bulletproof-react ships:

```js
// eslint.config.js
'import/no-restricted-paths': [
  'error',
  {
    zones: [
      // 1. features cannot reach into each other
      { target: './src/features/auth',    from: './src/features', except: ['./auth'] },
      { target: './src/features/reviews', from: './src/features', except: ['./reviews'] },
      // …one zone per feature

      // 2. features cannot import the app/route layer
      { target: './src/features', from: './src/app' },

      // 3. shared cannot import anything above it
      {
        target: ['./src/components', './src/hooks', './src/lib', './src/types', './src/utils'],
        from:   ['./src/features', './src/app'],
      },
    ],
  },
],
```

Note the per-feature zone in group 1: the rule expresses "nobody in `features/` may import
`features/auth`, except `features/auth` itself". It needs one entry per feature, which is
mildly annoying and worth automating — a small script that reads the directory listing keeps it
honest as features are added.

In a monorepo with a task graph, `@nx/enforce-module-boundaries` expresses the same idea with
tags on projects rather than paths, and additionally checks `package.json` dependencies. Use
whichever matches how the code is actually split; the rule you want is identical.

A note on adoption: turning this on in an existing codebase produces a wall of errors. Land it
as `warn` first, fix by layer from the bottom up (`shared` violations first — they are usually
the smallest set and the most diagnostic), then flip to `error`.

## What to do when two features need the same thing

This is the decision the boundary forces, and there are only three honest answers:

1. **It is generic** — push it down to `shared`. Test: strip every domain noun from its name
   and signature. If it still makes sense, it belongs there.
2. **It is a shared domain concept** — it is not feature code at all. Either it moves into
   `contracts`, or the two "features" were one feature split along the wrong seam and should be
   merged.
3. **They only need to appear together** — compose them at the route layer, which is allowed to
   import both. This covers most cases that feel like they need a cross-feature import.

The answer that is never right is adding the import and moving on. Notice that option 2
frequently means your feature boundaries were drawn wrong — repeated pressure to cross a
boundary is evidence about the boundary, not about the rule.

## Barrel files

A barrel is an `index.ts` whose only job is re-exporting its neighbours so callers can write
`import { Button, Card } from '@/components'`.

**What they buy:** a stable public surface for a module, so internals can be rearranged without
touching callers, and shorter imports.

**What they cost, at scale:**

- **Tree-shaking.** Importing one symbol pulls the whole barrel into the module graph. Bundlers
  can often shake it back out, but `export *` and any module with side effects defeat that, and
  you will not notice until the bundle report does.
- **Type-check and dev-server time.** Every barrel import makes the compiler walk everything the
  barrel re-exports. In a large app this compounds into meaningfully slower `tsc` runs and a
  hungrier dev server; Next.js added `optimizePackageImports` specifically to route around it.
- **Cycles.** Barrels are the most common cause of import cycles, because a module importing its
  own sibling through the barrel imports itself transitively. The symptom —
  `Cannot access 'X' before initialization` at runtime — points nowhere near the cause.

**Practical rule.** Add a barrel only where a folder is genuinely consumed as a unit from
outside — a design-system entry point, a published package, a feature's deliberate public API.
Never add one for internal implementation folders, and never `export *`. Inside a module,
import directly from the file. bulletproof-react states this flatly: avoid barrel files, to
preserve tree-shaking.

## Feature-Sliced Design

FSD is the formalised, stricter version of the model above. It organises code along three axes:

- **Layers** (scope of influence, fixed and ordered): `app` → `pages` → `widgets` → `features` →
  `entities` → `shared`. A module may import only from layers **strictly below** it — not from
  its own layer, not from above.
- **Slices** (business domain): the partition inside a layer — `user`, `repo`, `review`. Slices
  in the same layer may not import each other.
- **Segments** (technical purpose): the partition inside a slice — `ui`, `api`, `model`, `lib`,
  `config`.

So a path reads `features/review-run/ui/RunButton.tsx`: what scope, what domain, what kind.
Every import question has one mechanical answer, which is the real product FSD sells — no
debates, and a newcomer can place a file correctly on day one.

**What it costs.** Six layers is a lot of ceremony for a small app, and the `features` vs
`entities` vs `widgets` distinction is genuinely hard to apply consistently until the codebase
is large enough for the differences to bite. Teams that adopt it early tend to spend their
design discussions on classification rather than on the product.

**When it pays for itself:** several teams touching one frontend; enough modules that nobody
holds the map in their head; high contributor turnover; or an existing structure where
cross-imports have already become unmanageable. Below that, the three-layer model plus an
enforced lint rule gets most of the benefit for a fraction of the ceremony — and it migrates
into FSD cleanly later, because the core rule (import downward only) is the same.

## Choosing a structure

| Structure | Groups by | Good when | Fails when |
|---|---|---|---|
| Flat | nothing | prototypes, < ~20 files | any growth |
| Type-based (`components/ hooks/ utils/`) | what a file *is* | small apps, one developer | features grow — related code ends up in four folders |
| Feature-based | what a file *does* | most production apps | features are drawn along the wrong seams |
| Route-colocated | which URL needs it | Next.js App Router apps | code shared between routes has nowhere natural to go |
| FSD | scope × domain × purpose | large, multi-team | small teams: ceremony exceeds benefit |
| Atomic design | visual granularity | design systems and component libraries | application code — "is this an organism?" is unanswerable |

The pragmatic default for a Next.js product: **route-colocated for anything one route uses,
feature folders for domains spanning routes, a shared layer for genuinely generic code.** These
are complementary, not competing — route colocation is feature organisation where the route
*is* the feature.

Atomic design deserves a specific caveat: it classifies by visual complexity, which correlates
with nothing you make decisions about. It works inside a design system, where everything is
generic by construction. Applied to application code it produces endless argument about whether
something is a molecule or an organism, and the answer never changes what anyone does.

Whichever you pick, the thing that actually matters is that it is consistent and enforced. An
imperfect structure that a lint rule protects beats an elegant one that decays.
