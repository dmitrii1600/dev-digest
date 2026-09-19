# @devdigest/api — module map

Fastify 5 + Drizzle/Postgres. Imports repos and PRs, indexes repos, runs the
reviewer. Architecture, request/DI flow and route map → `./README.md` — **read
before adding a module or an adapter**.

## Commands

```sh
pnpm dev                 # :3001 (tsx watch)
pnpm db:migrate          # never runs on boot
pnpm db:seed             # idempotent demo data
pnpm db:generate         # new migration from schema changes
pnpm test                # unit + integration
pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit only, no Docker
pnpm typecheck
pnpm lint                # eslint — dead code, no stray console, and the onion import zones
pnpm arch                # dependency-cruiser — ring cycles + cross-folder edges
```

## Layout

`src/modules/<name>/` feature plugins · `src/adapters/` ports to the outside
world · `src/platform/` config, DI container, errors · `src/db/schema/` one file
per domain · `src/vendor/shared/` canonical Zod contracts.

## Conventions

- **Layering is Onion and it is enforced.** Which ring a file belongs to and what
  it may import → the `onion-architecture` skill
  (`.claude/skills/onion-architecture/`) — **read it before adding a file here**.
  `pnpm lint` checks the import zones, `pnpm arch` the graph; both are green on
  `main` and both must stay green.
- **New module** = `modules/<name>/routes.ts` (default Fastify plugin) +
  `service.ts`, then one import and one entry in `modules/index.ts`. Registration
  is static on purpose — filesystem autoload does not survive tsx/vitest.
- **Validation is declarative.** Declare zod `params`/`body`/`response` on the
  route; do not call `Schema.parse(req.body)` inside a handler. Invalid input is
  rejected with 422 before the handler runs.
- **Everything external goes through an adapter** resolved from the DI container
  (`platform/container.ts`). Tests swap in `adapters/mocks.ts`. A service that
  imports an SDK directly is a bug.
- **Relative imports carry the `.js` extension** (`./routes.js` for `routes.ts`)
  — the package is ESM.
- **DB-backed test ⇒ `*.it.test.ts`.** It spins up real Postgres via
  testcontainers and self-skips without Docker. Any other name lands it in the
  hermetic suite and breaks CI.
- Plugins (helmet, cors, rate-limit, SSE, error handler) register **before**
  modules so encapsulated plugins inherit them.

## Do not touch

- `src/db/migrations/**` — never edit an applied migration; generate a new one.
- Secrets handling in `adapters/secrets/local.ts` — the single read chokepoint
  for API keys and `GITHUB_TOKEN`. Keys never go into the DB or `AppConfig`.

## Gotchas

- `REPO_INTEL_ENABLED` defaults to **true**, but an unindexed repo yields an
  empty repo map and the prompt section is silently omitted.
- The global rate limit is disabled under `NODE_ENV=test`; SSE and `/health*`
  are always exempt.
- Tables for unbuilt lesson features already exist in the schema and stay empty.

## Read when

- Repo indexer, pipeline and the `repoIntel.*` facade →
  `src/modules/repo-intel/README.md` — **read before consuming repo context**
- What the reviewer actually sends the model →
  `README.md#review-context-non-obvious` — **read before changing prompt inputs**
- How the PR list's per-PR aggregates are computed (and why `score`,
  `findings_counts` and `cost_usd` do not share one rule) →
  `docs/read-aggregates.md` — **read before adding a column to that endpoint**
- Test strategy and the unit/integration split → `../TESTING.md`
- Feature specs → `specs/` · learned decisions → `INSIGHTS.md` — **read it before
  changing code here**, and run `/engineering-insights` at the end of the task to
  append what this session learned
