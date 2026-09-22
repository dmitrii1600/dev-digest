---
name: onion-architecture
description: >-
  Onion Architecture for the DevDigest backend — which ring a file belongs to and what it
  may import. Use whenever adding or changing anything under `server/`: a route, a service,
  a repository, an adapter, a DB query, a port interface, a new module, or a new external
  dependency. Use when deciding where a piece of logic goes, when a route handler is about
  to run a query, when a service is about to import Drizzle, Fastify or a vendor SDK, when
  something needs the DI container, or when a lint/arch check fails with a ring message.
  Use when reviewing or refactoring backend structure, and whenever the question touches
  layering, dependency direction, ports and adapters, the composition root, repositories,
  DTO-vs-domain types, or module boundaries. Covers Fastify, Drizzle, Zod contracts, the
  `Container`, `SecretsProvider` and `reviewer-core`. It does not cover how to write a
  Fastify route (see fastify-best-practices), how to write a Drizzle query (see
  drizzle-orm-patterns), or frontend structure (see frontend-ui-architecture).
version: 1.0.0
---

# Onion Architecture

This skill answers one class of question: **which ring does this code live in, and what may
it import?** It says nothing about how to write a good Fastify route, a good Drizzle query
or a good Zod schema — `fastify-best-practices`, `drizzle-orm-patterns` and `zod` own those,
and duplicating them here would produce two sources of truth that drift.

`server/` was built onion-shaped and the shape is written down in prose —
`server/AGENTS.md` already says *"everything external goes through an adapter… a service
that imports an SDK directly is a bug"*. Prose does not fail a build, so the shape has been
eroding at the edges. This skill turns that prose into rings, rules, and two checks that
run: `pnpm lint` and `pnpm arch`.

Companions: **`layers.md`** (the ring↔path map and the import matrix — read it before
placing a new file), **`rules.md`** (the eleven rules, each with a real ✅/❌ from this
repo), **`enforcement.md`** (the configs, how to read a failure, and the grandfathered
list).

## The one rule

> All code can depend on layers more central, but code cannot depend on layers further out
> from the core. — Palermo, 2008

Everything below is a consequence. Outer may skip inward (a route may call a port
directly); inward may never reach outward. When you are unsure which ring something is in,
ask what would break it: if a file breaks when Postgres, Fastify or an SDK changes, it is
infrastructure, however business-like it reads.

---

## The rings, mapped onto the folders that exist

No file moves. These are names for what is already on disk.

| Ring | Name | Lives in | May import |
|---|---|---|---|
| 0 | **Domain** | `reviewer-core/src/**`, `vendor/shared/contracts/**` | nothing from `server/src` |
| 1 | **Ports** | `vendor/shared/adapters.ts`, `modules/repo-intel/types.ts`, `DepGraph` / `Tokenizer` | ring 0 |
| — | *Kernel* | `platform/config.ts`, `platform/errors.ts` | any ring may import these |
| 2 | **Application** | `modules/*/service.ts` · `helpers.ts` · `constants.ts` · `run-executor.ts` · `findings.ts` · `platform/{model-router,run-logger,trace-builder,price-book}.ts` | rings 0–1 |
| 3 | **Infrastructure** | `adapters/**` · `db/**` · `modules/*/repository*.ts` · `repo-intel/pipeline/**` · `platform/{jobs,sse,prompts}.ts` | rings 0–1 + its own technology |
| 4 | **Transport + composition root** | `modules/*/routes.ts` · `modules/index.ts` · `app.ts` · `server.ts` · `platform/container.ts` · `_shared/context.ts` | every ring |

Two placements surprise people, so they are stated here rather than buried:

- **`platform/container.ts` is ring 4, not ring 3.** It is the *composition root* — the one
  file allowed to name every concrete class, which is exactly why it may import `modules/**`
  and nothing else in `platform/` may. A file that reaches for the container to fetch a
  dependency is doing service location; the container exists to *hand* dependencies out at
  the edge.
- **`src/vendor/**` is in ESLint's `ignores`.** Rules about ports can never fire there, so
  ring 0–1 is policed by `pnpm arch` (dependency-cruiser) instead. Do not "fix" this by
  un-ignoring a vendored tree.

---

## The eleven rules

One line each; the why, the examples and the check are in `rules.md`.

| # | Rule | Checked by |
|---|---|---|
| 1 | `fastify` types only in ring 4. `_shared/context.ts` is the one named exception. | lint |
| 2 | `drizzle-orm`, `db/schema`, `db/client` only in ring 3. A route that queries is the failure mode this skill exists to stop. | lint |
| 3 | A vendor SDK (`openai`, `@anthropic-ai/*`, `octokit`, `simple-git`, `@ast-grep/napi`, `graphology`) only in `adapters/**`. | lint |
| 4 | `node:fs`, `node:child_process` only in ring 3. | lint |
| 5 | A `$inferSelect` row type must not appear in a ring-2 public signature — map row → contract in `helpers.ts`. | review |
| 6 | Validate once, at the boundary. The route carries the Zod schema; handlers do not call `Schema.parse(req.body)`. | review |
| 7 | A contract is a wire DTO, not a domain model. Ring 2 may use a `z.infer` *type*; importing `zod` in ring 2 to re-parse means the validation is in the wrong place. | lint (import), review (intent) |
| 8 | Everything external is a port resolved from `Container`; tests swap `adapters/mocks.ts` through `ContainerOverrides`. | lint |
| 9 | A new service takes the ports it needs in its constructor, not the whole `Container`. | review |
| 10 | `adapters/**` may not import `db/**` or `modules/**`; `platform/**` (except `container.ts`) may not import `modules/**`; a module may not import another module's folder — cross-module access goes through `container.*`. | arch |
| 11 | A new module = `routes.ts` + `service.ts`, plus `repository.ts` when it touches Postgres, plus one entry in `modules/index.ts`. | review |

---

## Where do I put it?

| You are adding | It goes in | Not in |
|---|---|---|
| A SQL query, any `db.select()` | `modules/<name>/repository.ts` (ring 3) | the route, the service |
| A business decision, an orchestration, a policy | `modules/<name>/service.ts` (ring 2) | the route |
| A pure transform (row → DTO, formatting, rollup) | `modules/<name>/helpers.ts` (ring 2) | inline in either |
| A call over the network or to the disk | a new `adapters/<concern>/<tech>.ts` behind an interface (ring 3 + ring 1) | anywhere else |
| A new interface for that call | `vendor/shared/adapters.ts` (ring 1) | next to the implementation |
| Wiring the implementation to the interface | `platform/container.ts` + `ContainerOverrides` + a mock in `adapters/mocks.ts` | a module |
| A request/response shape | `vendor/shared/contracts/*.ts` (ring 0), used as the route schema | a hand-written type in the module |
| A magic string or number | `modules/<name>/constants.ts` | inline |
| Review logic — prompts, grounding, findings | `reviewer-core/` (ring 0) | `server/` |

---

## When *not* to add a layer

Onion is a way to pay for change you expect. Paid where change never comes, it is ceremony.
This repo is a teaching codebase and each lesson adds a feature back, so the bar is:

- **A repository that only forwards one call is still worth it**, because it is the seam the
  ring-2 rule depends on: a service must be readable without knowing SQL. But do not invent
  a second repository for a second table in the same module — one per module, split into
  `repository/*.repo.ts` only when it grows (the `reviews` module is the reference).
- **Do not write an interface with one implementation and no test double.** A port earns its
  existence when something is injected in a test or swapped in an environment. `DepGraph`
  and `Tokenizer` qualify; an `IRepoNameFormatter` would not.
- **Do not build a separate domain-entity class layer.** The Zod contract is deliberately
  the shared model here (root `AGENTS.md`: *"a contract is written once… and serves as
  request validation, response serialization, and the client's type"*). Rule 7 protects the
  direction of that dependency, not a second set of types.
- **Do not restructure a module into `domain/application/infrastructure` folders.** The ring
  is derived from the filename, on purpose — see `layers.md`.

The test for every abstraction: *does it let a ring-2 file be read, and tested, without
knowing which technology is underneath?* If no, it is decoration.

---

## Two checks

```sh
cd server && pnpm lint      # ring rules ESLint can see (imports, per-file zones)
cd server && pnpm arch      # ring rules it cannot: cycles, the vendored tree, cross-module reach-ins
```

Both must be green before a commit. When one fails, the message names the ring and points
back here. Fix the placement — reach for an exception only under the rules in
`enforcement.md`, and never by deleting the rule.

---

## Before you finish

- [ ] Every new file has a ring, and it matches its filename (`layers.md`)
- [ ] No `drizzle-orm` / `db/schema` import outside ring 3
- [ ] No `fastify` import outside ring 4
- [ ] No vendor SDK outside `adapters/**`; a new external call has an interface, a container
      entry and a mock
- [ ] No `$inferSelect` row type in a service's public signature
- [ ] The route declares its Zod schema; no `.parse()` in the handler
- [ ] Cross-module access goes through `container.*`, not another module's folder
- [ ] A new module has `routes.ts` + `service.ts` and one line in `modules/index.ts`
- [ ] `pnpm lint` and `pnpm arch` are green — no new entry in the grandfathered list
- [ ] Anything learned the hard way went to `server/INSIGHTS.md` via `/engineering-insights`
