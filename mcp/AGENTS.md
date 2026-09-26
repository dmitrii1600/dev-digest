# @devdigest/mcp — module map

A local stdio MCP server named `devdigest`: a thin HTTP adapter over the
existing Fastify API (`server/`), exposing five tools to Claude Code
(`mcp__devdigest__<tool>`). Architecture, tool table, `.mcp.json`, design
decisions and troubleshooting → `./README.md` — **read before adding or
changing an MCP tool**.

## Commands

```sh
npm ci             # install (lockfile-exact; run once, and after every pull)
npm test           # vitest, hermetic — InMemoryTransport + a fake fetch, no Docker
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run inspect    # @modelcontextprotocol/inspector against src/index.ts via tsx
```

Uses **npm**, not pnpm — the lockfile in this folder is `package-lock.json`.

## Layout

```
src/
  index.ts         entry: loadConfig → createApiClient → createServer → StdioServerTransport
  config.ts        zod-parsed env (DEVDIGEST_API_URL, DEVDIGEST_MCP_WAIT_MS, DEVDIGEST_MCP_POLL_MS)
  log.ts           process.stderr logging only
  errors.ts        ToolError / ApiError / toErrorResult()
  api-client.ts    createApiClient({baseUrl, fetchImpl, timeoutMs}) — one method per API endpoint
  resolve.ts       repo/pr/agent identifier resolution
  format.ts        severity sort, concise/detailed shaping, truncation, char guard
  wait.ts          poll + backoff + progress for run_agent_on_pr
  server.ts        createServer(deps) → McpServer('devdigest'); registers the five tools
  tools/           one file per tool, plus shared param fragments (params.ts)
test/
  helpers/         fixtures, a fake DevDigest API (as a fetchImpl), InMemoryTransport connect
  *.test.ts        one file per unit + stdout/stdio/tools-list-budget suites
```

`server/src/vendor/shared` is the only cross-package import (via the
`@devdigest/shared` tsconfig path alias) — the same pattern `reviewer-core`
uses. No other file under `server/`, `client/` or `reviewer-core/` is ever
imported.

## Conventions

- **stdout is the protocol channel.** Only `StdioServerTransport` writes to it.
  Every log line goes to `process.stderr`; `no-console` is `error` except
  `console.error` / `console.warn`.
- **No server imports.** `no-restricted-imports` bans `../server/**`,
  `../reviewer-core/**`, `pino`, `drizzle-orm`, `fastify`, `postgres`. This
  process is an HTTP client, nothing more.
- **Contracts come from `@devdigest/shared`**, parsed with `safeParse` in
  `api-client.ts`. A tool's **input** schema is MCP-local — that is a
  different contract and is defined in `tools/params.ts` / the tool file.
- **Flat primitive tool arguments only** — no nested objects. `repo`, `pr`,
  `agent`, `run_id`, `response_format`, `status` are each a single primitive.
- **Tool descriptions are the product.** They are the only thing the model
  sees before deciding whether to call a tool, and they are budget-tested by
  `test/tools-list-budget.test.ts`. Change a description only through the
  canonical strings in `specs/08-mcp-server.md` → *Final tool descriptions*
  (`get_blast_radius` and the server `instructions`: `specs/09-blast-radius.md`
  → *MCP tool: final strings*).
- **Every test is `*.test.ts`.** Nothing here touches Postgres, so there is no
  `*.it.test.ts` file in this package.

## Do not touch

- `package-lock.json` by hand — regenerate with `npm install` in `mcp/`.
- `server/`, `client/`, `reviewer-core/`, `e2e/` — this package never imports
  their source; it only talks to the API over HTTP.

## Gotchas

- **The API must already be running** (`./scripts/dev.sh` or
  `cd server && pnpm dev`) — this package never starts, health-checks or
  supervises it. A tool call against a stopped API returns an `unreachable`
  error; the server itself still lists fine.
- **Forgot `npm ci`** looks like a total regression, not a missing install:
  `.mcp.json` launches `node .../tsx/dist/cli.mjs …` directly, so if
  `mcp/node_modules` is absent every tool call fails the same way an
  unrelated bug would. Run `cd mcp && npm ci` first.
- **Windows: prefer `127.0.0.1` over `localhost`.** `localhost` can resolve to
  `::1` first while the API binds IPv4 (`server/src/server.ts`). If
  `list_agents` reports "not reachable" with the API clearly running, set
  `DEVDIGEST_API_URL=http://127.0.0.1:3001`.
- **`npm`/`npx` are never used to launch the server.** The `.cmd` shim ENOENTs
  under `spawnSync`-style launch on Windows, and `npm run` prints its
  `> pkg@ver script` banner to **stdout**, which would corrupt the JSON-RPC
  stream. `.mcp.json` runs `node` directly against the tsx CLI file.

## Read when

- Architecture, tool table, env vars, `.mcp.json`, troubleshooting →
  `./README.md` — **read before adding or changing an MCP tool**
- The canonical tool descriptions and argument shapes →
  `../specs/08-mcp-server.md` → *Final tool descriptions* — **read before
  editing any tool's description or input schema**
- API and DI map → `../server/README.md` — **read before adding a call this
  package makes**
- Learned decisions → `INSIGHTS.md` — **read it before changing anything
  here**, and run `/engineering-insights` at the end of the task to append
  what this session learned
