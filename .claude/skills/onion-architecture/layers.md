# Layers — the ring↔path map

Read this before placing a new file. Every path under `server/src` belongs to exactly one
ring, and the ring is derived from the **filename**, not from a folder.

## Why filenames and not folders

The obvious alternative is `modules/<name>/{domain,application,infrastructure}/`. We do not
do that, for three reasons:

1. The repo already names its layers by file — `routes.ts`, `service.ts`, `repository.ts` —
   and `server/AGENTS.md` codifies that a new module is "`routes.ts` + `service.ts`". Adding
   a second, parallel taxonomy would mean two answers to the same question.
2. A `modules/<name>/` folder is a vertical slice (a modular monolith). Each slice carries
   its own onion; the rings run *through* the folder, not around it. Filenames express that
   without nesting every module three levels deeper.
3. ESLint flat config matches on glob patterns, so a filename-derived ring is directly
   enforceable — `files: ['src/modules/*/service.ts']` *is* the ring-2 zone. A folder
   convention would need a plugin and a new dependency.

---

## The map

| Ring | Paths | Notes |
|---|---|---|
| **0 — Domain** | `reviewer-core/src/**` | prompt assembly, grounding, reduce, `reviewPullRequest`. Its only side effect is an injected `LLMProvider`. |
| | `server/src/vendor/shared/contracts/**` | Zod contracts: `findings`, `brief`, `trace`, `platform`, `review-api`, … |
| **1 — Ports** | `vendor/shared/adapters.ts` | `LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider` |
| | `modules/repo-intel/types.ts` | the `RepoIntel` facade — a port that happens to live in a feature folder |
| | `adapters/depgraph/index.ts`, `adapters/tokenizer/index.ts` | `DepGraph` and `Tokenizer` interfaces declared next to their impl |
| **Kernel** | `platform/config.ts`, `platform/errors.ts` | `AppConfig` is validated data; `AppError` is the error taxonomy. Any ring may import both. |
| **2 — Application** | `modules/*/service.ts` | the use cases |
| | `modules/*/helpers.ts`, `modules/*/constants.ts` | pure transforms and literals owned by the slice |
| | `modules/reviews/{run-executor,findings,diff-loader}.ts` | the review use case, split for size |
| | `modules/_shared/severity.ts` | a pure cross-module transform |
| | `platform/{model-router,run-logger,trace-builder,price-book}.ts` | application services with no I/O of their own |
| **3 — Infrastructure** | `adapters/**` | one folder per concern, one file per technology |
| | `db/**` | schema, client, rows, migrations, seed |
| | `modules/*/repository.ts`, `modules/reviews/repository/*.repo.ts` | the only place a query is written |
| | `modules/repo-intel/pipeline/**` | walks the filesystem and drives astgrep/graphology |
| | `platform/{jobs,sse,prompts}.ts` | DB-backed queue, in-memory bus, template loader (reads `src/prompts/*.md`) |
| **4 — Transport + composition root** | `modules/*/routes.ts` | Fastify plugins; the HTTP edge |
| | `modules/index.ts` | the static module registry |
| | `app.ts`, `server.ts` | the Fastify instance and the process entrypoint |
| | `platform/container.ts` | **the composition root** |
| | `modules/_shared/context.ts` | `getContext(container, req)` — the one shared file that may touch `FastifyRequest` |

`test/**` is outside the rings: tests may import anything, and `adapters/mocks.ts` exists to
be imported by them.

---

## The import matrix

Rows may import columns marked ✅.

| from ↓ / to → | 0 Domain | 1 Ports | Kernel | 2 App | 3 Infra | 4 Root |
|---|---|---|---|---|---|---|
| **0 Domain** | ✅ | — | — | — | — | — |
| **1 Ports** | ✅ | ✅ | — | — | — | — |
| **2 Application** | ✅ | ✅ | ✅ | ✅ | — | — |
| **3 Infrastructure** | ✅ | ✅ | ✅ | — | ✅ | — |
| **4 Root / transport** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Three consequences worth spelling out:

- **Ring 2 cannot import ring 3.** A service reaches persistence through a repository that
  the composition root handed it, and everything else through a port. This is the rule most
  of the lint zones exist to protect.
- **Ring 3 cannot import ring 2.** An adapter never calls a service. If an adapter seems to
  need business logic, the logic belongs in ring 2 and the adapter should return data.
- **Ring 3 cannot import ring 3 across concerns.** `adapters/**` may not import `db/**`, and
  no adapter may import `modules/**`. An adapter that needs to persist something is doing
  two jobs.

Ring 4 is deliberately unconstrained: it is where the concrete world gets assembled.
`platform/container.ts` importing `modules/agents/repository.js` is correct by this reading
— every *other* file in `platform/` importing `modules/**` is not, and `pnpm arch` enforces
that difference.

---

## Naming

Names carry the ring. Keep them.

| Concept | Convention | Examples |
|---|---|---|
| Port (outbound interface) | role noun — `Provider` / `Client` / bare | `SecretsProvider`, `LLMProvider`, `GitHubClient`, `CodeIndex`, `Embedder`, `DepGraph`, `Tokenizer`, `RepoIntel` |
| Adapter (implementation) | `<Tech><Interface>` | `LocalSecretsProvider`, `OctokitGitHubClient`, `SimpleGitClient`, `RipgrepCodeIndex`, `OpenAIProvider`, `TiktokenTokenizer` |
| Test double | `Mock<Interface>`, in `adapters/mocks.ts` | `MockLLMProvider`, `MockGitClient` |
| Use case | `<Feature>Service` | `RepoService`, `ReviewService`, `AgentsService` |
| Data access | `<Feature>Repository` | `RepoRepository`, `ReviewRepository` |
| Adapter file | `adapters/<concern>/<tech>.ts` | `adapters/llm/openai.ts` |

The folder is called `adapters/`, and `server/README.md` labels the same node
`adapters (ports)`. Both words are in use: **port** = the interface, **adapter** = the class
that implements it. The folder holds adapters; the interfaces they implement live in ring 1.

The word `Port` appears in no identifier in this codebase, and this skill does not introduce
it. Renaming would churn every call site to teach a vocabulary the table above already
teaches.

---

## Adding a new outbound dependency — the five files

Anything that talks to the world outside this process lands as five edits, in this order:

1. **Interface** in `vendor/shared/adapters.ts` (ring 1) — the smallest surface the
   application actually needs, expressed in this repo's own types, not the SDK's.
2. **Adapter** in `adapters/<concern>/<tech>.ts` (ring 3) — `implements` that interface; the
   SDK import lives here and nowhere else.
3. **Mock** in `adapters/mocks.ts` — without it the port is unfalsifiable and rule 9 has no
   teeth.
4. **Container entry** in `platform/container.ts` — a lazy getter, plus a field in
   `ContainerOverrides` so a test can inject the mock. Anything that needs a secret is
   `async` and resolves it through `SecretsProvider`.
5. **Consumer** in ring 2 — takes the interface, never the concrete class.

Skipping step 3 is how a port quietly becomes decoration; skipping step 4 is how a service
ends up importing an SDK.
