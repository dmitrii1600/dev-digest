# These rules, applied to `client/`

How the general rules land on this repo's Next.js app. Read this before adding anything to
`client/`; the conventions here are already close to the model, so the goal is to extend them
rather than to introduce a second scheme alongside.

Authoritative for commands and hard rules: `client/AGENTS.md`. This file only explains *why*
the layout is what it is, and where the ladder stops.

## The layer map

There is no `features/` directory, and that is correct: **the route segment is the feature.**
This is the route-colocated strategy from [boundaries.md](boundaries.md), and it fits because
essentially every screen here corresponds to one domain.

| Layer | Here | Notes |
|---|---|---|
| routes | `src/app/**/page.tsx` | thin; compose and delegate |
| feature | `src/app/**/_components/<Name>/` | the segment owns its UI, constants, tests |
| shared UI | `src/components/*` | crosses routes: `app-shell`, `diff-viewer`, `page-shell`, `run-cost-badge`, … |
| shared data | `src/lib/api.ts`, `src/lib/hooks/*` | the only network boundary |
| contracts | `src/vendor/shared` (`@devdigest/shared`) | Zod contracts; **server copy is canonical** |
| primitives | `src/vendor/ui` (`@devdigest/ui`) | do not hand-roll a primitive that exists here |

Import direction follows the general rule: a route may import anything below it; `src/
components` and `src/lib` must not import from `src/app`. There is no lint rule enforcing this
today — see [Gaps](#gaps).

## The promotion ladder, concretely

```
inside <Name>.tsx
  → sibling file in <Name>/                          e.g. constants.ts
    → the parent's _components/                      a second sibling needs it
      → the segment root's _components/              a second component in the route needs it
        → src/components/<kebab-name>/               a second route needs it
```

The nesting under `src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/`
is this ladder working, not accidental depth: `PromptModalBody` sits beside `PromptBlock`
because only `PromptBlock` renders it. Depth here is information — it tells you how narrowly
something is used. Do not flatten it for tidiness.

A component that reaches `src/components/` must also stop knowing about the domain, or it is
only physically shared. `run-cost-badge` is a fair borderline case: it knows about cost, but
cost appears on several routes, so the route layer is where it would otherwise be duplicated.

## Conventions that carry behaviour

- **`_components/<Name>/<Name>.tsx` + `<Name>.test.tsx`.** Folder, file and exported component
  share one name; the test is the folder's own. Naming the file after the component (not
  `index.tsx`) is what keeps editor tabs readable at this nesting depth.
- **A component folder carries its own segments.** The established set, by frequency:
  `constants.ts` (17), `styles.ts` (23), `helpers.ts` (9), `<Name>.test.tsx`, and a nested
  `_components/` when it has children. Each is the local-scope rung of the ladder for that kind
  of artifact, so reach for the file in the folder before reaching for anything shared.
  (`atoms.tsx` under `RunTraceDrawer/_components/` is a one-off, not a convention to copy.)
- **`index.ts` forwards, it does not aggregate.** All 30 `index.ts` files under `src/app` are
  single-component re-exports (`export { PromptBlock } from "./PromptBlock"`), and **none** uses
  `export *`. That is the benign form: it keeps imports clean without dragging a module graph
  along. Keep it that way — a forwarding file is fine, an aggregating barrel is the thing
  [boundaries.md](boundaries.md) warns about.
- **No `fetch` in a component.** Data comes from `src/lib/hooks/*`, which goes through
  `src/lib/api.ts`. The app currently holds to this — there is no raw `fetch` under `src/app` or
  `src/components`. A new endpoint gets a new hook there, not a call at the call site.
- **No `process.env` outside `src/lib`.** Also currently true. `NEXT_PUBLIC_API_BASE` is read in
  one place.
- **No hardcoded user-facing text.** Strings live in `messages/en/<namespace>.json`, one file
  per namespace, read via `next-intl`. Namespaces exist for lesson features that are not built
  yet — an empty namespace is expected, not a bug.
- **Contracts come from `@devdigest/shared`.** Never re-declare an API payload type locally.
  `src/lib/types.ts` is mostly a re-export shim over the vendored contracts, which is a
  legitimate boundary artifact — but it has already acquired one locally-declared interface
  (`PrRowView`), and that is the global-types anti-pattern starting. A view model belongs with
  the view that uses it; keep the shim a shim.
- **`src/vendor/*` is read-only.** `shared` is a mirror of the server's canonical copy and the
  two have already drifted. Fix a contract on the server first, then mirror; a typecheck in one
  package cannot see drift in the other.

## Gaps

Honest notes, not a work order — nothing here needs changing to use this skill.

- **Boundaries are unenforced.** `src/components` importing from `src/app` would pass lint
  today. If a rule is ever added, `import/no-restricted-paths` with the `shared ← app` zone is
  the smallest useful version; ESLint here is deliberately narrow (it covers what `tsc` cannot
  see), so this would fit that remit.
- **`src/lib/hooks/index.ts` is the app's only `export *` barrel.** It aggregates five domain
  files, and both import paths (`@/lib/hooks` and `@/lib/hooks/reviews`) are in use. It is small
  enough not to matter today, but it is exactly the shape [boundaries.md](boundaries.md) warns
  about — prefer the direct domain path in new code, and do not add a second aggregating barrel.
- **`src/components/showcase`** is a demo surface rather than shared product UI. Worth knowing
  before treating everything under `src/components` as a reusable primitive.

## Checklist for a new screen here

1. Does the route segment exist? If not, `app/<segment>/page.tsx` — thin.
2. Data: is there a hook in `src/lib/hooks/*`? If not, add one there, on top of `src/lib/api.ts`.
3. UI: `_components/<Name>/<Name>.tsx`, with `<Name>.test.tsx` and an `index.ts` that forwards
   that one component.
4. In that same folder as needed: `constants.ts` for named values, `styles.ts` for styling,
   `helpers.ts` for domain-aware functions, nested `_components/` for children.
5. Text: a namespace in `messages/en/`, read with `useTranslations`.
6. Primitives: from `@devdigest/ui`. Types: from `@devdigest/shared`.
7. `'use client'` on the smallest interactive leaf, never on the page or layout.
