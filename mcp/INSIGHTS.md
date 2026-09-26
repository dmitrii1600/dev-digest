# Insights — @devdigest/mcp

Module-local facts that are not visible from the code: SDK/runtime quirks,
Claude Code client behaviour observed against this server, gating decisions
and why they hold. Cross-package findings go in `../INSIGHTS.md`.

Not architecture (that is `README.md`), not rules (that is `AGENTS.md`).

How to read and append: `/engineering-insights`
(`../.claude/skills/engineering-insights/SKILL.md`). Sections are fixed and
append-only. Empty sections are expected — append under the one that fits.

---

## What Works

- 2026-09-26 — Hermetic tests for a stdio MCP server need no Docker and no
  real API: `InMemoryTransport.createLinkedPair()` + a fake DevDigest API that
  is just an injected `fetchImpl` (`test/helpers/fake-api.ts`) covers every
  tool; one real `node` + `tsx/dist/cli.mjs` spawn (`test/stdio.test.ts`)
  proves the `.mcp.json` launch shape and the `@devdigest/shared`/`zod` path
  aliases resolve with `server/node_modules` absent. Whole suite: 95 tests,
  ~1.8 s.

## What Doesn't Work

- 2026-09-26 — Passing a **generic** wrapper as `registerTool`'s third
  argument (`safe<Args, R>(handler)` returning a function) hits TS2589
  ("type instantiation is excessively deep") against the SDK's
  `ToolCallback<InputArgs>` conditional type — even for tools whose schemas
  were otherwise fine. Keep the callback a plain, contextually-typed arrow and
  call the shared logic from inside it: `(args, extra) => safe(async () => …)`
  (`src/errors.ts:145`).
- 2026-09-26 — Plain zod **v3** shapes (`z.string()`, `z.union`,
  `z.enum().default()`) passed to `McpServer.registerTool` under
  `@modelcontextprotocol/sdk@1.30.1` hit the same TS2589 in 3 of 5 tools
  (`get_blast_radius`, `get_conventions`, `get_findings`) and not the other
  two, with no clean rule by key count or shape. Do not spend time finding
  one — switch the tool-input files to `zod/v4` (next section).

## Codebase Patterns

- 2026-09-26 — Tool **input** schemas import `zod/v4`; everything that parses
  API responses stays on plain `zod` (v3) because `@devdigest/shared` is
  authored against the v3 API (two-arg `z.record` at
  `server/src/vendor/shared/contracts/platform.ts:97`). Both live in the one
  pinned `zod@3.25.76`, which ships the v4 API under the `zod/v4` subpath, so
  this costs no extra dependency (`src/tools/params.ts:8`).
- 2026-09-26 — Tool descriptions are copied verbatim from
  `specs/06-mcp-server.md` → *Final tool descriptions* and budget-tested; the
  budgets are **measured × 1.15**, not round numbers
  (`test/tools-list-budget.test.ts:26-27`). A red budget test means trim the
  text; raise the constant only with a written reason.

## Tool & Library Notes

- 2026-09-26 — SDK 1.30.1's `CallToolResult` is an indexed type
  (`{ [x: string]: unknown; content: … }`), so a **named** interface returned
  from a tool handler needs an explicit `[key: string]: unknown` or `tsc`
  reports "Index signature … is missing" — an inline object literal in the
  same position is accepted (`src/errors.ts:77`, `src/format.ts:230`).
- 2026-09-26 — Measured `tools/list` cost for the five tools: server
  `instructions` 156 chars, descriptions total 1,058 chars, whole
  `tools/list` JSON **4,236 chars** (≈1.1k tokens for the entire server). The
  plan's pre-measurement guess was ~3.3k / budget 4,000; the extra ~6 % is the
  zod → JSON-Schema per-field boilerplate (`type`, `additionalProperties`)
  that a character count of the description strings does not include.
- 2026-09-26 — `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json
  src/index.ts` starts and answers `initialize` + `tools/list` in
  ~650–750 ms on Windows (`test/stdio.test.ts`). `--tsconfig` is required
  because Claude Code's working directory is the repo root, not `mcp/`, and
  tsx must see `paths`.

## Recurring Errors & Fixes

## Session Notes

### 2026-09-26 — @devdigest/mcp built from specs/06-mcp-server.md
Five tools (`list_agents`, `run_agent_on_pr`, `get_findings`,
`get_conventions`, `get_blast_radius` stub) as a stdio adapter over the API.
Two implementers ran in parallel (code vs docs/CI/gate) with no file overlap.
Two TS2589 sources surfaced and were split apart (generic wrapper vs zod v3
shapes); both fixes are above. The API and Docker were down in this session, so
step 11's live checks (`/mcp`, `/context`, inspector against seeded data) are
still open — see Open Questions.

## Open Questions

- 2026-09-26 — Does the installed Claude Code expand `${CLAUDE_PROJECT_DIR}`
  inside project-scope `.mcp.json` `args` (`.mcp.json:7-9`)? Unverified: no
  live `/mcp` in this session. If `/mcp` shows `devdigest` failed, switch the
  three paths to repo-relative `mcp/...` and record which shape worked here.
- 2026-09-26 — Real `/context` cost of this server in Claude Code is
  unmeasured (the 4,236-char `tools/list` figure is the server-side payload,
  not what the client puts in the prompt under deferred tool loading).
- 2026-09-26 — Claude Code's behaviour against `run_agent_on_pr`'s wait loop
  is unverified: whether it surfaces `notifications/progress`, and whether it
  aborts before `DEVDIGEST_MCP_WAIT_MS` (default 600 s). If it aborts early,
  document `MCP_TOOL_TIMEOUT` in `README.md` or lower the default.
- 2026-09-26 — **Resolved the same day.** A real `StdioClientTransport`
  client spawned the server in the `.mcp.json` shape against the live API:
  `tools/list` = 5 tools / 4,236 chars; `list_agents` 76 ms; `get_findings`
  on `acme/payments-api#482` 845 ms (the PR lookup goes through
  `GET /repos/:id/pulls`, which syncs from GitHub when a token is set);
  `get_conventions` 42 ms; the stub 1 ms with `isError` absent; both
  not-found paths returned the actionable `isError` text. Only
  `run_agent_on_pr` (spends LLM tokens) and the in-Claude-Code checks
  (`/mcp`, `/context`, `${CLAUDE_PROJECT_DIR}`) remain unexercised.
- 2026-09-26 — Seed data has a review on PR 482 with no agent and no run
  (`server/src/db/seed.ts`), so concise `get_findings` — which omits null
  keys — prints that entry with no `agent_name`/`run_id`/`run_status` at all.
  Real runs always carry both. Decide whether concise mode should keep
  `agent_name: null` explicitly so an entry is never anonymous.
