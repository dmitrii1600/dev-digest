# DevDigest — project map

Local-first AI pull-request review. Course starter: import a PR, run an agent
review on it. Each lesson adds one feature back.

## Stack

Node >=22 · pnpm >=10 · TypeScript 5 (ESM) · Vitest
Fastify 5 · Drizzle ORM · Postgres 16 + pgvector · Zod
Next.js 15 (App Router) · React 19 · TanStack Query · next-intl
Docker runs **Postgres only**; API and web run on the host.

## Commands

```sh
./scripts/dev.sh                 # Postgres + API :3001 + web :3000 (+ migrate + seed)
cd server && pnpm db:migrate     # NOT run on boot — do this before first use
cd server && pnpm db:seed        # idempotent demo data
cd server && pnpm test           # unit + integration
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit only, no Docker
cd client && pnpm test && pnpm typecheck
cd reviewer-core && npm test     # npm, not pnpm
./scripts/e2e.sh                 # hermetic browser e2e on alternate ports
```

## Layout

| Path | Package | Role |
|---|---|---|
| `server/` | `@devdigest/api` | Fastify API, Drizzle/Postgres, repo indexer |
| `client/` | `@devdigest/web` | Next.js studio |
| `reviewer-core/` | `@devdigest/reviewer-core` | pure review engine: diff → prompt → LLM → findings |
| `e2e/` | `@devdigest/e2e` | deterministic browser flows (agent-browser, no LLM) |
| `server/src/vendor/shared` | `@devdigest/shared` | canonical Zod contracts |

**Not a monorepo.** Four standalone packages, each with its own `package.json`
and lockfile. Cross-package code is wired through tsconfig `paths`, never
published modules. Each package has its own `CLAUDE.md` that loads on demand.

## Conventions (non-default)

- A contract is written once in `@devdigest/shared` and serves as request
  validation, response serialization, and the client's type.
- A test that touches Postgres **must** be named `*.it.test.ts` — the CI split
  and the hermetic/integration boundary are filename-driven.
- Secrets never live in the DB, in `AppConfig`, or in committed env files. They
  go through `SecretsProvider` → `~/.devdigest/secrets.json` (mode 0600), with
  `process.env` as fallback.
- `server/` and `client/` use **pnpm**; `reviewer-core/` and `e2e/` use **npm**.
  Use the one that matches the lockfile in that folder.
- Docs live next to the code they describe: `README.md` is the architecture
  source of truth, `CLAUDE.md` is only a map, `INSIGHTS.md` records what we
  learned the hard way.

## Do not touch

- `reviewer-core/src/grounding.ts` — the anti-hallucination gate. Changing it
  changes what a review *means*. Discuss before editing.
- `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` — one shared trusted rule.
  Never replace it with keyword scanning of untrusted text.
- `server/src/db/migrations/**` — never edit an applied migration; generate a
  new one with `pnpm db:generate`.
- Generated / vendored-in trees: `client/.next`, `*/node_modules`, `clones/`.
- `docker compose down -v` — the `-v` drops `devdigest_pgdata` and every
  imported repo and review with it.

## Gotchas

- Migrations are not applied on boot. `relation ... does not exist` on a fresh
  clone means you skipped `pnpm db:migrate`.
- The DB schema already contains tables for **every** future lesson. Empty
  tables are expected, not a bug.
- An unindexed repo degrades **silently** to diff-only review: the repo-map
  prompt section is simply omitted, no error is raised.
- `@devdigest/shared` is vendored twice (`server/src/vendor/shared` and
  `client/src/vendor/shared`) and the copies have already drifted. The server
  copy is canonical; when you change a contract the client consumes, mirror it.
- The model's self-reported `score` is ignored — it is recomputed from the
  findings that survive grounding.

## Read when

- End-to-end review flow and architecture diagrams → `README.md` — **read before
  changing how a review is produced**
- Review engine pipeline → `reviewer-core/README.md` — **read before touching
  prompt assembly, structured output, or grounding**
- API and DI map → `server/README.md` — **read before adding a route or adapter**
- Codebase indexer and the `repoIntel.*` facade →
  `server/src/modules/repo-intel/README.md` — **read before using repo context**
- Writing reviewer prompts → `docs/agent-prompts/README.md` — **read before
  editing any agent system prompt**
- Unit vs integration split → `TESTING.md` — **read before adding a test file**
- Feature specs for the current lesson → `specs/` — **read before implementing a
  lesson feature**
- Hard-won lessons and decisions → the touched module's `INSIGHTS.md` **and**
  the root one — **read before changing anything in that module**, then state
  the 3 entries relevant to the task. Treat them as high-confidence guidance
  unless this session proves otherwise.

---

At the end of a substantive task, run `/engineering-insights` to append what this
session learned to the right `INSIGHTS.md`. Do not skip this step. If nothing
non-obvious came up, say so and write nothing.
