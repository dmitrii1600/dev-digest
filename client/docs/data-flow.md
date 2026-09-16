# How data and styles reach a component

The three rules a new screen in `@devdigest/web` has to follow, and the reasons
behind them. The route map lives in `../README.md`; this is the "how", not the
"what".

## Data: route → hook → `lib/api.ts`

There is exactly one path from a component to the API, and no component is
allowed to shortcut it:

```
src/app/**/page.tsx          thin; resolves params, renders feature components
  └─ src/lib/hooks/*.ts      one TanStack Query hook per endpoint
       └─ src/lib/api.ts     the single fetch wrapper (API_BASE, ApiError)
            └─ Fastify
```

A component never calls `fetch`. A new endpoint gets a new hook in
`src/lib/hooks/`, and the hook is what components import.

The payoff is that the query key becomes a shared cache, not an implementation
detail. Concretely: the PR list's hover preview calls `usePrReviews(prId)` with
`enabled` tied to hover. That is keyed `["reviews", prId]` — the same key the PR
detail page uses — so hovering a row warms the cache and the click that follows
renders instantly, with no second request and no prefetch machinery. Had the
preview fetched directly, it would have been a duplicate request and a duplicate
cache.

Two consequences worth stating:

- **Lazily-enabled hooks are the way to defer work**, not `useEffect` +
  `setState`. `enabled: false` means nothing is requested until it is wanted.
- **Do not widen a list payload to feed a hover.** `PrMeta` carries counts, not
  findings; the findings arrive from the endpoint that already owns them.

Types for every payload come from `@devdigest/shared`
(`src/vendor/shared`) and are never re-declared locally. That tree mirrors the
server's canonical copy — fix a contract there first, then mirror.

## Styles: tokens, then a co-located `styles.ts`

Tailwind is installed, but feature code does not use utility classes. Components
style through inline `style={}` objects that reference CSS custom properties,
collected in a co-located `styles.ts` exporting `const s = { … }`.

Colours never appear as literals. They come from the token set in
`src/vendor/ui/styles.css` (`--crit`, `--warn`, `--sugg`, `--text-muted`, …), or
from the maps in `src/vendor/ui/primitives/tokens.ts` — `SEV` for severities and
`CAT` for finding categories. `SEV` is canonical: it holds the colour, the
background, the icon name and the label for each severity together, so a new
severity chip inherits all four and cannot drift from the ones already on screen.
There are already a couple of local `SEV_COLOR` copies in the codebase; do not
add a third.

Two accessibility rules the primitives encode, worth keeping when you hand-roll:

- Severity is **never** signalled by colour alone — always icon plus text.
- A toggled control carries `aria-pressed` and a non-colour affordance (an
  outline, an underline), because colour is already doing the job of naming the
  severity.

## Strings: `messages/en/<namespace>.json`

No hardcoded user-facing text. Each namespace is its own file, read via
`useTranslations("<namespace>")`, and `src/i18n/request.ts` merges every file in
the folder — so a feature adds its own namespace with no shared-file contention.

Counts go through ICU plurals rather than string concatenation, e.g.
`"{count, plural, one {# FINDING IN THIS RUN} other {# FINDINGS IN THIS RUN}}"`.

Labels that belong to the design system (severity names, category names) come
from `SEV` / `CAT`, not from message files — one source, not two.

## Tests

Component tests run under vitest + jsdom with `fetch` mocked; they never hit the
network. Hooks are `vi.mock`ed, and the **real** `messages/en/*.json` is passed
to `NextIntlClientProvider` so assertions run against production strings — a
test that invents its own copy will keep passing after someone edits the UI text.

Real browser journeys live in `../../e2e`, not here.
