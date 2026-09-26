# Development Plan: `@devdigest/mcp`, a local stdio MCP server with five tools over the DevDigest API

**Plan ID:** 06-devdigest-mcp  ·  **Packages:** `mcp/` (new), plus doc/CI/gate edits at the repo root  ·  **Assumptions:** (a) the API is already running on the host when the MCP server is used. (b) `mcp/` is the fifth standalone npm package and gets the same treatment as `e2e/`/`reviewer-core/`. (c) No server code changes (see Non-goals).

## Summary
We add a new standalone npm package `mcp/` (`@devdigest/mcp`), a stdio MCP server named `devdigest`. It is a thin HTTP adapter over the existing Fastify API (`DEVDIGEST_API_URL`, default `http://localhost:3001`) and exposes five tools: `list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, and `get_blast_radius` (a stub). It never imports server runtime code. The only cross-package import is the `@devdigest/shared` Zod contracts through a tsconfig path alias, used the same way reviewer-core uses them, to parse API responses. `run_agent_on_pr` returns a result rather than an operation handle: it starts the run, polls with backoff while sending MCP progress notifications, and returns the concise review. If it hits its wait limit it returns `status:"running"` instead. Everything is tested hermetically: SDK `InMemoryTransport` plus an injected fake `fetch`, a stdio spawn test, and a tools/list size budget test. Nothing needs Docker.

## Goal / Non-goals
**Goal:** the five tools above, exposed to Claude Code as `mcp__devdigest__<tool>` through a committed project-scope `.mcp.json`, with docs, CI and pre-PR gate coverage.

**Non-goals:**
- **No blast-radius implementation.** The stub keeps the final input shape (`repo`, `pr`) and marks a TODO seam.
- **No HTTP/SSE transport. No auth.** The API uses `LocalNoAuthProvider`.
- **No new server routes and no server edits.** Two small server changes were considered and rejected:
  - A `GET /repos/:id/pulls/:number` route would avoid the GitHub sync on PR resolution (see Risks). Not needed for correctness.
  - Fixing the stale "(synchronous)" comment in `review-api.ts:41-44`. It is comment-only, but it touches a shared contract that the client mirrors.
- **No SSE consumption of `GET /runs/:id/events`** (`server/src/modules/reviews/routes.ts:48`). Polling first; SSE is a later upgrade.
- **No write tools other than `run_agent_on_pr`:**
  - `get_conventions` never calls `POST .../extract`.
  - Cancellation never calls `POST /runs/:id/cancel`.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | npm vs pnpm by lockfile (`:35`, `:63`); `.js` relative imports; `*.it.test.ts`; `CLAUDE.md` stub; lock-files are do-not-touch (`:102`); Layout (`:47`) and Commands (`:17-23`) rows to extend; "Four standalone packages" (`:50`) |
| [README.md](README.md) | package table (`:12-18`); L04 row `devdigest-mcp server · Blast Radius` (`:87`); Testing & CI table (`:142-148`); per-package README links (`:61-65`) |
| [TESTING.md](TESTING.md) | suite map (`:25-33`); CI is path-filtered per package, and cross-package aliases go in `paths:` (`:77+`) |
| [server/README.md](server/README.md) | routes at root, no prefix; global 120/min rate limit plus tighter per-route caps (`:54-56`); error envelope; validation → 422 |
| `server/src/modules/index.ts:26-37` | module registry, no `/api` prefix |
| `server/src/app.ts:96,100` | global rate limit 120/min; `GET /health` exempt |
| `server/src/server.ts:29` | API listens on `host: '0.0.0.0'` (IPv4) |
| `server/src/modules/reviews/routes.ts:27-44,95-104,129-132` | `POST /pulls/:id/review` (10/min, `RunRequest.parse(req.body ?? {})`); `GET /pulls/:id/runs`; `GET /pulls/:id/runs/active`; `GET /pulls/:id/reviews` |
| `server/src/modules/reviews/service.ts:46-57,103-139` | `all` → enabled agents only; `agentId` → any agent, enabled or not; run rows created up front; `void executor.executeRuns` at `:133` = async; returns `reviews: []` |
| `server/src/modules/reviews/run-executor.ts:243-280` | review and findings are persisted **before** `completeAgentRun({status:'done'})`, so reading reviews after seeing `done` is race-free |
| `server/src/modules/reviews/repository/review.repo.ts:57-66`, `run.repo.ts:40-50` | reviews and runs are ordered newest first |
| `server/src/db/schema/runs.ts:35` | `agent_runs.status` is nullable text |
| `server/src/modules/pulls/routes.ts:33-112,190-193` | `GET /repos/:id/pulls` syncs from GitHub **and** backfills up to 10 PR details when a token exists; `id: r.id` is always set in practice |
| `server/src/modules/_shared/schemas.ts:11` | every `/:id` is `z.string().uuid()` |
| `server/src/modules/agents/routes.ts:87` | `GET /agents` returns all agents (the MCP filters by `enabled`) |
| `server/src/modules/conventions/routes.ts:51-56` | `GET /repos/:id/conventions`, 404 if repo unknown |
| `server/src/vendor/shared/contracts/platform.ts:143,160-161,211,270,277` | `Repo`, `PrMeta` (`id` nullish), `PrDetail`, `RunRequest`, `ApiErrorBody` |
| `server/src/vendor/shared/contracts/review-api.ts:15-57` | `FindingRecord`, `ReviewRecord`, `ReviewRunResponse` |
| `server/src/vendor/shared/contracts/findings.ts:11,63` | `Severity`, `Finding` |
| `server/src/vendor/shared/contracts/trace.ts:115` | `RunSummary` |
| `server/src/vendor/shared/contracts/knowledge.ts:243,264,284-289,350` | `ConventionCandidate`, `ConventionScan`, `ConventionsPage` (API returns **non-rejected** candidates plus `rejected_count`), `Agent` |
| `server/src/vendor/shared/contracts/brief.ts:39` · `server/src/modules/repo-intel/types.ts:147` | future blast-radius contract and facade |
| `server/src/vendor/shared/*.ts` | only external import is `zod`. The barrel is safe to load in a process with no server deps |
| `server/pnpm-lock.yaml:2979`, `reviewer-core/package-lock.json:3663` | both lock `zod@3.25.76` |
| `e2e/package.json`, `e2e/tsconfig.json`, `e2e/eslint.config.mjs` | package template |
| `reviewer-core/tsconfig.json`, `reviewer-core/vitest.config.ts` | `paths` for `@devdigest/shared` and the zod pin; vitest alias pattern |
| `.github/workflows/reviewer-core.yml` | CI template |
| `.claude/hooks/pr-self-review-gate.mjs:65-72,88-165,180-199,435-442`, `.claude/skills/pr-self-review/routing.md` | the gate knows exactly four packages. `mcp/src/**` is currently **unrouted**, and no lint or typecheck runs for it |
| `client/messages/en/conventions.json:25` · `client/src/app/repos/[repoId]/conventions/page.tsx` | the studio surface where conventions are scanned |
| `server/src/db/seed.ts:92,204-248` | fixtures: `acme/payments-api`, and 5 agents named "General/Security/Performance/Test Quality/API Contract Reviewer" |
| [INSIGHTS.md](INSIGHTS.md), [server/INSIGHTS.md](server/INSIGHTS.md), [e2e/INSIGHTS.md](e2e/INSIGHTS.md), `reviewer-core/INSIGHTS.md` (empty) | see next section |
| npm registry (`npm view`, 2026-09-26) | `@modelcontextprotocol/sdk@1.30.1`: peer and dep `zod: ^3.25 \|\| ^4.0`, `@cfworker/json-schema` optional, node >=18. `zod@4.6.5` latest. `tsx@4.23.15`, bin `dist/cli.mjs`. `@modelcontextprotocol/inspector@2.8.0`. `@modelcontextprotocol/server@2.1.0` exists (v2 line, **do not use**) |

## Insights that bind this work
1. **`@devdigest/shared` is two physical copies; the server copy is canonical.** [INSIGHTS.md:144](INSIGHTS.md:144).
   - `mcp/` aliases **only** `../server/src/vendor/shared` (as `reviewer-core/tsconfig.json` does).
   - No contract is changed, so no client mirror edit is needed.
   - `mcp.yml` adds `server/src/vendor/shared/**` to its path filter so contract drift re-runs the MCP suite.
2. **Stub `fetch`, don't mock the network.** [server/INSIGHTS.md:227](server/INSIGHTS.md:227): `AbortSignal.timeout()` on the global `fetch`, tested with a stubbed `fetchImpl` returning `new Response(...)`.
   - The API client takes an injected `fetchImpl`.
   - The fake DevDigest API is a `fetchImpl`, so there is no `undici` MockAgent dependency, no server, and no Docker.
3. **Windows `.cmd` shims fail to spawn.** [INSIGHTS.md:232](INSIGHTS.md:232): `spawnSync('pnpm')` hits ENOENT on Windows because the binary is `pnpm.cmd`.
   - `.mcp.json` launches `node` (a real executable) with the tsx CLI file path. It never uses `npx`/`npm`: `npx.cmd` needs a `cmd /c` wrapper on Windows.
   - `npm run` also prints its `> pkg@ver script` banner to **stdout**, which would corrupt the JSON-RPC stream.

Also applied:
- [server/INSIGHTS.md:192](server/INSIGHTS.md:192): an "optional body" is not a thing on this stack. Every POST sends an explicit JSON body with `content-type: application/json`.
- [INSIGHTS.md:253](INSIGHTS.md:253): `localhost` resolves to `::1` first on Windows (see Risks).
- [INSIGHTS.md:137](INSIGHTS.md:137): unknown cost is `null`, never `0`. Anything that surfaces `cost_usd` passes `null` through.
- [e2e/INSIGHTS.md:52](e2e/INSIGHTS.md:52): a missing external runtime looks like a total regression. The README troubleshooting section names the "forgot `npm ci` in `mcp/`" signature.

**"What Doesn't Work" check:** no step repeats a recorded dead end.
- The Windows `import.meta.url === file://argv[1]` guard trap ([INSIGHTS.md:43](INSIGHTS.md:43)) is avoided because `src/index.ts` has no "am I main" guard. It is only ever run as an entry.
- The symlinked `CLAUDE.md` trap ([INSIGHTS.md:77](INSIGHTS.md:77)) is avoided by using the `@AGENTS.md` stub.

## Constraints
- **Process isolation.**
  - `mcp/src/**` must not import from `../server/**`, `../reviewer-core/**`, `pino`, `drizzle-orm`, `fastify`, or `postgres`. It is enforced by `no-restricted-imports` in `mcp/eslint.config.mjs`.
  - `@devdigest/shared` is the only allowed cross-package import. Its files import only `zod` plus type-only local files (verified).
- **stdout is the protocol channel.** Only `StdioServerTransport` writes to it. All logs go to `process.stderr`, and `no-console` is `error` except `console.error`/`console.warn`.
- **Contract-once.** API responses are parsed with shared schemas (`z.array(Repo)`, `z.array(PrMeta)`, `z.array(Agent)`, `ReviewRunResponse`, `z.array(RunSummary)`, `z.array(ReviewRecord)`, `ConventionsPage`, `ApiErrorBody`). Response shapes are never redefined. Tool **input** schemas are MCP-local, which is correct: they are a different contract.
- **ESM.** Relative imports carry `.js`. SDK subpaths also carry `.js` (`@modelcontextprotocol/sdk/server/mcp.js`).
- **npm, not pnpm** in `mcp/`. `mcp/package-lock.json` is generated by `npm install` in `mcp/` and never hand-edited. The other four lock-files are not touched.
- **Test naming:** all tests are `*.test.ts` (none touch Postgres, so there are no `*.it.test.ts` files).
- **Docs:** `mcp/AGENTS.md` holds content; `mcp/CLAUDE.md` is the two-line `@AGENTS.md` stub.
- **Secrets:** none. `.mcp.json` carries only `DEVDIGEST_API_URL`. Never set `enableAllProjectMcpServers` in the committed `.claude/settings.json`.
- **Untrusted text egress.** PR content and LLM output (finding titles, rationales, summaries, `run.error`) are returned only as JSON **data fields**. MCP-authored strings (`hint`, error messages) are templates that interpolate only identifiers and never concatenate untrusted text. Error text never includes stacks, zod issue dumps, or URL credentials (show `new URL(base).origin` only).
- **Do-not-touch nearby:** `server/src/vendor/shared/**` (read-only for this task); the four existing lock-files; `reviewer-core/src/grounding.ts` / `INJECTION_GUARD` (irrelevant; do not open).

## Skill contract
`routing.md` has **no route for `mcp/`** today: `PACKAGES` is at `pr-self-review-gate.mjs:65`, and `mcp/src/*.ts` falls to `unrouted`. The skills below are derived from the closest existing group, `engine` (`typescript-expert` always; `security` on the boundary where untrusted text flows; `zod` on schema files). Step 14 encodes exactly this in `ROUTES` so the two cannot drift.

| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `mcp/src/api-client.ts`, `mcp/src/resolve.ts`, `mcp/src/config.ts` | `typescript-expert`, `zod`, `security` | HTTP boundary to the API, parsing with shared schemas, env validation, error text hygiene |
| `mcp/src/server.ts`, `mcp/src/tools/**`, `mcp/src/format.ts` | `typescript-expert`, `zod`, `security` | tool input schemas; untrusted PR/LLM text leaves the process here |
| `mcp/src/index.ts`, `mcp/src/log.ts`, `mcp/src/errors.ts`, `mcp/src/wait.ts` | `typescript-expert` | process and transport wiring, async polling |
| `mcp/test/**`, `mcp/*.config.*`, `mcp/package.json`, `.mcp.json`, `.github/workflows/mcp.yml`, docs, `.claude/hooks/pr-self-review-gate.mjs`, `routing.md` | none (convention-only in the gate) | static rules and machine checks only |
| any `INSIGHTS.md` | `engineering-insights` | append-only format |
| end of task | `pr-self-review` | the pre-PR gate |

## Proposed `mcp/` tree
```
mcp/
  package.json            npm package @devdigest/mcp; scripts lint/typecheck/test/inspect
  package-lock.json       generated by `npm install` (never hand-edited)
  tsconfig.json           reviewer-core pattern: Bundler resolution, paths @devdigest/shared + zod pin, noEmit
  eslint.config.mjs       e2e pattern + no-console + no-restricted-imports (server/pino/drizzle/fastify)
  vitest.config.ts        aliases @devdigest/shared → ../server/src/vendor/shared, zod → ./node_modules/zod
  AGENTS.md               module map (commands, layout, conventions, do-not-touch, gotchas, read-when)
  CLAUDE.md               two-line stub: HTML comment + @AGENTS.md
  README.md               architecture source of truth: tools, env, .mcp.json, flows, troubleshooting, homework seam
  INSIGHTS.md             empty fixed sections (copy the header/sections of reviewer-core/INSIGHTS.md)
  src/
    index.ts              entry: loadConfig → createApiClient → createServer → StdioServerTransport; stderr-only
    config.ts             zod-parsed env: apiUrl, waitMs, pollMs, httpTimeoutMs
    log.ts                log(level, msg, meta?) → process.stderr (single line)
    errors.ts             ToolError (actionable, user-facing) · ApiError (status/kind) · toErrorResult()
    api-client.ts         createApiClient({baseUrl, fetchImpl, timeoutMs}) — one typed method per endpoint
    resolve.ts            createResolver(api) — repo/pr/agent resolution with per-call memo
    format.ts             severity sort, concise/detailed shaping, clip(), caps, truncation block, char guard
    wait.ts               waitForRuns(): poll + backoff + progress + wait limit + abort
    server.ts             createServer(deps) → McpServer('devdigest'); registers the five tools; wraps handlers
    tools/
      params.ts           shared zod fragments: repo, pr, responseFormat
      list-agents.ts      list_agents
      run-agent-on-pr.ts  run_agent_on_pr
      get-findings.ts     get_findings
      get-conventions.ts  get_conventions
      get-blast-radius.ts get_blast_radius (stub + TODO seam)
  test/
    helpers/fixtures.ts   typed fixtures (Repo/PrMeta/Agent/RunSummary/ReviewRecord/ConventionsPage) with real uuids
    helpers/fake-api.ts   fake DevDigest API as a fetchImpl: routes by method+path, mutable state, call log
    helpers/connect.ts    createServer + InMemoryTransport.createLinkedPair + Client; fake clock
    config.test.ts · api-client.test.ts · resolve.test.ts · format.test.ts · wait.test.ts
    list-agents.test.ts · run-agent-on-pr.test.ts · get-findings.test.ts · get-conventions.test.ts · get-blast-radius.test.ts
    tools-list-budget.test.ts · stdout.test.ts · stdio.test.ts
```
Root: `.mcp.json` (new) · `.github/workflows/mcp.yml` (new) · `AGENTS.md`, `README.md`, `TESTING.md` (edit) · `.claude/hooks/pr-self-review-gate.mjs` and `.claude/skills/pr-self-review/routing.md` (edit, step 14).

## Final tool descriptions (canonical — copy verbatim)

These strings are the product: they are the only thing the model sees before it decides to call a tool. The implementer copies them **character for character** into `src/server.ts`, `src/tools/*.ts` and `src/tools/params.ts`. Steps 6–9 refer here instead of repeating them. Any later change to a string goes through this section first, and `tools-list-budget.test.ts` (step 10) is the regression guard.

Every description follows one shape: **what it returns · when to call it · when not to / what to do instead.** The rules each one serves are listed under it. Names carry no `devdigest` prefix: Claude Code already exposes them as `mcp__devdigest__<name>`.

### Server `instructions` (156 chars)

```
Local DevDigest PR-review studio: run review agents on imported pull requests and read findings and repo conventions; repos are owner/name, PRs are numbers.
```
- Rules: *token cost at start* — one sentence, ≤200 chars, because it is injected into the system prompt whole and is never deferred; *flat arguments* — it states the identifier format once, so no per-tool description has to repeat it.

### `list_agents` (146 chars)

```
List the enabled DevDigest review agents with id, name, provider and model. Call it to get a valid agent name for run_agent_on_pr or get_findings.
```
- Rules: *concise structured response* — names the exact fields returned; *errors lead forward* — this is the tool that the not-found errors of the other tools point to, so its description says what it is for.

### `run_agent_on_pr` (316 chars)

```
Run a DevDigest review agent (or "all") on an imported pull request and wait for its verdict, score and findings. Slow (minutes) and spends LLM tokens: to read an existing review use get_findings. If the wait limit passes it returns status "running" with run ids — call get_findings with run_id later, do not re-run.
```
- Rules: *result, not operation* — "wait for its verdict, score and findings" promises the result, not a handle; *when not to call* — "Slow … spends LLM tokens … use get_findings" steers the agent away from the one tool that costs money; *errors lead forward* — the time-out branch names the follow-up (`get_findings` with `run_id`) and forbids the costly retry, which is also why attach-to-in-flight exists.

### `get_findings` (200 chars)

```
Read the latest saved DevDigest review of a pull request, one entry per agent: verdict, score and findings sorted by severity. Never starts a review (use run_agent_on_pr). Narrow with agent or run_id.
```
- Rules: *concise structured response* — "one entry per agent … sorted by severity" tells the agent the shape before it calls; *when not to* — "Never starts a review" makes the read/write split explicit, matching `readOnlyHint: true`; *flat arguments* — the optional filters are named as plain params.

### `get_conventions` (212 chars)

```
Read the coding conventions DevDigest extracted from a repository: rule, category, confidence, status and evidence file:line. Read-only — if no scan exists it says so; scans are started from the DevDigest studio.
```
- Rules: *concise structured response* — lists the fields, and says `file:line`, not snippets (untrusted repo code never leaves the API through this tool); *errors lead forward* — the no-scan case is a normal result that says where scans come from, so the agent does not hunt for an "extract" tool that does not exist here.

### `get_blast_radius` (stub, 184 chars)

```
Not implemented yet — always returns status "not_implemented"; do not call it to answer a real question. Will list the symbols a pull request changes and the code that depends on them.
```
- Rules: *no wasted turns / no retries* — the limitation is the first clause, so the agent never selects it for real work, and the handler returns a normal (non-`isError`) result so nothing invites a retry; *homework seam* — the second sentence fixes the intent and the input shape (`repo`, `pr`) that the future implementation keeps; *token cost* — no `outputSchema`, so the stub costs one line, not a schema.

### Parameter descriptions (`params.ts` and per-tool)

| Param | Where | `.describe()` text |
|---|---|---|
| `repo` | all but `list_agents` | `Repository "owner/name" (or its id).` |
| `pr` | run / findings / blast | `Pull request number (or its id).` |
| `response_format` | run / findings | `"detailed" adds rationale, confidence and summary.` |
| `agent` | `run_agent_on_pr` | `Agent name from list_agents (case-insensitive), its id, or "all".` |
| `agent` | `get_findings` | `Only this agent (name or id).` |
| `run_id` | `get_findings` | `Only the review from this run (returned by run_agent_on_pr).` |
| `status` | `get_conventions` | *(none — the enum `accepted \| pending \| any` is self-describing; a description would only repeat it)* |

- Rules: *flat arguments* — every param is a primitive with a one-line meaning, no nested objects; *token cost* — a `.describe()` exists only where it changes behaviour (the `"all"` sentinel, the `run_id` provenance, what `detailed` adds); the `concise` default is not described because the enum default already carries it.

### Budget check (sum of the six strings above)

Descriptions: 146 + 316 + 200 + 212 + 184 = **1,058 chars** (budget in step 10: ≤1,400). Instructions: 156 (≤200). The whole `tools/list` payload, schemas included, is estimated at ~3.3k chars (budget ≤4,000, ≈1k tokens for the entire server).

## Steps

### 0. Verify dependency versions before pinning (read-only)
- **Do:** run the commands below from any folder.
  - Expected (as of 2026-09-26): sdk `1.30.1`, peer `zod: '^3.25 || ^4.0'`, zod `4.6.5`, tsx `4.23.15` with bin `dist/cli.mjs`.
  - If the SDK's latest 1.x major has changed, stay on `^1.x` anyway.
  - **Do not** use `@modelcontextprotocol/server` (the v2 line, `2.1.0`) unless it is separately verified and approved.
- **Done when:** the versions are recorded in the step-1 commit message or the README "Versions" note.
- **Verify:** `npm view @modelcontextprotocol/sdk version peerDependencies` · `npm view zod version` · `npm view tsx version bin`

### 1. Scaffold the package
- **Files:** `mcp/package.json` · `mcp/tsconfig.json` · `mcp/eslint.config.mjs` · `mcp/vitest.config.ts` (all new). `mcp/package-lock.json` (new, generated).
- **Skills:** `typescript-expert`
- **Do:**
  - **`package.json`**, mirroring `e2e/package.json`:
    - `"name":"@devdigest/mcp"`, `"private":true`, `"type":"module"`, `"engines":{"node":">=22"}`.
    - Scripts: `"typecheck":"tsc --noEmit -p tsconfig.json"`, `"lint":"eslint ."`, `"test":"vitest run"`, `"inspect":"npx @modelcontextprotocol/inspector node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json src/index.ts"`.
    - **No `start` script is used by `.mcp.json`**, because of the npm stdout banner.
    - `dependencies`: `@modelcontextprotocol/sdk` `^1.30.1`, `zod` `^3.25.76`, `tsx` `^4.23.15`.
    - Why these pins:
      - `zod` stays on 3.x to match the server lock (`server/pnpm-lock.yaml:2979`). The shared contracts use the v3 API, e.g. two-arg `z.record` at `platform.ts:97`.
      - `tsx` is a **runtime** dependency because `.mcp.json` runs it.
    - `devDependencies` as in e2e plus reviewer-core's `vitest` `^2.1.8`: `@eslint/js`, `@types/node ^22`, `eslint`, `typescript`, `typescript-eslint`, `vitest`.
  - **`tsconfig.json`**: copy `reviewer-core/tsconfig.json` verbatim, including `paths` (`@devdigest/shared` → `../server/src/vendor/shared/index.ts`, `@devdigest/shared/*`, `zod` → `./node_modules/zod`, `zod/*`), `noUncheckedIndexedAccess`, `noEmit`. Set `"include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]`.
  - **`eslint.config.mjs`**: copy `e2e/eslint.config.mjs` and add:
    - `'no-console': ['error', { allow: ['error', 'warn'] }]`
    - `no-restricted-imports` with `patterns: [{ group: ['**/server/**', '**/reviewer-core/**'], message: 'mcp is an HTTP adapter; import contracts via @devdigest/shared only' }]` and `paths` for `pino`, `drizzle-orm`, `fastify`, `postgres`.
    - Keep the header comment ("installs with **npm**").
  - **`vitest.config.ts`**: `resolve.alias` → `'@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared/index.ts')` **and** `zod: path.resolve(__dirname, 'node_modules/zod')`. The zod alias makes the shared files resolve zod from `mcp/`, so CI does not need `server/node_modules`. Set `test.environment:'node'`, `include:['test/**/*.test.ts']`, and no globals (import from `vitest`).
  - Run `npm install` **in `mcp/`** to generate the lockfile.
  - Add a placeholder `src/index.ts` exporting nothing, so typecheck has input.
- **Done when:**
  - `mcp/node_modules/tsx/dist/cli.mjs` exists.
  - `npm run typecheck` and `npm run lint` pass.
  - `git status` shows no change to any other lock-file.
- **Verify:** `cd mcp && npm run typecheck && npm run lint`

### 2. Config, logging, errors
- **Files:** `mcp/src/config.ts` · `mcp/src/log.ts` · `mcp/src/errors.ts` · `mcp/test/config.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - **`loadConfig(env = process.env): Config`** parses with zod:
    - `DEVDIGEST_API_URL`: `z.string().url()`, default `http://localhost:3001`, trailing `/` stripped.
    - `DEVDIGEST_MCP_WAIT_MS`: `z.coerce.number().int().min(5_000).max(3_600_000)`, default `600_000`.
    - `DEVDIGEST_MCP_POLL_MS`: min `500`, default `2_000`.
    - `httpTimeoutMs`: constant `30_000`. `GET /repos/:id/pulls` may sync from GitHub.
    - On invalid env it throws `Error('Invalid DEVDIGEST_* environment: <var names>')`. No values in the message.
  - **`log(level, msg, meta?)`** writes one line to `process.stderr` only.
  - **`ToolError(message)`**: user-facing and actionable.
  - **`ApiError`** has `{ kind: 'unreachable'|'not_found'|'rate_limited'|'bad_request'|'server'|'contract', status?, path, serverMessage? }`.
  - **`toErrorResult(err)`** returns `{ content:[{type:'text', text}], isError:true }`:
    - `ToolError` → its message.
    - `unreachable` → `DevDigest API is not reachable at <origin>. Start it with ./scripts/dev.sh (or cd server && pnpm dev), then retry.`
    - `rate_limited` → `DevDigest API rate limit hit on <METHOD path> (reviews: 10/min). Wait a minute, then retry.`
    - `server` → `DevDigest API error <status> on <METHOD path>. Check the API terminal log.`
    - `contract` → `DevDigest API returned an unexpected shape for <METHOD path> (API and MCP versions differ?).`
    - Anything else → `Internal error in the devdigest MCP server (see its stderr log).`, with the stack logged to stderr only.
- **Done when:** config tests cover the defaults, overrides, an invalid URL, out-of-range wait, and no values leaked in the message.
- **Verify:** `cd mcp && npx vitest run test/config.test.ts && npm run typecheck`

### 3. API client + fake API
- **Files:** `mcp/src/api-client.ts` · `mcp/test/helpers/fixtures.ts` · `mcp/test/helpers/fake-api.ts` · `mcp/test/api-client.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - **`createApiClient({ baseUrl, fetchImpl = fetch, timeoutMs })`** returns the methods below. Each validates with the shared schema via `safeParse` and throws `ApiError('contract')` on mismatch. Path ids go through `encodeURIComponent`.
    - `listRepos(): Repo[]`: `GET /repos`
    - `listPulls(repoId): PrMeta[]`: `GET /repos/:id/pulls`
    - `listAgents(): Agent[]`: `GET /agents`
    - `startReview(prId, body: RunRequest): ReviewRunResponse`: `POST /pulls/:id/review`, **always** `JSON.stringify(body)` with `content-type: application/json` (server/INSIGHTS.md:192)
    - `listRuns(prId): RunSummary[]`: `GET /pulls/:id/runs`
    - `listReviews(prId): ReviewRecord[]`: `GET /pulls/:id/reviews`
    - `getConventions(repoId): ConventionsPage`: `GET /repos/:id/conventions`
  - Every method takes an optional `signal`, combined as `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])` (Node ≥22).
  - Error mapping:
    - fetch `TypeError` or abort by timeout → `unreachable`
    - 404 → `not_found`
    - 429 → `rate_limited`
    - 400/422 → `bad_request`, with `ApiErrorBody.safeParse(json).data?.error.message` clipped to 200 chars
    - ≥500 → `server` (body **not** included)
  - **`fake-api.ts`** exports `createFakeApi(state)` → `{ fetchImpl, calls, state }`. It routes on `new URL(req.url).pathname` and method, returns `new Response(JSON.stringify(x), {status, headers})`, and has knobs:
    - `runsScript`: statuses returned per poll
    - `failNext(path, status)`
    - `unreachable: true`, which throws `TypeError('fetch failed')`
  - **`fixtures.ts`**: repo `acme/payments-api` plus a second repo `acme/web`; PRs #482 and #480; five agents named as in `server/src/db/seed.ts:204-248`, one of them set `enabled:false`; reviews with mixed severities; a conventions page with a scan. All ids are uuids. Values are typed with the shared types so fixture drift fails typecheck.
- **Done when:** tests prove each of the following:
  - schema parsing
  - the POST sends a JSON body and content-type
  - each error kind maps correctly
  - the unreachable message shows the origin without credentials (`http://u:p@host:1` → `http://host:1`)
  - 5xx text does not contain the response body
- **Verify:** `cd mcp && npx vitest run test/api-client.test.ts`

### 4. Identifier resolver
- **Files:** `mcp/src/resolve.ts` · `mcp/test/resolve.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - **`createResolver(api)`** is created **once per tool call**. It memoises `listRepos`, `listAgents`, and `listPulls(repoId)` in a local `Map` (no cross-call cache).
  - **`resolveRepo(input)`** returns `{ id, full_name }`:
    - UUID (`/^[0-9a-f]{8}-…-[0-9a-f]{12}$/i`) → match on `id`.
    - Contains `/` → case-insensitive match on `full_name`.
    - Otherwise → case-insensitive match on `name`, which must be unique.
    - 0 matches → `ToolError("Repo '<input>' not found. Known repos: a/b, c/d. Add a repo in the DevDigest studio first.")` (≤10 names, `+N more`).
    - Multiple matches → `ToolError("Repo '<input>' is ambiguous: a/x, b/x. Pass it as owner/name.")`.
    - If there are no repos at all, say `No repos imported yet — add one in the DevDigest studio.`
  - **`resolvePr(repo, input: number|string)`** returns `{ id, number, label: "<full_name>#<n>" }`:
    - Accepts `482`, `"482"`, `"#482"`, or a uuid. Always looks the PR up in `listPulls(repo.id)`, which also verifies membership and yields the number.
    - Not found → `ToolError("PR #999 not found in acme/payments-api. Known PRs: #482, #480. Import PRs in the DevDigest studio.")` (≤10).
    - Found with `id` null or undefined (`platform.ts:161` allows it) → `ToolError("PR #482 has no DevDigest id yet — open the repo in the studio to import it, then retry.")`.
  - **`resolveAgent(input, { enabledOnly })`** returns `{ kind:'all' } | { kind:'one', id, name }`:
    - Trim, then `"all"` (case-insensitive) → all.
    - uuid → `id`.
    - Otherwise: exact case-insensitive name, then a **unique** case-insensitive substring (so `security` → "Security Reviewer").
    - Not found → `ToolError("Agent '<x>' not found — call list_agents for valid names.")`.
    - Several substring hits → `ToolError("Agent '<x>' matches several agents: A, B. Use the full name from list_agents.")`.
    - `enabledOnly` with a disabled match → `ToolError("Agent '<name>' is disabled — enable it in the DevDigest studio or pick one from list_agents.")`.
    - `"all"` when `enabledOnly:false` (the `get_findings` filter) → treated as no filter.
  - Clip every echoed input to 100 chars.
- **Done when:** tests cover every branch above, including that the memo calls `GET /repos` once for two resolutions.
- **Verify:** `cd mcp && npx vitest run test/resolve.test.ts`

### 5. Response shaping
- **Files:** `mcp/src/format.ts` · `mcp/test/format.test.ts` (new)
- **Skills:** `typescript-expert`, `security`
- **Do:**
  - Constants: `MAX_FINDINGS_CONCISE = 50`, `MAX_FINDINGS_DETAILED = 20`, `MAX_LIST = 50` (conventions), `MAX_OUTPUT_CHARS = 40_000` (≈10k tokens, far below Claude Code's 25k `MAX_MCP_OUTPUT_TOKENS`).
  - `clip(s, n)` appends `…`.
  - **`sortFindings`**: severity `CRITICAL > WARNING > SUGGESTION`, then `confidence` descending, then `file`, then `start_line`.
  - **`shapeReviews(reviews, runs, format)`** returns `{ reviews: AgentReview[], truncated? }`:
    - `AgentReview` (concise) = `{ agent_name, run_id, run_status, verdict, score, counts:{CRITICAL,WARNING,SUGGESTION}, findings:[{severity, category, title, file, start_line, end_line, suggestion?}] }`, where `suggestion` is clipped to 200 chars and omitted when null.
    - Detailed adds `summary` (clip 1,000), `model`, `created_at`, `pr_id`, and the full `FindingRecord` per finding: `id`, `rationale` (clip 2,000), `suggestion` (clip 1,000), `confidence`, `kind`, trifecta fields when present, `accepted_at`, `dismissed_at`, `review_id`.
    - `cost_usd` from `RunSummary` is detailed-only and keeps `null`, never `0` (INSIGHTS.md:137).
    - Omit null or undefined keys in concise mode.
  - **Cap is global across agents:** the top-N by the sort above. When capped, add `truncated: { shown, total, hint: "Showing the N most severe findings. Narrow with agent or run_id." }`.
  - **`toTextResult(payload)`** does compact `JSON.stringify`. If the result exceeds `MAX_OUTPUT_CHARS`, halve the shown findings until it fits and update `truncated`.
- **Done when:** tests cover sort order, the global cap with an accurate truncation block, suggestion clipping, detailed fields, the char guard, and null cost preserved.
- **Verify:** `cd mcp && npx vitest run test/format.test.ts`

### 6. Server factory, shared params, `list_agents`, `get_blast_radius` (stub)
- **Files:** `mcp/src/server.ts` · `mcp/src/tools/params.ts` · `mcp/src/tools/list-agents.ts` · `mcp/src/tools/get-blast-radius.ts` · `mcp/test/helpers/connect.ts` · `mcp/test/list-agents.test.ts` · `mcp/test/get-blast-radius.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - **Server factory:** `createServer(deps: { api: ApiClient; config: Config; clock?: { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> } }): McpServer`.
    - `new McpServer({ name: 'devdigest', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS })`.
    - Each tool module exports `register(server, deps)`.
    - A `safe(handler)` wrapper catches everything and returns `toErrorResult(err)`, so SDK default error text (raw `error.message`) never reaches the agent.
    - **No `outputSchema` on any tool, the stub included:** it would add schema bytes to every session and freeze the homework's return shape before it exists.
    - No `title` fields: the names are self-explanatory and every byte counts.
  - **`SERVER_INSTRUCTIONS`**: exactly one sentence, ≤ 200 chars.
    - Decision: set it. Under Claude Code's deferred MCP tool loading it is the only always-visible text that routes PR-review questions to this server.
    - Text: the canonical string from **Final tool descriptions → Server `instructions`**, verbatim.
  - **`params.ts`** (flat primitives only):
    ```ts
    export const repo = z.string().min(1).describe('Repository "owner/name" (or its id).');
    export const pr = z.union([z.number().int().positive(), z.string().min(1)]).describe('Pull request number (or its id).');
    export const responseFormat = z.enum(['concise', 'detailed']).default('concise').describe('"detailed" adds rationale, confidence and summary.');
    ```
  - **`list_agents`**
    - Description: **Final tool descriptions → `list_agents`**, verbatim.
    - `inputSchema: {}`
    - `annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }`
    - Handler: `api.listAgents()` → filter `enabled` → `{ agents: [{ id, name, description: clip(200), provider, model, enabled }] }`.
    - Never return `system_prompt` or `output_schema`.
    - Empty list → `{ agents: [], hint: "No enabled agents — enable one in the DevDigest studio." }`.
  - **`get_blast_radius`** (stub)
    - Description: **Final tool descriptions → `get_blast_radius`**, verbatim.
    - `inputSchema: { repo, pr }`
    - `annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }`
    - Handler makes **zero API calls** and returns a normal result (no `isError`): `{ status: "not_implemented", repo, pr, message: "Blast radius is not implemented yet (course lesson L04 homework). Use get_findings for review results." }`.
    - Above the body, a TODO block names the homework seam:
      1. `createResolver(api)` → `resolveRepo`, `resolvePr`.
      2. `GET /pulls/:id` → `PrDetail.files[].path` (`platform.ts:211`), via a new `api.getPull`.
      3. A **new server route** (e.g. `GET /pulls/:id/blast-radius`) backed by `RepoIntel.getBlastRadius(repoId, changedFiles)` (`server/src/modules/repo-intel/types.ts:147`) and returning `BlastRadius` (`shared/contracts/brief.ts:39`). The MCP process cannot call RepoIntel directly.
      4. Shape concise output from `changed_symbols` / `downstream` with the caps in `format.ts`.
  - **`connect.ts`**: `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`), `new Client({ name:'test', version:'0' })` (`.../client/index.js`), and a fake clock whose `sleep` advances `now` instantly.
  - **Zod fallback:** if `registerTool` types reject a v3 `ZodRawShape` with SDK 1.30.x, switch **only** `src/tools/**` to `import { z } from 'zod/v4'` (shipped inside zod 3.25). Keep `@devdigest/shared` on v3. Record the outcome in `mcp/INSIGHTS.md`.
- **Done when:**
  - `listTools()` over InMemoryTransport returns both tools.
  - `list_agents` omits the disabled fixture agent and `system_prompt`.
  - The stub returns `not_implemented` with `isError` falsy and `fake.calls.length === 0`.
- **Verify:** `cd mcp && npx vitest run test/list-agents.test.ts test/get-blast-radius.test.ts && npm run typecheck`

### 7. `get_findings`
- **Files:** `mcp/src/tools/get-findings.ts` · `mcp/test/get-findings.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - Description: **Final tool descriptions → `get_findings`**, verbatim.
  - `inputSchema`:
    ```ts
    { repo, pr,
      agent: z.string().min(1).optional().describe('Only this agent (name or id).'),
      run_id: z.string().uuid().optional().describe('Only the review from this run (returned by run_agent_on_pr).'),
      response_format: responseFormat }
    ```
  - `annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }`
  - Flow:
    - Resolve the repo and PR. If `agent` is given, resolve it with `enabledOnly:false`.
    - Fetch `listReviews` and `listRuns` in parallel.
    - Keep `kind === 'review'`. The list is newest first (`review.repo.ts:57-66`); take the **first per `agent_id ?? agent_name ?? id`**.
    - Apply the `agent` / `run_id` filters.
    - `run_status` comes from the matching `RunSummary.run_id`.
    - Add top-level `in_progress: [{ agent_name, run_id }]` for `status === 'running'` runs newer than that agent's review. Only when non-empty.
  - Special cases (all non-error):
    - `run_id` with no review and a run that is `running` → `{ pr:<label>, status:"running", run_id, hint:"Review still running — call get_findings again in a minute." }`.
    - Run `failed` or `cancelled` → `{ status:<s>, run_id, agent_name, error: clip(run.error, 300) }`.
    - Unknown `run_id` → `ToolError("Run '<id>' not found on <label>.")`.
    - No reviews at all → `{ pr:<label>, reviews: [], hint: "No review yet for <label> — call run_agent_on_pr." }`.
  - Output: `{ pr: label, reviews, in_progress?, truncated? }` via `format.ts`.
- **Done when:** tests cover latest-per-agent, the agent filter (substring name), the run_id filter across its three states, the no-review hint, the detailed shape, and truncation.
- **Verify:** `cd mcp && npx vitest run test/get-findings.test.ts`

### 8. `get_conventions`
- **Files:** `mcp/src/tools/get-conventions.ts` · `mcp/test/get-conventions.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - Description: **Final tool descriptions → `get_conventions`**, verbatim.
  - `inputSchema: { repo, status: z.enum(['accepted', 'pending', 'any']).default('any') }`. There is no `rejected` value because `GET /repos/:id/conventions` returns only non-rejected candidates (`knowledge.ts:284-289`). Surface `rejected_count` instead.
  - `annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }`
  - Output: `{ repo: full_name, scan: { status, finished_at?, model, candidates_grounded } | null, candidates: [{ category, rule: clip(300), confidence, status, evidence: "<path>:<line>" (":?" omitted when line null) }], rejected_count, truncated? }`.
    - Sort accepted first, then pending, then `confidence` descending. Cap at 50.
    - Never include `evidence_snippet`: it is repo code, untrusted, and bulky.
  - Special cases (all non-error):
    - `scan === null` and no candidates → `{ repo, scan: null, candidates: [], message: "No convention scan exists for <repo> yet. Scans are started from the repo's Conventions page in the DevDigest studio; this tool is read-only." }`.
    - Scan `running` → add `hint: "A scan is running — call get_conventions again in a minute."`.
    - Scan `failed` → include `scan.error` clipped to 300.
  - **Must never call any POST.**
- **Done when:** tests cover the default (both statuses), the status filter, the no-scan message, the running and failed scans, `path:line` formatting, the sort and cap, and `fake.calls` containing only GETs.
- **Verify:** `cd mcp && npx vitest run test/get-conventions.test.ts`

### 9. Waiting loop + `run_agent_on_pr`
- **Files:** `mcp/src/wait.ts` · `mcp/src/tools/run-agent-on-pr.ts` · `mcp/test/wait.test.ts` · `mcp/test/run-agent-on-pr.test.ts` (new)
- **Skills:** `typescript-expert`, `zod`, `security`
- **Do:**
  - **`waitForRuns({ api, prId, runIds, clock, waitMs, pollMs, signal, onTick })`** returns `{ state: 'terminal' | 'timeout' | 'aborted', runs: RunSummary[] }`.
    - Poll `GET /pulls/:id/runs`.
    - Interval starts at `pollMs` and grows ×1.5 per poll, capped at 5,000 ms. That is about 125 polls in 10 min, well inside the 120/min global limit even with the studio also polling.
    - Terminal when every run id has `status ∈ {done, failed, cancelled}`. `null` or `running` means keep waiting.
    - A run id absent for 3 consecutive polls is treated as terminal `missing`.
    - Stop on `signal.aborted` (client cancellation). The server run keeps going; this tool never cancels it.
    - `onTick(pollIndex, runs, elapsedMs)` after every poll.
  - **`run_agent_on_pr`**
    - Description: **Final tool descriptions → `run_agent_on_pr`**, verbatim.
    - `inputSchema`:
      ```ts
      { repo, pr,
        agent: z.string().min(1).describe('Agent name from list_agents (case-insensitive), its id, or "all".'),
        response_format: responseFormat }
      ```
    - `annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`
  - Flow:
    1. Resolve the repo, PR, and agent (`enabledOnly:true`).
    2. **In-flight guard** (decision; see Open questions). `listRuns` and filter `status === 'running'`:
       - If `kind:'one'` and that agent already has a running run → **attach** to it with no POST, and set `attached: true` in the output.
       - If `kind:'all'` and any running run exists → attach to all running runs.
       - Rationale: agents retry after a time-out, and each retry would spend LLM money and burn the 10/min cap (`reviews/routes.ts:29`).
    3. Otherwise `startReview(pr.id, kind==='all' ? { all: true } : { agentId })`. `runs: []` → `ToolError("No enabled agents to run — enable one in the DevDigest studio, then call list_agents.")`.
    4. `waitForRuns`, with `onTick` sending progress **only when** `extra._meta?.progressToken` is defined:
       ```ts
       extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress: pollIndex, message } })
       ```
       - `progress` strictly increases (poll index).
       - `message` e.g. `"1/2 agents finished — waiting on Security Reviewer (45s of 600s)"`.
       - No `total`.
       - Pass `extra.signal` through.
    5. On `timeout` or `aborted` → `{ pr: label, status: "running", run_ids, waited_s, hint: "Review still running. Call get_findings with run_id later; do not call run_agent_on_pr again." }`. No reviews fetch.
    6. On terminal → `listReviews` and keep reviews whose `run_id` is in `run_ids`. Failed, cancelled, or missing runs become entries `{ agent_name, run_id, run_status, error: clip(300) }`.
       - Top-level `status` is `done` (all done), `partial`, or `failed` (none done).
       - Output: `{ pr: label, status, attached?, reviews, truncated? }` via `format.ts`.
    7. `status === 'failed'` → `isError: true`, text `"Review failed for <label>: <agent>: <clipped error>. Check the agent's provider key/model in DevDigest Settings."`.
  - Relies on `run-executor.ts:243-280`: the review row exists before `done`.
- **Done when:** tests cover:
  - single agent (POST body `{agentId}`)
  - `"all"` (`{all:true}`)
  - `running → done` with progress events received when the client passes `onprogress`, and none without it
  - the wait limit via the fake clock: returns `running` plus run ids, and there is no `GET /reviews` call
  - partial and all-failed (isError)
  - attach-to-in-flight (zero POSTs)
  - zero-runs error
  - rate-limit 429 message
  - the backoff sequence in `wait.test.ts`
- **Verify:** `cd mcp && npx vitest run test/wait.test.ts test/run-agent-on-pr.test.ts`

### 10. Entry point, stdout hygiene, real stdio
- **Files:** `mcp/src/index.ts` (edit the placeholder) · `mcp/test/stdout.test.ts` · `mcp/test/stdio.test.ts` · `mcp/test/tools-list-budget.test.ts` (new)
- **Skills:** `typescript-expert`, `security`
- **Do:**
  - **`index.ts`**:
    - `loadConfig()` → `createApiClient` → `createServer` → `await server.connect(new StdioServerTransport())` (`@modelcontextprotocol/sdk/server/stdio.js`).
    - Log `devdigest MCP ready (api <origin>)` to **stderr**.
    - Add `process.on('uncaughtException' | 'unhandledRejection')` → stderr and `exit(1)`.
    - No main-module guard (INSIGHTS.md:43), no banner.
    - Do **not** health-check the API at start-up: tools report `unreachable` per call, so the server lists fine even when the API is down.
  - **`stdout.test.ts`**: `vi.spyOn(process.stdout, 'write')`, then run all five tools over InMemoryTransport, including an unreachable-API error path, a ToolError path, and an internal-error path. Assert zero calls.
  - **`stdio.test.ts`** (hermetic, ~20 s timeout):
    - Start a `node:http` fake API on `127.0.0.1:0` serving `/agents`.
    - `new StdioClientTransport({ command: process.execPath, args: [<mcp>/node_modules/tsx/dist/cli.mjs, '--tsconfig', <mcp>/tsconfig.json, <mcp>/src/index.ts], env: { ...process.env, DEVDIGEST_API_URL }, stderr: 'pipe' })`.
    - `listTools()` returns exactly five names. `list_agents` succeeds.
    - A second case uses an unused port: `list_agents` gives `isError` and text containing `not reachable`.
    - This test is also the **proof in CI** that the tsx + paths + zod resolution works without `server/node_modules`.
  - **`tools-list-budget.test.ts`**:
    - The names are exactly `['get_blast_radius','get_conventions','get_findings','list_agents','run_agent_on_pr']`. None contains `devdigest`.
    - The annotations per tool are as specified. No tool has `outputSchema`.
    - `instructions.length <= 200`.
    - Sum of `description` lengths ≤ **1,400** chars.
    - `JSON.stringify(tools).length` ≤ **4,000** chars. That is ≈1k tokens for the whole server; the estimate from the strings above is ~3.3k.
    - Log the measured numbers.
    - After the first green run, lower both budgets to measured + ~15% and record the measurement in `mcp/INSIGHTS.md`. A later failure means trim the text; raise the budget only with a justification.
- **Done when:** the full suite is green, and `npm run lint` shows no `no-console` or `no-restricted-imports` hits.
- **Verify:** `cd mcp && npm test && npm run lint && npm run typecheck`

### 11. `.mcp.json` + manual smoke test
- **Files:** `.mcp.json` (new, repo root)
- **Do:** commit
  ```json
  {
    "mcpServers": {
      "devdigest": {
        "type": "stdio",
        "command": "node",
        "args": [
          "${CLAUDE_PROJECT_DIR}/mcp/node_modules/tsx/dist/cli.mjs",
          "--tsconfig", "${CLAUDE_PROJECT_DIR}/mcp/tsconfig.json",
          "${CLAUDE_PROJECT_DIR}/mcp/src/index.ts"
        ],
        "env": { "DEVDIGEST_API_URL": "${DEVDIGEST_API_URL:-http://localhost:3001}" }
      }
    }
  }
  ```
  Why this shape:
  - `node` is a real executable on Windows (INSIGHTS.md:232).
  - `npm`/`npx` are out: the `.cmd` shim, plus npm's stdout banner.
  - `--tsconfig` is required because the working directory is not `mcp/`, and tsx must see `paths`.
  - **tsx, not dist:** `tsc` does not rewrite the `@devdigest/shared` alias, so a `dist/` would not resolve without adding a bundler. The repo already runs source through tsx (`server/package.json` `dev`), and reviewer-core never emits.
  - Args are an array, so the space in `D:\data\AI Course\…` is safe.
  - **Fallback** if `${CLAUDE_PROJECT_DIR}` is not expanded in `.mcp.json` by the installed Claude Code (`/mcp` shows the server failed, or a missing-variable warning): replace the three paths with repo-relative `mcp/...` paths. Claude Code starts project servers from the project root. Record which one worked in `mcp/INSIGHTS.md`.
- **Smoke (manual):**
  1. `./scripts/dev.sh`, then `cd mcp && npm ci`.
  2. `cd mcp && npm run inspect`, then call all five tools against the seeded `acme/payments-api` PR `482`.
  3. In Claude Code at the repo root: approve the project server when prompted. `/mcp` shows `devdigest` connected with 5 tools.
  4. `/context` shows the MCP tool cost. Record the number in `mcp/INSIGHTS.md`.
  5. Ask for, in order: `list_agents` · `get_findings repo acme/payments-api pr 482` · `get_conventions acme/payments-api` · `get_blast_radius` (expect `not_implemented`, no error) · `run_agent_on_pr … agent security` (needs an LLM key in Settings).
  6. Time the run. If Claude Code aborts the call before `DEVDIGEST_MCP_WAIT_MS`, document `MCP_TOOL_TIMEOUT` (ms) in `mcp/README.md` and record the finding.
- **Done when:** all five tools answer in Claude Code, and no stdout noise appears (`claude --debug` shows no JSON parse errors).
- **Verify:** manual (above) + `cd mcp && npm test`

### 12. Package docs
- **Files:** `mcp/AGENTS.md` · `mcp/CLAUDE.md` · `mcp/README.md` · `mcp/INSIGHTS.md` (new)
- **Skills:** `engineering-insights` (for INSIGHTS.md format)
- **Do:**
  - **`AGENTS.md`** follows the `e2e/AGENTS.md` structure:
    - Commands: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run inspect`. Uses **npm**.
    - Layout.
    - Conventions: stdout = protocol; no server imports; contracts via `@devdigest/shared`; flat primitive tool args; descriptions are product and budget-tested.
    - Do not touch: `package-lock.json` by hand.
    - Gotchas: the API must be running; `npm ci` is needed or `/mcp` shows failed; `127.0.0.1` on Windows.
    - Read when.
  - **`CLAUDE.md`**: the same two lines as `e2e/CLAUDE.md` (HTML comment plus `@AGENTS.md`).
  - **`README.md`**:
    - Purpose and a sequence diagram (Claude Code → stdio → MCP → HTTP → API).
    - Tool table: args, returns, annotations.
    - Env table: `DEVDIGEST_API_URL`, `DEVDIGEST_MCP_WAIT_MS`, `DEVDIGEST_MCP_POLL_MS`.
    - `.mcp.json`, the inspector, and Claude Code usage (`/mcp`, `/context`, `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`).
    - Design decisions: result-not-operation, attach-to-in-flight, truncation caps, no outputSchema, tsx at runtime.
    - The blast-radius homework seam, copied from step 6.
    - SSE as a later upgrade to polling.
    - Troubleshooting.
  - **`INSIGHTS.md`**: the header and sections of `reviewer-core/INSIGHTS.md` (empty).
- **Done when:** `mcp/CLAUDE.md` is exactly the stub, and README covers every env var and tool.
- **Verify:** `cd mcp && npm run lint` (sanity); visual review

### 13. Root docs + CI
- **Files:** [`AGENTS.md`](AGENTS.md) · [`README.md`](README.md) · [`TESTING.md`](TESTING.md) (edit) · `.github/workflows/mcp.yml` (new)
- **Do:**
  - **`AGENTS.md`**:
    - Commands block (`:17-23`): add `cd mcp && npm test          # npm, not pnpm`.
    - `:35` and `:63`: npm for `reviewer-core`/`e2e`/`mcp`.
    - Layout (`:47`): add row `` `mcp/` | `@devdigest/mcp` | stdio MCP server — five tools over the local API ``.
    - `:50`: "Five standalone packages".
    - Lock-files (`:102-103`): add `mcp/package-lock.json`.
    - Read when: add `mcp/README.md`, **read before adding or changing an MCP tool**.
  - **`README.md`**:
    - Package table (`:12-18`): add a `mcp/` row.
    - README links (`:61-65`): add `mcp`.
    - L04 row (`:87`): strike through the delivered part, following the L02 pattern: `` ~~`devdigest-mcp` server~~ · Blast Radius (reads `repo-intel`) — MCP stub `get_blast_radius` awaits it ``.
    - Testing table (`:142-148`): add `| mcp (vitest, stdio + in-memory) | mcp.yml | no |`.
  - **`TESTING.md`**: suite map (`:27-33`): add `| mcp | mcp/ | unit (hermetic, fake API) | vitest | mcp.yml | no |`.
  - **`mcp.yml`**: copy `.github/workflows/reviewer-core.yml` with:
    - name `mcp`
    - `paths: ['mcp/**', 'server/src/vendor/shared/**', '.github/workflows/mcp.yml']`
    - `working-directory: mcp`
    - `cache-dependency-path: mcp/package-lock.json`
    - steps `npm ci` · `npm run lint` · `npm run typecheck` · `npm test`
    - Header comment: why the shared path is filtered in; the zod alias means no server install is needed.
- **Done when:** the doc rows exist and the workflow YAML is valid.
- **Verify:** `node -e "require('fs').readFileSync('.github/workflows/mcp.yml','utf8')"`, plus `git diff --stat` shows only the intended files

### 14. Teach the pre-PR gate about `mcp/` (recommended; see Open questions)
- **Files:** [`.claude/hooks/pr-self-review-gate.mjs`](.claude/hooks/pr-self-review-gate.mjs) · [`.claude/skills/pr-self-review/routing.md`](.claude/skills/pr-self-review/routing.md) (edit)
- **Do:**
  - `PACKAGES` (`:65`) add `'mcp'`. `PM` add `mcp:'npm'`. `LOCKFILES` add `mcp:'mcp/package-lock.json'`.
  - `CHECKS` add `mcp: [['npm',['run','lint']],['npm',['run','typecheck']]]`.
  - New `ROUTES` entry **before** `convention-only`:
    ```js
    { group: 'mcp', test: p => p.startsWith('mcp/src/') && /\.ts$/.test(p) && !/\.test\.ts$/.test(p), skills: ['typescript-expert','security'], extra: p => /\/(tools\/|api-client|resolve|config)/.test(p) ? ['zod'] : [] }
    ```
  - Beside the existing shared-contract rule (`:439-442`): if `server/src/vendor/shared/` changed and `!pkgs.has('mcp')`, add `mcp → npm run typecheck`.
  - Add a matching `mcp` row to the routing.md Groups table.
  - Per [INSIGHTS.md:87](INSIGHTS.md:87): test the hook with payloads built by concatenation, never by typing the guarded command text into a Bash call.
- **Done when:** a `scope` run over this branch lists `mcp` with its checks and reports no `unrouted-file` for `mcp/src/**`.
- **Verify:** `node .claude/hooks/pr-self-review-gate.mjs scope`. Confirm the subcommand name in `.claude/skills/pr-self-review/SKILL.md` first.

### 15. Insights + pre-PR gate
- **Do:**
  - Run `/engineering-insights` and append to `mcp/INSIGHTS.md`:
    - measured tools/list size and `/context` cost
    - `${CLAUDE_PROJECT_DIR}` expansion result
    - zod v3 vs `zod/v4` outcome with the SDK
    - Claude Code progress/timeout behaviour
  - Append cross-package facts to the root `INSIGHTS.md`, e.g. "npm run prints its banner to stdout — never launch a stdio server through npm".
  - Then run `/pr-self-review` and fix or waive until `PASS`.
- **Done when:** the gate reports PASS for the exact tree.
- **Verify:** `/pr-self-review`

## Test matrix
| Test file | Covers |
|---|---|
| `config.test.ts` | defaults, env overrides, invalid values, no secret or value leakage in errors |
| `api-client.test.ts` | shared-schema parsing, JSON POST body, error kinds (unreachable/404/422/429/5xx/contract), origin without credentials, no body leak |
| `resolve.test.ts` | repo `owner/name`/uuid/bare name/ambiguous/not-found list; PR number/`"#482"`/uuid/not-found/null id; agent exact/substring/ambiguous/`all`/disabled; memo |
| `format.test.ts` | severity sort, global cap plus truncation block, clipping, detailed fields, 40k-char guard, null cost preserved |
| `wait.test.ts` | backoff sequence, terminal detection, `missing` after 3 polls, timeout, abort |
| `list-agents.test.ts` | enabled-only, field whitelist, empty hint |
| `run-agent-on-pr.test.ts` | one agent / all, progress with and without token, wait limit, partial, all-failed isError, attach-to-in-flight, zero runs, 429 |
| `get-findings.test.ts` | latest per agent, agent and run_id filters, running/failed run_id, no-review hint, detailed, truncation |
| `get-conventions.test.ts` | default/filter, no scan, running/failed scan, `path:line`, sort/cap, GET-only |
| `get-blast-radius.test.ts` | `not_implemented`, not isError, zero API calls |
| `tools-list-budget.test.ts` | exact names, annotations, no outputSchema, instructions ≤200, descriptions ≤1,400, tools/list ≤4,000 chars |
| `stdout.test.ts` | zero `process.stdout.write` across every tool and error path |
| `stdio.test.ts` | real spawn via node+tsx: initialize, 5 tools, `list_agents` ok, unreachable API gives isError |

| Package | Command | Covers |
|---|---|---|
| mcp | `cd mcp && npm test` | everything above (hermetic, no Docker) |
| mcp | `cd mcp && npm run lint && npm run typecheck` | style, import bans, types incl. shared contracts |
| server | `cd server && pnpm typecheck` | untouched; run only if step 14 or a shared file changes |
| manual | `cd mcp && npm run inspect` · Claude Code `/mcp`, `/context` | real API end to end |

## Risks & rollback
- **`PrMeta.id` is nullish** (`platform.ts:161`), although the list route always sets it (`pulls/routes.ts:192`). Handled by an explicit ToolError. · rollback: n/a.
- **Rate limits:**
  - `POST /pulls/:id/review` is 10/min (`reviews/routes.ts:29`), and the global limit is 120/min by IP, shared with the studio (`app.ts:96`).
  - Mitigated by attach-to-in-flight, backoff to 5 s, and a clear 429 message.
  - If still hit, raise `DEVDIGEST_MCP_POLL_MS`.
- **PR resolution latency and side effects.** `GET /repos/:id/pulls` syncs from GitHub and backfills up to 10 PR details when a token is set (`pulls/routes.ts:41-112`). Every PR resolution can take seconds and upserts PR rows, which is a cache refresh, not a user-visible write. Accepted; the optional server route is listed in Non-goals. · rollback: none needed.
- **tsx at runtime.** It adds ~0.5 s start-up and depends on tsx honouring `paths` for the `zod` pin when `server/node_modules` is absent.
  - `stdio.test.ts` in CI proves it.
  - If it fails, the fallback is a bundled `dist/` (esbuild), which is a new dependency. That needs approval.
- **zod v3 vs v4 with SDK 1.30.x:** see the step-6 fallback (`zod/v4` for tool schemas only).
- **`${CLAUDE_PROJECT_DIR}` in `.mcp.json`** is unverified for project MCP config. Fallback: relative paths (step 11).
- **Claude Code timeouts and progress support** are unverified. If the client ignores progress and times out early, lower `DEVDIGEST_MCP_WAIT_MS` or document `MCP_TOOL_TIMEOUT`. The tool always returns `running` before its own limit.
- **Windows `localhost` → `::1`** (INSIGHTS.md:253) while the API binds IPv4 `0.0.0.0` (`server.ts:29`). Node 22 fetch normally falls back. Troubleshooting: `DEVDIGEST_API_URL=http://127.0.0.1:3001`.
- **`run.error` passthrough.** Server-persisted error text is shown clipped to 300 chars. It is low risk, since it is our own server's text, but it is untrusted-adjacent: data field only.
- **Stale comment** "(synchronous)" at `review-api.ts:41-44`. Harmless; left untouched (Non-goals).
- **Rollback of the whole change:** additive only. Delete `mcp/`, `.mcp.json`, `.github/workflows/mcp.yml`, and revert the doc rows and step-14 gate edits. No DB, server, or client code changes.

## Out of scope
- Blast-radius logic and its server route (course homework). SSE streaming. HTTP transport. Auth. Any server, client, or reviewer-core edit. Adding `npm ci` for `mcp/` to `scripts/dev.sh`. A `specs/06-*.md` spec file.
- Architectural review and security review. Separate agents own those.
- Opening or pushing a PR. `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking:** attach-to-in-flight in `run_agent_on_pr` goes beyond the decided scope (it prevents double spend on retries). **Default: implement it**; the user can veto.
- **Non-blocking:** step 14 (gate knows `mcp/`) is outside the requested file list but needed so `/pr-self-review` lints and typechecks the new package. **Default: include it.**
- **Non-blocking:** should `scripts/dev.sh` also `npm ci` in `mcp/`? **Default: no**; documented in `mcp/README.md` and `AGENTS.md`.
- **Non-blocking:** a one-sentence `instructions` string is set (step 6). **Default: keep it.** Drop it if `/context` shows it is not worth the cost.
- **Non-blocking:** `list_agents` returns `enabled` even though it is always `true` after filtering (kept per the decided shape). **Default: keep it.**
- **Blocking:** none outstanding for the stated scope.
