# Placement rules, by artifact

One section per kind of file. Each gives the rule, the reason it holds, a before/after, and
the signal that tells you it has been broken.

The ladder from `SKILL.md` applies throughout: start local, promote one rung when a **second
independent consumer** appears, demote when consumers drop back to one.

## Contents

- [Components](#components)
- [Hooks](#hooks)
- [Constants](#constants)
- [Configuration and environment](#configuration-and-environment)
- [Utils vs helpers](#utils-vs-helpers)
- [Types](#types)
- [Business rules](#business-rules)
- [API access](#api-access)
- [Styles](#styles)
- [Tests and fixtures](#tests-and-fixtures)
- [User-facing strings](#user-facing-strings)
- [Assets](#assets)
- [When a feature folder needs subfolders](#when-a-feature-folder-needs-subfolders)

---

## Components

**Rule.** A component lives in the folder of whatever renders it, in its own directory named
after itself, together with everything only it uses.

```
FindingsPanel/
├── FindingsPanel.tsx
├── FindingsPanel.test.tsx
├── constants.ts            # only if the panel owns values worth naming
└── _components/
    └── SeverityPill/       # rendered only by FindingsPanel
        ├── SeverityPill.tsx
        └── SeverityPill.test.tsx
```

**Why.** The folder *is* the unit of ownership. Deleting the feature deletes the folder and
nothing is orphaned; opening the folder shows you every piece of the behaviour without a
search. Naming the file after the component (rather than `index.tsx` everywhere) matters more
than it sounds — twelve tabs all reading `index` is a real daily tax.

**Promotion.** When a sibling component needs `SeverityPill`, it moves up one level into the
parent's `_components/`. When a second *feature* needs it, and it carries no domain knowledge,
it becomes a shared primitive. A component that still knows about severities, review runs or
any other domain concept is not a primitive — a shared component that imports a feature type is
a boundary violation wearing a disguise.

**Signal it is misplaced.** A file in the shared components folder whose name contains a domain
noun, or which only one route imports.

## Hooks

Two kinds, and they behave differently.

**UI hooks** (`useDisclosure`, `useHotkey`, `useFocusTrap`) follow the ordinary ladder: next to
their component, promoted when a second component uses them.

**Data hooks** (`useReviewRuns`, `useRepoPulls`) belong to the data layer from the start —
whether that is `features/<name>/api/` or a shared `lib/hooks/` — because their placement is
driven by the endpoint they wrap, not by who renders them. An endpoint has exactly one correct
wrapper; letting two features write their own creates two cache keys for one resource and
mysterious stale-data bugs.

```ts
// ✗ the component owns the transport
function RunHistory({ pullId }) {
  const [runs, setRuns] = useState([])
  useEffect(() => { fetch(`/api/pulls/${pullId}/runs`).then(...) }, [pullId])
}

// ✓ the hook owns the transport, the component owns the rendering
function RunHistory({ pullId }) {
  const { data: runs, isPending, error } = useReviewRuns(pullId)
}
```

**Signal it is misplaced.** `fetch` or an HTTP client imported in a `.tsx` file; a `hooks/`
folder where most files have exactly one importer.

## Constants

**Rule.** A constant lives with the code that gives it meaning, at the narrowest scope where
that meaning holds.

```
module scope in the component file   value only this component asserts on
<Feature>/constants.ts               several files in the feature share it
src/config/<subject>.ts              the whole app shares it
```

**Why.** A constant is not just a value, it is a claim about the domain — `MAX_DIFF_LINES`
means something only where diffs exist. Hoisting it into a global `constants.ts` strips that
context, and a global constants file inevitably becomes a second dumpster: unrelated values in
one module that every part of the app imports.

Two supporting details:

- **Hoist out of the component body, not out of the file.** A `const SEVERITIES = [...]`
  declared inside the component is rebuilt on every render and breaks referential equality for
  anything downstream. Module scope in the same file fixes that without moving anything.
- **`SCREAMING_SNAKE_CASE` is for compile-time literals.** Values computed at runtime read as
  ordinary `camelCase` bindings; using the constant casing for them misleads the next reader
  into thinking the value is static.

**Signal it is misplaced.** The same literal (`'critical'`, `30_000`, `'/api/v1'`) appearing in
three files; a top-level `constants.ts` importing from a feature.

## Configuration and environment

**Rule.** Environment access is centralised in one typed module from the very first variable,
and nothing else in the app reads `process.env`.

```ts
// src/config/env.ts
export const env = {
  apiBase: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001',
  isProd:  process.env.NODE_ENV === 'production',
} as const
```

**Why.** This is the one artifact that is shared on day one rather than earned, because the
cost of getting it wrong is asymmetric. Scattered `process.env` reads give you no single place
to validate at boot, no type safety, and — in frameworks that bundle by prefix — no reliable
way to audit what leaked to the client. Parsing the whole environment once with a schema turns
a missing variable into a startup error instead of a `undefined` that surfaces in production.

Keep domain constants out of this module. `env` answers "where am I running"; `constants`
answer "what does the product mean". Mixing them means a deployment concern and a business rule
live in the same file and get changed by the same PR.

**Signal it is misplaced.** `process.env` outside `config/`; a secret readable from a
client-side module.

## Utils vs helpers

The two words get used interchangeably, which is why the folders fill with junk. Use a
criterion, not a feeling:

| | **util** | **helper** |
|---|---|---|
| Knows about your domain? | no | yes |
| Could be published as a package? | yes, plausibly | no |
| Imports feature types? | never | usually |
| Lives in | `shared` / `lib` | inside the feature |
| Tested | in isolation, no fixtures | with domain fixtures |

```ts
// util — knows nothing about this product
export function truncateMiddle(s: string, max: number): string

// helper — meaningless outside the review domain
export function groupFindingsBySeverity(findings: Finding[]): Record<Severity, Finding[]>
```

**Why the distinction earns its keep.** It makes the shared layer's contents predictable and
gives you a mechanical test for the dumpster problem: if a file in `utils/` imports a domain
type, it is a helper in the wrong place, and that is checkable by a lint rule rather than
taste. It also keeps the shared layer genuinely stable — domain code churns, generic code
does not.

**Signal it is misplaced.** `utils/index.ts` exporting a dozen unrelated functions; anything in
`shared` importing from `features`.

## Types

**Rule.** A type lives next to the thing it describes. Component props in the component file;
an API payload type wherever the contract is defined; a domain type in the feature that owns
the domain.

**Why.** A type's job is to stay true about something. Separated from that something, nothing
fails when it drifts — that is the entire failure mode, and it is silent. A global `types/`
folder mirroring the app is the worst version, because it guarantees every type is far from
its source of truth.

The one legitimate central location is a **contracts module** shared by producer and consumer —
a schema package both the API and the UI validate against. That is not a "types folder"; it is
a boundary artifact with an owner, ideally one where the schema generates the type rather than
the two being maintained in parallel.

**Signal it is misplaced.** `types/index.ts`; the same shape declared in both a component and
its hook.

## Business rules

**Rule.** Domain rules are pure functions in the feature, importing nothing from React.

```ts
// features/reviews/model/verdict.ts
export function verdictFor(findings: Finding[]): Verdict {
  if (findings.some(f => f.severity === 'critical')) return 'blocked'
  return findings.length > 0 ? 'changes-requested' : 'approved'
}
```

**Why.** This is the code with the longest life and the highest cost of being wrong, and as a
pure function it is testable with a table of inputs and no test renderer, no mounting, no
mocking. The moment the same rule is written inline in JSX it becomes testable only through
the UI, which is slower, flakier, and much less thorough in practice.

`model/` (or `logic.ts` for a single file) is the conventional name — the point is that it sits
beside the feature's UI rather than in a distant layer.

**Signal it is misplaced.** A conditional in JSX that a domain expert would recognise as a
policy; a test that renders a component to assert a calculation.

## API access

**Rule.** One module owns the transport — base URL, headers, auth, error shape, serialization —
and every request goes through it. Per-resource functions and their hooks sit on top of it.

```
src/lib/api.ts              the only place that knows about HTTP
features/reviews/api/       runReview.ts, useReviewRuns.ts — built on lib/api
```

**Why.** Cross-cutting concerns (auth refresh, error normalisation, tracing, cancellation) have
to be implemented once or they are implemented inconsistently. It also gives a single seam for
tests to mock.

If the project uses a server cache like TanStack Query, keep query keys in a **factory per
resource** rather than as inline arrays. Keys are the invalidation contract; when they are
literals scattered across files, a mutation eventually invalidates a key nobody else uses, and
the bug shows up as stale UI rather than an error.

**Signal it is misplaced.** Two modules building the same URL; an inline key array in a
component.

## Styles

**Rule.** Styles live as close to their markup as the styling system allows — a colocated
module/`.css` file next to the component, or utility classes in the JSX. Only design tokens
(colour scales, spacing, typography, severity→colour maps) are shared.

**Why.** Style is the part of a component most likely to change *with* its markup, so it is the
strongest colocation candidate in the codebase. Tokens are the exception precisely because
their value is consistency across features — that is what makes them shared by nature rather
than by promotion.

**Signal it is misplaced.** A global stylesheet containing selectors for one component; a hex
colour literal in a component that a token already names.

## Tests and fixtures

**Rule.** Unit and component tests sit next to their subject and share its name
(`FindingsPanel.tsx` ↔ `FindingsPanel.test.tsx`). Fixtures follow the same ladder as any other
code. End-to-end tests are the deliberate exception and live at the project root.

**Why.** A colocated test is visible — you cannot rename or move the component without seeing
it, so tests stop rotting quietly. A mirrored `__tests__/` tree gives you the opposite: two
structures to keep in sync, and an easy way to forget the second one exists.

E2E tests are excluded because they exercise the app from outside and span several systems;
binding them to `src/` internals would couple them to exactly the structure they are meant to
be independent of.

Watch for project-specific naming that carries behaviour — a test-runner split driven by
filename means the name is load-bearing, not cosmetic.

**Signal it is misplaced.** A `__tests__/` directory mirroring `src/`; a fixture in `shared`
that only one feature's tests use.

## User-facing strings

**Rule.** No user-facing text is written inline. Strings live in the i18n message files,
namespaced by feature, and reach the UI through the translation hook.

**Why.** Inline text is unfindable and untranslatable — and unlike most placement mistakes this
one cannot be fixed incrementally, because there is no way to enumerate what you missed. Even
in a single-language app, the message file doubles as the product's copy inventory, which is
the artifact a writer or designer can actually review.

Namespace per feature rather than one large file: it keeps merge conflicts local and makes
dead copy visible when a feature is deleted.

**Signal it is misplaced.** A sentence in JSX; a message file named after a UI widget rather
than a feature.

## Assets

**Rule.** An image, icon or font used by one component sits in that component's folder. Assets
used app-wide (logo, favicon, brand fonts) sit in the shared/public location the framework
expects.

**Why.** Same reasoning as styles: an asset is usually part of one component's presentation and
becomes orphaned the moment that component is deleted. A shared assets folder that nobody dares
prune is the same dumpster failure in binary form.

## When a feature folder needs subfolders

A feature folder does not need `components/ hooks/ utils/ types/` scaffolding on creation.
Start flat:

```
features/reviews/
├── ReviewsPage.tsx
├── useReviews.ts
└── verdict.ts
```

Add a subfolder when the **second** file of that kind appears. Empty or one-file folders are
pure navigation cost: more clicks, more nesting, and a false impression of structure. Growing
the folders on demand also means the shape of a feature folder tells you something true about
the feature's actual complexity.
