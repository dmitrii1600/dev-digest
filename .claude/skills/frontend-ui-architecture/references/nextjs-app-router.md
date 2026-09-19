# Architecture in the Next.js App Router

Next.js is deliberately unopinionated about project organisation — it gives you mechanisms
(colocation, private folders, route groups) and leaves the structure to you. This file covers
how the placement rules from `SKILL.md` land on those mechanisms.

For runtime behaviour — rendering, caching, streaming, async APIs — see the
**next-best-practices** skill. This file is only about where code lives.

## Contents

- [`app/` is routing, not storage](#app-is-routing-not-storage)
- [Colocation inside a segment](#colocation-inside-a-segment)
- [Private folders and route groups](#private-folders-and-route-groups)
- [The three official strategies](#the-three-official-strategies)
- [Keep the page thin](#keep-the-page-thin)
- [The data access layer](#the-data-access-layer)
- [Where Server Actions live](#where-server-actions-live)
- [The `'use client'` boundary as structure](#the-use-client-boundary-as-structure)

## `app/` is routing, not storage

Folders under `app/` define URL segments. That is their whole job. A route becomes public only
when the segment contains a `page` or `route` file — which is why everything else can sit
safely beside it without becoming a URL.

The mistake this enables is treating `app/` as the place all code goes, so that the URL
hierarchy ends up dictating the module hierarchy. They are different questions: `/settings/
[section]` is a routing fact, while "the settings editor and its validation rules" is a module
fact. Where they coincide, colocate. Where they do not — code used by three unrelated routes —
the code belongs in a feature or shared folder, not hoisted into whichever route happened to
need it first.

## Colocation inside a segment

Because only `page`/`route` make a segment routable, you can keep a route's components, hooks,
helpers, tests and styles directly beside it:

```
app/repos/[repoId]/pulls/[number]/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── FindingsPanel/
    └── RunHistory/
```

This is the App Router's best structural property and the reason route-colocation is a
legitimate architecture rather than a shortcut: everything a screen needs is in one place, and
deleting the route deletes its code. Treat a route segment as a feature folder that happens to
have a URL.

## Private folders and route groups

Two mechanisms, two different jobs:

**`_folder`** opts a folder and everything under it out of routing. Colocation works without
it, so this is about intent and safety rather than necessity — it marks a folder as
implementation detail, keeps internal files grouped in the editor's sort order, and (the
practical reason) removes any chance of colliding with a future Next.js file convention. Using
it consistently means you never have to think about whether `components` might one day become
reserved.

**`(group)`** organises routes without adding a URL segment. Its uses:

- grouping by section, intent or owning team — `(marketing)`, `(app)`, `(admin)`;
- giving a subset of routes a shared layout, or a `loading.tsx` that applies to one route
  instead of all its siblings;
- multiple root layouts, when sections of the product have genuinely different chrome.

Together they keep `app/` readable: parentheses say "organisation", underscores say "not a
route", and everything else is a real URL segment.

## The three official strategies

The Next.js docs describe three, and the pragmatic answer is usually a mix:

1. **Project files outside `app/`** — `app/` holds only routing; all code lives in `src/
   features`, `src/components`, `src/lib`. Cleanest separation; loses colocation.
2. **Project files in top-level folders inside `app/`** — shared folders live at the root of
   `app/`. Fewer top-level directories; the shared/route distinction gets blurry.
3. **Split by feature or route** — globally shared code at the `app/` root, route-specific code
   inside the segment that uses it.

Strategy 3 is what the placement ladder produces naturally, and it is the recommended default:
colocate in the segment, promote to a shared location when a second route needs it. Strategy 1
is the better choice when a large share of the code is not route-bound — heavy domain logic,
a design system, code shared with another app.

The docs' own summary is the right one: pick a strategy and be consistent. Mixing them
per-developer is worse than any of the three.

## Keep the page thin

A `page.tsx` should read like a table of contents: resolve params, call the data layer, compose
components, set metadata. Everything else belongs in the code it composes.

```tsx
// ✓ page composes
export default async function PullPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  const pull = await getPullDTO(number)
  return (
    <>
      <PrDetailHeader pull={pull} />
      <Suspense fallback={<FindingsSkeleton />}>
        <FindingsPanel pullId={pull.id} />
      </Suspense>
    </>
  )
}
```

The reason is not aesthetic. A page is the one module you cannot import from anywhere else, so
anything living there is unreachable by tests and unreusable by definition. Logic in a page is
logic you have decided not to test.

## The data access layer

For new projects Next.js recommends a dedicated **Data Access Layer**: an internal module that
is the only thing which touches the database or an upstream API. It is an architectural
recommendation with a security payoff, and the structural rules are what make it work:

- **It runs only on the server.** `import 'server-only'` at the top turns any accidental client
  import into a build error rather than a leak.
- **It performs authorization.** Not the page, not the component — a page-level check does not
  extend to a Server Action defined inside that page, so each entry point re-verifies via the
  layer.
- **It returns DTOs, not rows.** Narrow objects containing what the UI needs. Returning an ORM
  model means every field it gains later is silently exposed the moment that object crosses to
  a Client Component.
- **It is the only reader of `process.env` for secrets.** One module to audit.

```ts
// data/pull-dto.ts
import 'server-only'

export async function getPullDTO(number: string) {
  const viewer = await getCurrentUser()
  const row = await db.pull.findUnique({ where: { number } })
  return {
    id: row.id,
    title: row.title,
    authorEmail: canSeeEmail(viewer, row) ? row.authorEmail : null,
  }
}
```

Note what this replaces: calling your own `/api` route over HTTP from a Server Component. That
adds a network hop and a second place where authorization has to be right. Server code calls
the layer directly; only Client Components need a Route Handler or Server Action as a bridge.

Next.js names three data-fetching approaches — external HTTP APIs (existing apps with an
established backend), a DAL (new projects), and component-level access (prototypes only) — and
advises picking one rather than mixing, so that both developers and auditors know what to
expect. Mixing is how one component ends up being the single unguarded path to a table.

Where the API lives in a *separate* service, as in a classic Next-over-REST setup, the same
shape applies with the boundary moved: one typed client module owns transport and auth, and
nothing else in the app speaks HTTP.

## Where Server Actions live

Actions are entry points, so treat them like route handlers rather than like component code:

- Put them in their own module (`actions.ts`) next to the feature that owns them, marked
  `'use server'`. An exported action is reachable by a direct POST whether or not your UI calls
  it, so it needs the same discipline as an endpoint.
- Keep them thin: validate input, delegate to the data access layer, revalidate. The layer owns
  auth and the database; the action owns the HTTP-shaped concerns.
- Re-verify the caller inside the action. The page's check guards which UI renders, not who can
  invoke the action.
- Return only what the UI needs — the return value is serialized to the client.

An action defined inline inside a component is fine for a one-off, but it closes over the
component's scope and those captured variables are sent to the client and back. That is a good
reason to keep anything non-trivial in its own module where the inputs are explicit.

## The `'use client'` boundary as structure

The directive marks where the server-rendered tree hands off to the browser bundle. It is a
placement decision with two consequences:

**Push it down.** Put `'use client'` on the smallest leaf that needs interactivity, never on a
page or layout. A page marked client drags its whole subtree into the bundle, and the
server-side capabilities of everything below it are lost.

**It is a data boundary too.** Server Components can read secrets, the database and the data
access layer; Client Components must be assumed to run in the browser even while they
pre-render on the server. So the seam decides which side of your app a module may live on —
which is why it often coincides with the fetch-and-narrow / render split described in
[component-architecture.md](component-architecture.md).

A structural tell: if a shared component folder contains modules that import `server-only`
alongside modules marked `'use client'`, the folder is holding two different kinds of code and
should be split.
