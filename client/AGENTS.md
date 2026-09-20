# @devdigest/web — module map

Next.js 15 App Router studio over the Fastify API. Route map and the API surface
each page leans on → `./README.md` — **read before adding a route or a data
hook**.

## Commands

```sh
pnpm dev          # :3000
pnpm build
pnpm test         # vitest + jsdom, fetch mocked — no API needed
pnpm typecheck
pnpm lint         # eslint — mainly react-hooks; see ../AGENTS.md#commands
```

## Layout

`src/app/**/page.tsx` thin pages · `_components/<Name>/` colocated feature code
with its own `*.test.tsx` · `src/lib/api.ts` the single fetch wrapper ·
`src/lib/hooks/*` TanStack Query hooks · `src/providers/*` the app-wide provider
stack (React Query, theme, toast, active repo) · `src/components/app-shell` nav,
breadcrumbs, `g`-then-key shortcuts · `src/vendor/ui` (`@devdigest/ui`) UI
primitives · `src/vendor/shared` (`@devdigest/shared`) contracts.

## Conventions

- **Server Components by default.** `'use client'` goes on the smallest leaf that
  needs interactivity, not on a page or layout.
- **No `fetch` in a component.** Data comes from a hook in `src/lib/hooks/*`,
  which goes through `src/lib/api.ts`. A new endpoint gets a new hook there.
- **No hardcoded user-facing text.** Strings live in `messages/en/<namespace>.json`
  and are read via `next-intl`.
- **UI primitives come from `@devdigest/ui`.** Do not add another component
  library or hand-roll a primitive that already exists there.
- **Cross-folder imports use `@/`.** Relative paths are for siblings and the
  folder's own subtree; anything that climbs out of it uses the alias, so a
  module's consumers are findable with one grep.
- **Shared code never imports a route.** `src/components` and `src/lib` may not
  import `src/app` — enforced by `no-restricted-imports` in `eslint.config.mjs`.
- Types for API payloads come from `@devdigest/shared`, never re-declared locally.
- A feature folder owns its tests: `_components/<Name>/<Name>.test.tsx`.

## Do not touch

- `.next/` — build output.
- `src/vendor/ui` and `src/vendor/shared` — vendored trees. `shared` mirrors the
  server's canonical copy; fix contracts there first, then mirror.
  **Exception: `src/vendor/ui/nav.ts`.** Unlike the rest of `vendor/ui`, `nav.ts`
  has no canonical upstream to drift from — the "do not touch" there exists to
  stop hand-rolled primitives, not to freeze the nav registry. The app owns it;
  edit it directly when adding a route to the sidebar (say so in the commit).

## Gotchas

- `messages/en/` already contains namespaces for unbuilt lesson features
  (`blast`, `brief`, `eval`, `memory`, …). Empty namespaces are expected.
- `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001`; the API's CORS
  origin is driven by `WEB_PORT` on the server side.
- Component tests never hit the network — the real browser journeys live in
  `../e2e`, not here.

## Read when

- How data and styles reach a component (hook → `lib/api.ts`, the `SEV` token
  map, ICU plurals) → `docs/data-flow.md` — **read before adding a screen, a
  hook, or a severity-coloured element**
- Real browser journeys and what they cover → `../e2e/README.md`
- API contracts and route shapes → `../server/README.md#api-map-starter`
- Test strategy → `../TESTING.md`
- Feature specs → `specs/` · learned decisions → `INSIGHTS.md` — **read it before
  changing code here**, and run `/engineering-insights` at the end of the task to
  append what this session learned
