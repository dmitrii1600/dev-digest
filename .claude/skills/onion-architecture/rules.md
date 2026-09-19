# Rules

Eleven rules. Each: the statement, why it exists here, a ✅ and a ❌ taken from this repo,
and what checks it. Rings are defined in `layers.md`.

---

## 1 — `fastify` types only in ring 4

**Why.** HTTP is a delivery mechanism. A use case that names `FastifyRequest` can only ever
be driven by HTTP — not by the job runner, not by a CLI, not by a test that calls it
directly. Cockburn's original framing: the application must be drivable by users, programs
and test scripts alike.

✅ `modules/repos/routes.ts:20-28` — the route owns Fastify and hands the service plain
arguments:

```ts
const app = appBase.withTypeProvider<ZodTypeProvider>();
const service = new RepoService(app.container);
app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
  const { workspaceId, userId } = await getContext(app.container, req);
  const { repo, created } = await service.add(workspaceId, userId, req.body.url);
```

❌ Passing `req.log` into a service so it can log. `modules/reviews/routes.ts:37` does this;
`run-executor.ts:21-26` softens it by declaring its own structural `Logger` type rather than
importing pino. That is the pattern to copy if a use case genuinely needs a logger: **name
the capability you need, in your own ring**.

**Exception.** `modules/_shared/context.ts:1` imports `FastifyRequest` — it is the shared
adapter from "a request" to "a tenancy context", and it is ring 4. The port it calls is
deliberately request-agnostic: `AuthProvider.currentUser(req: unknown)`
(`vendor/shared/adapters.ts:269`).

**Checked by** `pnpm lint`.

---

## 2 — `drizzle-orm`, `db/schema`, `db/client` only in ring 3

**Why.** "The database is not the center. It is external." A query in a route handler
fuses transport, business rules and persistence into one file that cannot be tested without
Postgres and cannot be reused by the job runner.

✅ `modules/repos/repository.ts:1-3,25-28` — the only Drizzle in that slice:

```ts
import { and, eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
const [row] = await this.db.select().from(t.repos)
  .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
```

❌ `modules/pulls/routes.ts:3,35,54` — 383 lines of route file that imports `drizzle-orm`,
queries `t.repos`, upserts `t.pullRequests` and computes per-PR aggregates. `polling`,
`settings` and `workspace` have the same shape. All four are grandfathered
(`enforcement.md`); none is a template.

**Reference shape for a module that outgrows one file:**
`modules/reviews/repository.ts` is a thin facade over `repository/{pull,review,run}.repo.ts`
— split by entity, one Drizzle import each.

**Checked by** `pnpm lint`.

---

## 3 — A vendor SDK only in `adapters/**`

**Why.** The SDK is the thing most likely to change and the thing hardest to fake. Behind an
interface it is one file to rewrite; in a service it is a rewrite of the service. This rule
already exists in prose — `server/AGENTS.md`: *"A service that imports an SDK directly is a
bug."*

Covered: `openai`, `@anthropic-ai/sdk`, `octokit`, `simple-git`, `@ast-grep/napi`,
`graphology*`, `js-tiktoken`, `dependency-cruiser`, `@vscode/ripgrep`, `postgres`.

✅ `adapters/llm/openai.ts` implements `LLMProvider`; `adapters/github/octokit.ts` implements
`GitHubClient`; the service only ever sees the interface.

❌ `modules/repo-intel/service.ts:22-30` imports `adapters/astgrep/index.js`,
`adapters/codeindex/extract.js` and `node:fs/promises` directly. It is a ring-2 file doing
ring-3 work — grandfathered, and the reason the `repo-intel` pipeline is *not* the model to
copy. Its own facade doc says features should call `repoIntel.*` and never the libraries;
the facade should hold itself to that too.

**Checked by** `pnpm lint`.

---

## 4 — `node:fs`, `node:child_process` only in ring 3

**Why.** The filesystem is infrastructure for the same reason Postgres is. A use case that
reads a file needs a disk to be tested.

`node:path`, `node:url` and `node:crypto` are **not** restricted — they are pure functions
over strings and bytes, not I/O.

❌ `modules/repo-intel/service.ts:31` (`readFile`) and `pipeline/walk.ts:23`. The pipeline is
ring 3 and legitimately walks a clone; the *service* is not.

**Checked by** `pnpm lint`.

---

## 5 — No `$inferSelect` row type in a ring-2 public signature

**Why.** A Drizzle row is the shape of a table, and a table's shape is a persistence
decision. When it becomes a service's parameter type, the column list becomes part of the
business contract and every rename ripples outward. Keep schema types inside the repository
boundary.

✅ `modules/repos/service.ts:86` returns the contract type, not the row:

```ts
async add(workspaceId: string, userId: string, url: string): Promise<{ repo: Repo; created: boolean }>
```

with `toRepoDto` in `helpers.ts` doing row → DTO.

❌ `modules/reviews/service.ts:46,103` takes and returns `AgentRow` (a
`typeof t.agents.$inferSelect`); `run-executor.ts:58` and `diff-loader.ts:17` take
`typeof schema.repos.$inferSelect`. `db/rows.ts` exists precisely to make this convenient
across modules — convenient, and the widest crack in the onion today.

**Fix pattern.** Map at the repository edge, in `helpers.ts`, and give the use case the
narrow shape it actually reads. Often that is three fields, not a table.

**Checked by** review — a type in a signature is not an import, so no linter sees it. Look
for it when you touch a service.

---

## 6 — Validate once, at the boundary

**Why.** "Parse, don't validate": the value that leaves the boundary should already be the
exact shape the inner rings want, so nothing inward re-checks. Fastify does this
declaratively — an invalid body is rejected with 422 *before* the handler runs, and the
same schema drives response serialization.

✅ `modules/repos/routes.ts:26` — `{ schema: { body: RepoInput } }`, handler receives typed
`req.body`.

❌ `modules/reviews/routes.ts:32` — `const body = RunRequest.parse(req.body ?? {})`. It is
deliberate (both fields optional, empty body allowed), but it is the shape that spreads:
once one handler parses by hand, the next one does too. Express the tolerance in the schema
instead.

**Checked by** review. `server/AGENTS.md` states it too: *"do not call
`Schema.parse(req.body)` inside a handler."*

---

## 7 — A contract is a wire DTO, not a domain model

**Why.** Root `AGENTS.md` makes the Zod contract the single definition across validation,
serialization and the client's type — that is a deliberate, load-bearing choice and this
skill does not fight it. What it protects is the *direction*: the contract is data flowing
inward, not a base class the domain inherits. Ring 2 may hold a `z.infer` type; ring 2
importing `zod` to re-parse means validation leaked out of ring 4.

✅ `modules/repos/service.ts:2` — `import { type Repo } from '@devdigest/shared'`. A type, no
runtime Zod.

✅ **Sanctioned exception:** `vendor/shared/adapters.ts:57` —
`StructuredRequest.schema: z.ZodType<T>` puts Zod in a port signature on purpose. The LLM
contract genuinely *is* a schema: the provider needs it to constrain generation
(`llm/structured.ts` passes it to `zodResponseFormat`). A schema-as-value here is the
domain concept, not a validation leak.

❌ A service calling `SomeContract.parse(...)` on data that already crossed a validated
route. That is a second source of truth about the same bytes.

**Checked by** `pnpm lint` for the import; review for intent.

---

## 8 — Everything external goes through a port resolved from `Container`

**Why.** This is the dependency-inversion half of the onion: the inner ring declares the
interface, the outer ring supplies the implementation at runtime. It is also what makes the
hermetic test suite possible — `pnpm exec vitest run --exclude '**/*.it.test.ts'` runs with
no Docker because every outbound call is a mock.

✅ `platform/container.ts:89-93,163-171` — lazy getters, an `async` resolve for anything
needing a secret, and `ContainerOverrides` (`:40-54`) as the single test seam:

```ts
get git(): GitClient {
  if (this.overrides.git) return this.overrides.git;
  this._git ??= new SimpleGitClient(this.config.cloneDir);
  return this._git;
}
```

✅ **`SecretsProvider` is the exemplar boundary** and worth reading whole: port at
`vendor/shared/adapters.ts:281`, one implementation at `adapters/secrets/local.ts` that is
the single place reading `process.env`, and `platform/config.ts:9-13` documenting that
secrets are deliberately absent from `AppConfig`. Even `process.env` is
constructor-injected. The optional `set?` is load-bearing — `settings/routes.ts:80` branches
on a read-only backend rather than assuming.

❌ `adapters/auth/local.ts:3-4` — an adapter importing `db/client.js` and `db/schema.js`.
Ring 3 reaching sideways into another ring-3 concern; grandfathered.

**Checked by** `pnpm lint` (rule 3) and `pnpm arch` (rule 10).

---

## 9 — A service takes the ports it needs, not the whole `Container`

**Why.** `constructor(private container: Container)` is service location: the dependencies
are invisible in the signature, discovered only by reading the body, and a test must build a
container to exercise one method. Constructor injection makes the dependency list the type.
The container stays what it should be — the composition root that wires, not a registry the
code queries.

❌ Every service today: `repos/service.ts:36`, `reviews/service.ts:33`,
`repo-intel/service.ts`, `run-executor.ts:44`. All grandfathered; none is the template.

✅ The shape for new code:

```ts
export class WorkspaceService {
  constructor(private readonly repo: WorkspaceRepository, private readonly auth: AuthProvider) {}
}
// routes.ts (ring 4):
const service = new WorkspaceService(new WorkspaceRepository(container.db), container.auth);
```

**Migrating an existing service is not required** to land a feature. If you are already
rewriting its constructor, take the ports; otherwise leave it and do not widen it.

**Checked by** review.

---

## 10 — No sideways or outward imports between folders

Three edges, all invisible to per-file lint zones:

| Forbidden edge | Why | Live violation |
|---|---|---|
| `adapters/**` → `db/**` | an adapter that persists is doing two jobs | `adapters/auth/local.ts:3-4` |
| `adapters/**` → `modules/**` | infrastructure must not know features | none |
| `platform/**` (except `container.ts`) → `modules/**` | keeps the kernel independent of features | none — but `container.ts:26-29` makes the cycle look normal, so the rule is explicit |
| `modules/a/**` → `modules/b/**` | slices stay independent; shared entities are resolved from the root | none — `container.ts:70-72` already documents the workaround: *"consuming modules use `container.agentsRepo` instead of reaching into another module's folder"* |

`platform/container.ts` is exempt from the third row by definition — it is the composition
root, the one place allowed to know every concrete class.

**Checked by** `pnpm arch`.

---

## 11 — A new module is `routes.ts` + `service.ts` (+ `repository.ts`)

**Why.** Four of eight modules skipped the service and the erosion is visible in their line
counts. The minimum is already in `server/AGENTS.md`; this rule adds the DB clause.

A new module:

```
modules/<name>/
├── routes.ts        default Fastify plugin        (ring 4)
├── service.ts       the use cases                 (ring 2)
├── repository.ts    every query, if it has any    (ring 3)
├── helpers.ts       pure transforms, optional     (ring 2)
└── constants.ts     literals, optional            (ring 2)
```

plus one import and one entry in `modules/index.ts` — registration is static on purpose
(filesystem autoload does not survive tsx/vitest).

A module with no persistence and no logic — a pure passthrough — may be routes-only, but say
so in a comment. The default is the full slice.

**Checked by** review.

---

## Sources

The rules above are this repo's application of a small number of well-documented ideas.
Every link was checked; the `medium.com` ones answer 403 to a bare fetch (bot wall, not a
dead link) and need a browser.

**Onion Architecture**
- Jeffrey Palermo — [part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) ·
  [part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) ·
  [part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) ·
  [part 4, after four years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/)
  — the dependency rule, "the database is not the center", and why outer layers may call any
  inner layer directly.
- Herberto Graça —
  [Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/)
  ([Medium mirror](https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85))
  — how Onion relates to Ports & Adapters and DDD.

**Ports, adapters, dependency injection**
- Alistair Cockburn — [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) (2005 original) ·
  [Wikipedia summary](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software))
- Mark Seemann — [Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) — why
  `container.ts` is ring 4 and why nothing else should reference the container (rules 9, 10).
- [Ports and Adapters explained with two real codebases](https://saadh393.github.io/blog/adapter-port-architecture-two-cases)
  — "business logic may import ports, never adapters".
- [TSH — Hexagonal architecture: overview and best practices](https://tsh.io/blog/hexagonal-architecture)

**Per tool**
- Fastify — [Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) ·
  [Plugins](https://fastify.dev/docs/latest/Reference/Plugins/) ·
  [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) — the plugin scope is
  the DI seam, which is why plugins register before modules (rule 1).
- [Fastify plugins as building blocks for a backend Node.js API (Snyk)](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/)
- [Repository pattern with Drizzle](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
  — don't expose schema types past the repository (rules 2, 5).
- [Drizzle ORM best practices](https://paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)
- [Microsoft — Designing the infrastructure persistence layer](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design)
- Khalil Stemmler — [DTOs, mappers and the repository pattern](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/)
  — the `toRepoDto` boundary (rule 5).
- [Validate at the boundary, map to a DTO (Zod)](https://joshkaramuth.com/blog/tanstack-zod-dto/) (rules 6, 7).
- [Hexagonal architecture in AI agent development](https://medium.com/@martia_es/applying-hexagonal-architecture-in-ai-agent-development-44199f6136d3)
  — the LLM as an adapter: why `LLMProvider` is a port and `reviewer-core` stays pure.

**The counterweight — read before adding an abstraction**
- [You might not need the repository pattern](https://dev.to/jayfreestone/you-might-not-need-the-repository-pattern-46b)
  — over a typed query builder a repository can be pure ceremony. Our answer is in SKILL.md
  ("When *not* to add a layer"): we keep it because it is the seam rule 2 depends on, not
  because we expect to swap Postgres.
- [The modular monolith, a field guide](https://medium.com/viascom/the-modular-monolith-a-field-guide-36dcf21a477b)
  — each module carries its own onion; feature slices and rings are not in conflict.
