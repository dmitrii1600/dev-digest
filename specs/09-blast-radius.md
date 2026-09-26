# Development Plan: Blast Radius (L04 HW part 2): Overview-tab block and a working `get_blast_radius` MCP tool

**Plan ID:** 09-blast-radius  ·  **Packages:** `server/`, `client/`, `mcp/` (+ root docs)  ·  **Assumptions:** (a) repo-intel is starter infrastructure. `server/src/modules/repo-intel/**` code is **not** edited; its README gets one line. (b) Route path is `GET /pulls/:id/blast-radius` (reasons in *Contract*). (c) Caller links point at the PR head sha, as the assignment says (see Open questions).

## Problem
A reviewer sees the diff but not what else in the repo it can break. `repo-intel` already computes this at clone/index time: symbols, resolved references, file rank, and per-file endpoint/cron facts. The facade `getBlastRadius` exists (`server/src/modules/repo-intel/service.ts:220`) but nothing consumes it:
- no route,
- no UI (`OverviewTab.tsx:11-21` renders only the PR description),
- the MCP tool is a stub (`mcp/src/tools/get-blast-radius.ts:25-45`).

Blast Radius reads the index and shows, per PR:
1. the symbols declared in the changed files,
2. who calls them (`file:line`),
3. the HTTP endpoints and crons that live in those callers' files.

No LLM, no re-indexing.

## Summary
A new server module `modules/blast/` with one route, `GET /pulls/:id/blast-radius`:
- It loads the PR's persisted changed-file paths and `repoId`.
- It calls `repoIntel.getBlastRadius` once and `repoIntel.getIndexState` once.
- A pure mapper in `helpers.ts` turns the flat `BlastResult` into the existing `BlastRadius` contract, extended with optional `degraded` / `reason`.
- The route declares `response: { 200: BlastRadius }`, so the contract validates the output.

Consumers:
- **Client:** the Overview tab renders a `BlastRadiusPanel` through a new `usePrBlastRadius` hook. It shows a stats row, then per symbol its callers as GitHub links, endpoint chips and cron chips, plus an empty state and a degraded badge.
- **MCP:** `get_blast_radius` resolves repo and PR, calls `GET /pulls/:id` (refreshes the file list, like the studio does), then the new route. It returns a capped, concise map.

The contract is fixed first (step 0). After that, three tracks run in parallel on disjoint files: server, client, mcp.

## Context read
| File | What it settled |
|---|---|
| [AGENTS.md](AGENTS.md) | pnpm (`server`, `client`) vs npm (`mcp`); `.js` imports; `*.it.test.ts`; contract-once plus mirror; `modules/<name>/routes.ts` plus one entry in `modules/index.ts` |
| [server/AGENTS.md](server/AGENTS.md), [server/README.md](server/README.md) | onion is enforced by `pnpm lint` and `pnpm arch`; declarative validation; API map mermaid (`README.md:64-89`) to extend |
| `.claude/skills/onion-architecture/{rules,layers}.md` | rule 9: a new service takes ports, not `Container`. Rule 11: `routes.ts` + `service.ts` + `repository.ts`. `repo-intel/types.ts` is ring 1 (a port). Ring 2 may not import runtime `zod` |
| `server/eslint.config.mjs:114-128,179-181,187-190` | `RING_2` globs are per filename (`modules/*/service.ts`, `helpers.ts`, `constants.ts`), with zones query/rowTypes/fastify/sdk/nodeIo/adapters/zodRuntime. `routes.ts` zone forbids query/rowTypes/sdk/nodeIo |
| `server/.dependency-cruiser.cjs` `no-cross-module-reach-in` | a module may import only its own folder, `_shared`, and (grandfathered regex) `repo-intel/constants.ts`. Type-only edges are invisible to depcruise (`server/INSIGHTS.md:204`) |
| `server/src/modules/repo-intel/service.ts:220-304` | fallback path: ripgrep over the clone at request time. Always `degraded:true, reason:'no_data'`. Skips the declaring file (`:273`). **No caller cap** |
| `server/src/modules/repo-intel/service.ts:315-391` | persistent path: Postgres only. Runs when flag is on **and** `repo_index_state.status ∈ {full, partial}` (`:320`). Returns `degraded:false` even for `partial`. **`callers.slice(0, MAX_CALLERS_PER_SYMBOL)` is a global cap across all symbols, not per symbol** (`:372,386`). `factsByFile` only here (`:376-382`) |
| `server/src/modules/repo-intel/repository.ts:205-239,400-425,503-549` | `tryGetIndexState`: `degraded` only for status `degraded`/`failed`, reason from stats or `index_failed`; `partial` is not degraded (`:215-218`). `decl_file` is resolved via import edges (`:406-424`), so a same-file reference never resolves to its own file. `getFileFacts` returns endpoints/crons |
| `server/src/modules/repo-intel/types.ts:27-32,57-87,137-148` | `DegradedReason`, `BlastResult`, the `RepoIntel` port |
| `server/src/modules/repo-intel/constants.ts:30,49` | `MAX_CALLERS_PER_SYMBOL = 20`. `BFS_DEPTH = 2` is used **only** by `getCriticalPaths` (`service.ts:686`). Blast is 1-hop, so it has no depth to expose |
| `server/src/modules/repo-intel/routes.ts:44-77`, [repo-intel README](server/src/modules/repo-intel/README.md) | `GET /repos/:id/index-state`, `POST /repos/:id/resync` (202). README `:45-47` says only three facade methods are wired |
| `server/src/vendor/shared/contracts/brief.ts:17-44,116-122` | `BlastRadius` has **no** `degraded`/`reason`. `PrBrief.blast` composes it. Client copy is byte-identical (`diff` clean) |
| `server/src/db/schema/reviews.ts:84-89` | `pr_brief.json` is where a future `PrBrief` (incl. `BlastRadius`) is persisted, so new fields must be optional |
| `server/src/modules/pulls/routes.ts:219-311` | `GET /pulls/:id` is the **only** writer of `pr_files` (`:241-252`); the list sync (`:33-86`) never writes them. Workspace-scoped PR lookup pattern (`:221-227`) |
| `server/src/modules/reviews/repository/pull.repo.ts:9-34` | existing PR/file queries (row-typed; not reused, see step S1) |
| `server/src/modules/reviews/run-executor.ts:37-43` | the structural `Logger` type pattern (onion rule 1) |
| `server/src/app.ts:62-65,116-135` | zod serializer compiler is installed. `isResponseSerializationError` → generic 500. **No route declares `response:` today**; blast is the first |
| `server/src/platform/container.ts:40-54,125-129` | `ContainerOverrides.repoIntel`; lazy `repoIntel` getter |
| `server/src/modules/conventions/{routes,service}.ts` | nearest well-layered module (service built in the plugin, `getContext`, `NotFoundError`) |
| `server/test/routes-smoke.test.ts`, `repo-intel-facade-degraded.test.ts`, `pulls-comments.it.test.ts`, `conventions.it.test.ts:139-141`, `test/helpers/pg.ts` | hermetic app-inject pattern; patch-a-fake pattern; DB-backed route pattern (`startPg`, `seed`, `buildApp({config, db, overrides})`) |
| `server/src/db/seed.ts:92-133` | seeded `acme/payments-api` has `clonePath: null` and 4 `pr_files` on PR 482. Seeded data therefore always yields the degraded/`no_data` path |
| `server/src/adapters/codeindex/extract.ts:182-214` | endpoint strings look like `"POST /payments"`; cron strings are a cron expression or `"job:<kind>"` |
| [client/AGENTS.md](client/AGENTS.md), `client/docs/data-flow.md` | hook → `lib/api.ts`; `useTranslations`; styles in co-located `styles.ts` with CSS tokens; tests pass real `messages/en/*.json` and `vi.mock` hooks |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:35-37,82,137,149` | `prId` resolved from the pulls list; `repoFullName` from `activeRepo`; `pr.head_sha`; `<OverviewTab prBody={pr.body} />` |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/{OverviewTab.tsx,index.ts,styles.ts}` | current Overview; no test file exists |
| `client/src/app/repos/[repoId]/pulls/[number]/github-urls.ts:24-37` | **`githubBlobUrl` lives here, not in `client/src/lib/github-urls.ts`** (that path does not exist) |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/{FindingCard.tsx:46-49,70-72,FindingCard.test.tsx}` | `MonoLink href={githubBlobUrl(...)}` pattern; intl test wrapper; relative `messages` import depth |
| `client/src/lib/hooks/{index.ts,core.ts:114-120,repo-intel.ts:31-49}`, `client/src/lib/api.ts:63-73` | hook shape; `useResyncRepoIntel` already exists (for P3) |
| `client/src/i18n/request.ts:16-25`, `client/messages/en/blast.json` | every `messages/en/*.json` auto-loads as a namespace. `blast.json` has `stat.*`, `view.*`, `callerCount` (**not** an ICU plural), `noDownstream`, `graph.*`. None are used yet |
| `client/src/vendor/ui/primitives/{Badge,MonoLink,EmptyState,ErrorState,SectionLabel,Skeleton}.tsx`, `icons.tsx` | primitives to use; icons `Target`, `AlertTriangle`, `Globe`, `Clock`, `CornerDownRight`, `RefreshCw` exist |
| `client/src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.test.tsx:27` | `vi.mock("@/lib/hooks/<domain>", …)` precedent |
| [mcp/README.md](mcp/README.md) `:5-8,55,160-164,175-194`, [mcp/AGENTS.md](mcp/AGENTS.md) | tool table row; the "homework seam" section to remove |
| `mcp/src/{api-client.ts,resolve.ts:39,51,105-131,format.ts:6-15,230-260,errors.ts:114-115,server.ts:37-38,81-85}`, `mcp/src/tools/{params.ts,get-conventions.ts}` | client/method pattern; `resolvePr` → `{id, number, label}`; caps; `toTextResult` char guard is reviews-only; the not-found text; `SERVER_INSTRUCTIONS` |
| `mcp/test/{get-blast-radius.test.ts,tools-list-budget.test.ts:62-64,helpers/fake-api.ts,helpers/fixtures.ts:396-427}` | budgets: descriptions ≤ **1,217**, `tools/list` JSON ≤ **4,872**, instructions ≤ 200. Fake API has no `GET /pulls/:id` route yet |
| [specs/08-mcp-server.md](specs/08-mcp-server.md) `:145-209` | description rules and format; the canonical-strings section to point here |
| [TESTING.md](TESTING.md), `.claude/skills/pr-self-review/routing.md` | suite map; file-group → skill routing (below) |
| [INSIGHTS.md](INSIGHTS.md), [server/INSIGHTS.md](server/INSIGHTS.md), [client/INSIGHTS.md](client/INSIGHTS.md), [mcp/INSIGHTS.md](mcp/INSIGHTS.md) | see next section. `server/src/modules/repo-intel/INSIGHTS.md` does **not** exist |

## Insights that bind this work
1. **A service gets its collaborators injected, never builds them from `Container`.** Sources: [server/INSIGHTS.md:166](server/INSIGHTS.md:166), plus onion rule 9.
   - `BlastService` takes `{ prs, index, log, repoIntelEnabled, maxCallersPerSymbol }` in its constructor. `routes.ts` wires them.
   - The service is therefore unit-tested hermetically with plain fakes (`test/blast-service.test.ts`), with no Postgres.
2. **To stub one `RepoIntel` method in an integration test, patch the real facade after `buildApp`.** Source: [server/INSIGHTS.md:17](server/INSIGHTS.md:17).
   - `routes.ts` must therefore **not** capture `container.repoIntel` at plugin registration. It passes a lazy port, e.g. `getBlastRadius: (r, f) => container.repoIntel.getBlastRadius(r, f)`, so a test that assigns `app.container['overrides'].repoIntel` after boot is honoured.
   - `blast.it.test.ts` uses exactly the `Object.assign(Object.create(app.container.repoIntel), {...})` pattern.
3. **`@devdigest/shared` is two copies; the server one is canonical.** Source: [INSIGHTS.md:151](INSIGHTS.md:151).
   - Step 0 edits `server/src/vendor/shared/contracts/brief.ts` and mirrors the identical diff into `client/src/vendor/shared/contracts/brief.ts` in the same commit.
   - `mcp/` reads the server copy through its alias, so it needs no mirror.

Also applied:
- [server/INSIGHTS.md:29](server/INSIGHTS.md:29) (*What Doesn't Work*: a required field on a persisted-doc contract): `pr_brief.json` will persist `PrBrief ⊃ BlastRadius`. Hence `degraded` is `.optional()` and `reason` is `.nullish()`.
- [server/INSIGHTS.md:222](server/INSIGHTS.md:222): ring zones match on filename. The mapper **must** be named `helpers.ts` (not `mapper.ts`), or it silently leaves the ring-2 zone.
- [server/INSIGHTS.md:138](server/INSIGHTS.md:138): no cross-module value imports. Only `import type` from `../repo-intel/types.js` (a ring-1 port). The one value import (`MAX_CALLERS_PER_SYMBOL`) goes in `routes.ts` through the already-allowed `repo-intel/constants.ts` edge (see Open questions).
- [server/INSIGHTS.md:66](server/INSIGHTS.md:66) (*What Doesn't Work*: building from starter leftovers): comments mention a `blast/service.ts` with `persistSymbols`/`persistReferences` (`repo-intel/types.ts:53`, `service.ts:6`, `db/schema/context.ts:54,95`). No such module exists. Do not recreate it and do not write symbols/references. Blast only reads.
- [client/INSIGHTS.md:97](client/INSIGHTS.md:97): counts and the lists they describe come from the **same** arrays. The UI stats row is computed from `changed_symbols`/`downstream`, never from `summary`.
- [client/INSIGHTS.md:130](client/INSIGHTS.md:130): import the hook from `@/lib/hooks/blast`, not the barrel.
- [client/INSIGHTS.md:184](client/INSIGHTS.md:184): use `fireEvent`; `user-event` is not installed.
- [mcp/INSIGHTS.md:27,34,43](mcp/INSIGHTS.md:27) (*What Doesn't Work*: TS2589): keep the handler as a plain arrow `(args) => safe(async () => …)`. Reuse the existing `zod/v4` params `repo`, `pr`; add no new input fields.
- [mcp/INSIGHTS.md:49](mcp/INSIGHTS.md:49): descriptions are canonical text and budget-tested. The new strings are in *Contract → MCP*, measured below the budgets.
- [INSIGHTS.md:126](INSIGHTS.md:126): the gate's `test-naming` rule emits a known false-positive WARNING for `*.it.test.ts` files that use `startPg`. Expect it on `blast.it.test.ts`; it is not a naming bug.

**"What Doesn't Work" check:** no step repeats a recorded dead end (the four entries above are honoured explicitly).

## Constraints
- **Onion (server).**
  - `modules/blast/routes.ts`: ring 4. Fastify, `getContext`, response schema. No Drizzle.
  - `service.ts` and `helpers.ts`: ring 2. No `drizzle-orm`, `db/**`, `fastify`, `node:fs`, `adapters/**`, or runtime `zod`. `import type` from `@devdigest/shared` and `../repo-intel/types.js` only.
  - `repository.ts`: ring 3. The only Drizzle. Returns plain shapes, never `$inferSelect` (rule 5).
  - Registration: one import plus one entry in `server/src/modules/index.ts:1-115`.
- **Contract-once plus mirror.** Edit `server/src/vendor/shared/contracts/brief.ts`, then copy the identical change into `client/src/vendor/shared/contracts/brief.ts`. No local re-declaration of the payload type in client or mcp.
- **Declarative validation.** Route schema is `{ params: IdParams, response: { 200: BlastRadius } }`. No `.parse()` in the handler or service.
- **`.js` on relative imports** in `server/` and `mcp/`.
- **Tests.** DB-backed means `server/test/blast.it.test.ts`. Mapper and service tests are hermetic `*.test.ts`. Client `_components/BlastRadiusPanel/BlastRadiusPanel.test.tsx`. MCP tests are `*.test.ts`.
- **Client.**
  - No `fetch` in a component: hook in `src/lib/hooks/blast.ts` over `src/lib/api.ts`.
  - Every user-facing string comes from `messages/en/blast.json`.
  - `_components/<Name>/<Name>.tsx` + `<Name>.test.tsx` + `index.ts` + `styles.ts`.
  - Cross-folder imports use `@/`.
  - Colours come from CSS tokens (`var(--warn)` etc.), never literals.
  - The component never hardcodes `20` or `2`.
- **MCP.**
  - stdout stays the protocol channel.
  - Responses are parsed with shared schemas (`PrDetail`, `BlastRadius`).
  - MCP-authored strings interpolate only identifiers or enum values. Repo-derived strings (symbol names, paths, endpoints) appear only as JSON data fields.
  - No `outputSchema`, no `title`.
- **Package managers.** `pnpm` in `server/`/`client/`; `npm` in `mcp/`. No dependency changes are planned, so **no lock-file changes**.
- **No LLM, no indexing.** The blast module's deps contain no `LLMProvider`. It never calls `indexRepo`/`refreshIndex`/`resyncRepo` and never enqueues jobs.
- **Do not touch (nearby):**
  - `server/src/modules/repo-intel/{service,repository,types,constants}.ts` and `pipeline/**`: read-only for this task (see Open questions on the global cap).
  - `server/src/db/migrations/**`: no schema change needed.
  - The five lock-files.
  - `client/src/vendor/ui/**`: use primitives, do not edit.
  - `reviewer-core/src/grounding.ts` / `INJECTION_GUARD`: irrelevant; do not open.

## Contract

### Route
`GET /pulls/:id/blast-radius`, where `:id` is the PR uuid (`IdParams`, `server/src/modules/_shared/schemas.ts:11`).
- Responses: `200 BlastRadius` · `404 {error:{code:"not_found"}}` when the PR is not in the workspace · `422 validation_error` on a non-uuid.
- **Why `/blast-radius`, not `/blast`:**
  - It names the resource after its contract (`BlastRadius`).
  - It follows the kebab-case sub-resource style of `/repos/:id/index-state`.
  - It is the path already cited by the stub and the MCP README (`mcp/src/tools/get-blast-radius.ts:17`, `mcp/README.md:187`).
  - Existing `/pulls/:id/*` sub-resources are nouns (`comments`, `runs`, `reviews`).
- It lives in `modules/blast/`, not `modules/pulls/`: the pulls routes file is grandfathered as a non-template (onion rule 2 ❌).

### Zod (server canonical; mirror verbatim to client)
In `server/src/vendor/shared/contracts/brief.ts`, directly above `BlastRadius`:

```ts
export const BlastDegradedReason = z.enum(['flag_off','index_failed','index_partial','repo_too_large','no_data']);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().optional(),          // route always sets it; optional for persisted PrBrief docs
  reason: BlastDegradedReason.nullish(),     // null when not degraded
});
```

`ChangedSymbol`, `BlastCaller` and `DownstreamImpact` are unchanged (`brief.ts:17-37`). The literal union must equal `DegradedReason` (`repo-intel/types.ts:27-32`). The mapper assigns one to the other, so drift fails `tsc`. The contract itself may not import the server type (`contract-stays-pure`).

**Decision: no `limits` / `max_callers_per_symbol` in the response.** The UI does not display a cap. The facade already caps globally (`service.ts:386`), so a displayed "max 20 per symbol" would be misleading. `BFS_DEPTH` is not used by blast at all. P2 is satisfied by the server importing the constant, while the component contains no limit literals.

### Example response (one symbol with callers)
```json
{
  "changed_symbols": [
    { "name": "applyRateLimit", "file": "src/middleware/ratelimit.ts", "kind": "function" },
    { "name": "RateLimitConfig", "file": "src/middleware/ratelimit.ts", "kind": "interface" }
  ],
  "downstream": [
    {
      "symbol": "applyRateLimit",
      "callers": [
        { "name": "registerPublicRoutes", "file": "src/api/public/webhooks.ts", "line": 42 },
        { "name": "createUser", "file": "src/api/users.ts", "line": 118 }
      ],
      "endpoints_affected": ["GET /users/:id", "POST /webhooks/stripe"],
      "crons_affected": ["job:digest"]
    }
  ],
  "summary": "2 changed symbols; 2 callers in 2 files; 2 endpoints; 1 cron.",
  "degraded": false,
  "reason": null
}
```

### Mapping rules (`modules/blast/helpers.ts`, pure)
1. **Group.** `downstream` holds one entry per `viaSymbol` that has ≥1 caller after rule 2. Symbols with no callers appear only in `changed_symbols`. Callers map as `{ name: c.symbol, file: c.file, line: c.line }`.
2. **Declaring-file guard.** Drop a caller whose `file` declares a changed symbol of the same name (the set of `changedSymbols.filter(s => s.name === via).map(s => s.file)`).
   - Both facade paths already guarantee this by different mechanisms (`service.ts:273`; import-edge resolution at `repository.ts:406-424`).
   - The guard is cheap belt-and-braces **plus** a test, so a facade regression cannot leak the declaring file.
3. **Per-symbol cap.** Keep at most `maxCallersPerSymbol` callers per group (injected; `MAX_CALLERS_PER_SYMBOL`). Needed because the fallback path is uncapped.
4. **Order.**
   - Callers within a group: `rank` desc, then `file` asc, then `line` asc.
   - Groups: max caller `rank` desc, then caller count desc, then `symbol` asc.
   - `changed_symbols`: symbols that have downstream first, in downstream order, then the rest by `file`, `name`.
   - Rank is used only for ordering and is not emitted (the contract has no rank field).
5. **Endpoints and crons.**
   - For each group: the sorted, deduplicated union of `factsByFile[caller.file].endpoints` / `.crons` over that group's (post-cap) callers.
   - Crons are never merged into endpoints.
   - When `factsByFile` is absent (fallback path), both arrays are `[]`. The flat `impactedEndpoints` cannot be attributed and is not emitted (see Risks and Open questions).
6. **Degraded.** `resolveDegraded(result, state, repoIntelEnabled)`, first match wins:

   | Condition | `degraded` | `reason` |
   |---|---|---|
   | `!repoIntelEnabled` | true | `flag_off` |
   | `state.degraded` (status `degraded`/`failed`, or no state row) | true | `state.degradedReason ?? 'index_failed'` (`no_data` when never indexed, `repository.ts:230-232`, `service.ts:189-205`) |
   | `state.status === 'partial'` | true | `index_partial` |
   | `result.degraded` | true | `result.reason ?? 'no_data'` |
   | otherwise | false | `null` |

   This table exists because the facade by itself only ever emits `no_data` or nothing (`service.ts:233,302,338,389`). Without it, `flag_off`, `index_failed` and `index_partial` could never reach the UI.
7. **Summary.** A plain English string built from counts: no model, used by MCP only. The UI does not render it.
   - Counts:
     - `S` = `changed_symbols.length`
     - `C` = Σ callers
     - `F` = distinct caller files
     - `E` / `J` = distinct union of endpoints / crons across `downstream`
   - Pluralise with `n === 1 ? word : word + 's'`. Exact templates:
     - no changed files: `No changed files recorded for this PR.`
     - `S === 0`: `No indexed symbols in the {n} changed file(s).` (use the pluraliser for "file")
     - `downstream` empty: `{S} changed symbol(s); no downstream callers found.`
     - else: `{S} changed symbols; {C} callers in {F} files; {E} endpoints; {J} crons.`
     - when degraded, append ` Index degraded: {reason}.`
8. **No changed files.** `pr_files` is empty, so the service skips the facade entirely. It returns `{changed_symbols:[], downstream:[], summary:'No changed files recorded for this PR.', degraded:false, reason:null}`.

### Server service surface (ring 2; illustration, not a diff)
```ts
export interface BlastLogger { info: (obj: unknown, msg?: string) => void }
export class BlastService {
  constructor(private readonly deps: {
    prs: Pick<BlastRepository, 'getPrScope'>;
    index: Pick<RepoIntel, 'getBlastRadius' | 'getIndexState'>;
    log: BlastLogger; repoIntelEnabled: boolean; maxCallersPerSymbol: number;
  }) {}
  forPull(workspaceId: string, prId: string): Promise<BlastRadius | null>   // null → route throws NotFoundError
}
```
- Exactly one `getBlastRadius` and one `getIndexState` per request, in `Promise.all`, when there are files.
- One log line proves an index **read**, not a rebuild. Nothing in the codebase logs this today. Message: `'blast radius read from repo-intel index (no re-index)'`. Fields:
  - `prId`, `repoId`
  - `changedFiles` (count)
  - `symbols`, `callers`
  - `indexStatus: state.status`, `indexedSha: state.lastIndexedSha || null`
  - `source: repoIntelEnabled && (status==='full'||status==='partial') ? 'index' : 'fallback'`
  - `degraded`, `reason`, `ms`

### UI surface (Overview tab)
`SectionLabel icon="Target"` with the title. `right` holds the degraded `Badge` (icon `AlertTriangle`, `color: var(--warn)`, `bg: var(--warn-bg)`) when `degraded`. Then:
1. **Stats row:** `{n} {stat.symbols}` · `{n} {stat.callers}` · `{n} {stat.endpoints}` · `{n} {stat.crons}`.
2. **When degraded:** one line of explanatory text, `reason.<reason>`.
3. **Per `downstream` entry:**
   - symbol name (mono) plus `declaredIn` (declaring file from `changed_symbols`) and `callerCount`;
   - a caller list: `MonoLink href={githubBlobUrl(repoFullName, headSha, file, line)}` showing `file:line`, with the caller `name` muted. No href when `repoFullName` is null, like `FindingCard.tsx:46-49`;
   - `Badge icon="Globe" mono` per endpoint and `Badge icon="Clock" mono` per cron.
4. **Empty states:**
   - `changed_symbols` empty → `noSymbols`;
   - `downstream` empty → `noDownstream` with `{count}` = changed symbols.
5. **Loading:** `Skeleton`. **Error:** inline `ErrorState` with the `error` title and retry.

### MCP tool: final strings (canonical; copy verbatim)
`get_blast_radius` description (253 chars):
```
List the symbols a pull request changes, their callers (file:line) and the HTTP endpoints and crons that depend on them, read from the DevDigest repo index (no LLM, no re-analysis). If the index is partial, failed or off, it says degraded with a reason.
```
- It follows the spec-06 shape: what it returns; when to call it (a PR's impact); a trust caveat (degraded). The stub's "not implemented" first clause is gone.

Server `instructions` (167 chars, replaces `mcp/src/server.ts:37-38`):
```
Local DevDigest PR-review studio: run review agents on imported pull requests, read findings, repo conventions and blast radius; repos are owner/name, PRs are numbers.
```
- Budget check (measured with `node`):
  - descriptions: 874 (other four) + 253 = **1,127** ≤ 1,217;
  - `tools/list` JSON: ≈ 4,236 − 184 + 253 ≈ **4,305** ≤ 4,872;
  - instructions: 167 ≤ 200.
  - No budget constant changes.
- Params are unchanged: `{ repo, pr }` from `params.ts`. Annotations are unchanged: `{ readOnlyHint: true, idempotentHint: true, openWorldHint: false }`.

MCP result shape (concise, no `response_format`):
```
{ pr: "<owner/name>#<n>", head_sha, summary,
  degraded?: true, reason?: "<enum>", hint?: "Index <reason>: callers may be missing. Re-index the repo from the DevDigest studio.",
  changed_symbols: ["<name> (<kind>) <file>", …],                      // ≤ MAX_BLAST_SYMBOLS
  downstream: [{ symbol, callers: ["<file>:<line> <name>", …], endpoints?: [...], crons?: [...] }],  // ≤ MAX_BLAST_DOWNSTREAM; empty arrays omitted
  truncated?: { symbols_shown, symbols_total, downstream_shown, downstream_total,
                hint: "Showing the highest-ranked symbols first. Open the PR's Overview tab in the DevDigest studio for the full map." } }
```

## Skill contract
Derived from `.claude/skills/pr-self-review/routing.md` (Groups table) and `ROUTES` in `.claude/hooks/pr-self-review-gate.mjs`.

| File group | Skills the implementer MUST load | Why |
|---|---|---|
| `server/src/vendor/shared/contracts/brief.ts` | `onion-architecture`, `zod`, `typescript-expert` | backend group, contracts row |
| `client/src/vendor/shared/contracts/brief.ts` | none (vendored tree → convention-only) | byte-identical mirror; the gate's `shared-drift` rule checks it |
| `server/src/modules/blast/routes.ts` | `onion-architecture`, `fastify-best-practices`, `security` | ring 4 plus HTTP surface |
| `server/src/modules/blast/{service,helpers}.ts`, `server/src/modules/index.ts` | `onion-architecture` | ring 2 / registry |
| `server/src/modules/blast/repository.ts` | `onion-architecture`, `drizzle-orm-patterns` | ring 3, the only Drizzle |
| `client/src/lib/hooks/blast.ts`, `client/src/lib/hooks/index.ts` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | frontend; files carry `"use client"` |
| `client/src/app/**/_components/{BlastRadiusPanel,OverviewTab}/*.tsx`, `…/[number]/page.tsx` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | frontend; `"use client"` / App Router page |
| `client/src/app/**/_components/BlastRadiusPanel/{helpers,styles,index}.ts` | `frontend-ui-architecture`, `react-best-practices` | frontend, no Next surface |
| `client/**/*.test.tsx` | `react-testing-library` | frontend-tests group |
| `mcp/src/api-client.ts`, `mcp/src/tools/get-blast-radius.ts` | `typescript-expert`, `security`, `zod` | mcp group plus conditional `zod` |
| `mcp/src/format.ts`, `mcp/src/server.ts` | `typescript-expert`, `security` | mcp group |
| `server/test/**`, `mcp/test/**`, `client/messages/**`, `*.md` docs, specs | none (convention-only) | static rules only |
| any `INSIGHTS.md` | `engineering-insights` | append-only format |
| end of task | `pr-self-review` | the pre-PR gate |

## Steps

**Dependency graph.**
- **Step 0** (contract) runs first, alone.
- Then **three parallel tracks** with no shared files:
  - **Server (S1–S6):** `server/src/modules/blast/**`, `server/src/modules/index.ts`, `server/test/blast*`, `server/test/routes-smoke.test.ts`, `server/README.md`, `server/src/modules/repo-intel/README.md`
  - **Client (C1–C5):** `client/messages/en/blast.json`, `client/src/lib/hooks/{blast,index}.ts`, `…/[number]/_components/{BlastRadiusPanel,OverviewTab}/**`, `…/[number]/page.tsx`, `client/README.md`
  - **MCP (M1–M4):** `mcp/src/**`, `mcp/test/**`, `mcp/README.md`, `specs/08-mcp-server.md`
- Client and MCP depend only on the step-0 shape and the route path fixed above, not on server code: client tests mock the hook, MCP tests use the fake API.
- **Wrap-up (W1–W3)** runs after all three.
- **P3 steps** (end) are optional and independent.

### 0. Contract: add `degraded` / `reason` to `BlastRadius` (blocks all tracks)
- **Files:** [`server/src/vendor/shared/contracts/brief.ts`](server/src/vendor/shared/contracts/brief.ts) (edit) · [`client/src/vendor/shared/contracts/brief.ts`](client/src/vendor/shared/contracts/brief.ts) (edit, identical)
- **Layer:** ring 0 (contract)
- **Skills:** `onion-architecture`, `zod`, `typescript-expert`
- **Do:**
  - Add `BlastDegradedReason` and the two optional fields exactly as in *Contract → Zod*.
  - Add a one-line doc comment: "`degraded`/`reason` are set by `GET /pulls/:id/blast-radius`; optional because `PrBrief` is persisted in `pr_brief.json`."
  - Apply the same bytes to the client copy. Both `index.ts` barrels already `export *` from `brief.js` (`server/src/vendor/shared/index.ts:19`, client `:19`), so no barrel edit is needed.
- **Done when:** `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` prints nothing; all three packages typecheck.
- **Verify:** `cd server && pnpm typecheck` · `cd client && pnpm typecheck` · `cd mcp && npm run typecheck`

### Server track

#### S1. `BlastRepository`: the PR's scope (repoId + changed paths)
- **Files:** `server/src/modules/blast/repository.ts` (new)
- **Layer:** ring 3
- **Skills:** `onion-architecture`, `drizzle-orm-patterns`
- **Do:**
  - `export interface PrScope { prId: string; repoId: string; files: string[] }`
  - `class BlastRepository { constructor(private db: Db) {} getPrScope(workspaceId, prId): Promise<PrScope | null> }`:
    - select `pullRequests.id, repoId` where `workspaceId` and `id` match (same scoping as `pulls/routes.ts:221-226`);
    - `null` if missing;
    - otherwise select `prFiles.path` where `prId`;
    - dedupe and sort the paths.
  - Imports: `drizzle-orm`, `../../db/client.js` (type `Db`), `../../db/schema.js`. No `$inferSelect` in the return type.
  - Do **not** reuse `container.reviewRepo.getPull/getPrFiles` (`reviews/repository.ts:29-40`): they return row types, which would leak into a ring-2 signature (rule 5).
- **Done when:** the file compiles; `pnpm lint` shows no zone violation.
- **Verify:** `cd server && pnpm typecheck && pnpm lint`

#### S2. Pure mapper + degraded resolver + summary, with unit tests
- **Files:** `server/src/modules/blast/helpers.ts` (new) · `server/test/blast-helpers.test.ts` (new, hermetic)
- **Layer:** ring 2 (`helpers.ts` matches `RING_2` in `eslint.config.mjs:116`)
- **Skills:** `onion-architecture`
- **Do:**
  - Export:
    - `toBlastRadius({ result, degraded, reason, maxCallersPerSymbol }): BlastRadius`
    - `resolveDegraded(result, state, repoIntelEnabled)`
    - `buildSummary(...)`
    - `emptyBlastRadius()`

    All implement *Contract → Mapping rules 1–8*.
  - Imports: `import type { BlastRadius, BlastDegradedReason } from '@devdigest/shared'` and `import type { BlastResult, IndexState, DegradedReason } from '../repo-intel/types.js'`. **Type-only.** A value import from `repo-intel/types.js` would fail `pnpm arch`.
  - Tests (fixtures are plain `BlastResult`/`IndexState` literals):
    - grouping by `viaSymbol`;
    - declaring-file guard drops a self-file caller;
    - per-symbol cap = injected value (use 2 in the test, not 20);
    - ordering by rank;
    - endpoints and crons attributed per group, crons kept separate;
    - missing `factsByFile` → `[]`;
    - every row of the degraded table, including `partial` → `index_partial` and flag off → `flag_off`;
    - all summary templates, including singular/plural and the degraded suffix;
    - the no-files empty value.
- **Done when:** all cases pass. `helpers.ts` has no runtime import besides nothing (pure). `pnpm lint` and `pnpm arch` are green.
- **Verify:** `cd server && pnpm exec vitest run test/blast-helpers.test.ts && pnpm lint && pnpm arch`

#### S3. `BlastService`: one index read per request, logged
- **Files:** `server/src/modules/blast/service.ts` (new) · `server/test/blast-service.test.ts` (new, hermetic)
- **Layer:** ring 2
- **Skills:** `onion-architecture`
- **Do:**
  - Constructor and `forPull` exactly as in *Contract → Server service surface*.
  - `forPull`:
    1. `prs.getPrScope`; if `null`, return `null`.
    2. If `files.length === 0`, return `emptyBlastRadius()` with no facade call.
    3. Otherwise `Promise.all([index.getBlastRadius(repoId, files), index.getIndexState(repoId)])`.
    4. `resolveDegraded`, then `toBlastRadius`.
    5. One `log.info` with the listed fields.
    6. Return.
  - The service does not throw on facade output; the facade never throws (`types.ts:15-22`).
  - Tests (fakes built with `vi.fn()`; no container, no DB):
    - PR not found → `null` and zero facade calls;
    - no files → empty value and zero facade calls;
    - happy path → `getBlastRadius` called **once** with the repo id and file list, `getIndexState` once;
    - a fake `RepoIntel`-shaped object whose `indexRepo`/`refreshIndex`/`resyncRepo` spies are **never** called;
    - `log.info` called once with `source:'index'`, `indexStatus:'full'`;
    - a flag-off case → `reason:'flag_off'`, `source:'fallback'`.
- **Done when:** tests pass. The service file contains no `Container`, `LLMProvider` or `jobs` reference.
- **Verify:** `cd server && pnpm exec vitest run test/blast-service.test.ts && pnpm lint`

#### S4. Route + registration
- **Files:** `server/src/modules/blast/routes.ts` (new) · [`server/src/modules/index.ts`](server/src/modules/index.ts) (edit: one import, one entry `blast`, after `repoIntel`)
- **Layer:** ring 4
- **Skills:** `onion-architecture`, `fastify-best-practices`, `security`
- **Do:**
  - Default plugin `blastRoutes(appBase)`: `const app = appBase.withTypeProvider<ZodTypeProvider>()`.
  - Build the service once with:
    - `prs: new BlastRepository(container.db)`;
    - `index`: **lazy** per [server/INSIGHTS.md:17](server/INSIGHTS.md:17), `{ getBlastRadius: (r, f) => container.repoIntel.getBlastRadius(r, f), getIndexState: (r) => container.repoIntel.getIndexState(r) }`;
    - `log: app.log`;
    - `repoIntelEnabled: container.config.repoIntelEnabled`;
    - `maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL`, imported from `'../repo-intel/constants.js'` (edge allowed by `.dependency-cruiser.cjs` `pathNot`).
  - `app.get('/pulls/:id/blast-radius', { schema: { params: IdParams, response: { 200: BlastRadius } } }, handler)`:
    - `const { workspaceId } = await getContext(container, req)`;
    - `const out = await service.forPull(workspaceId, req.params.id)`;
    - if `!out`, `throw new NotFoundError('Pull request not found')`;
    - return `out`.
  - Header comment listing the route (conventions style, `conventions/routes.ts:11-18`), plus a note that this module reads the index only.
  - No `rateLimit` override: the global 120/min applies (`app.ts:96`).
- **Done when:** the app boots in tests. `pnpm lint` (route zone) and `pnpm arch` are green.
- **Verify:** `cd server && pnpm typecheck && pnpm lint && pnpm arch`

#### S5. Route tests: integration (Postgres) + hermetic 422
- **Files:** `server/test/blast.it.test.ts` (new) · [`server/test/routes-smoke.test.ts`](server/test/routes-smoke.test.ts) (edit: one case)
- **Skills:** none (convention-only)
- **Do:**
  - `blast.it.test.ts`, following the `pulls-comments.it.test.ts:1-75` scaffold (`dockerAvailable`, `startPg`, `seed`, `buildApp({ config, db })`). Insert a repo, a PR and two `pr_files`. Patch the facade with the `conventions.it.test.ts:139-141` pattern so `getBlastRadius` returns a fixed `BlastResult` with `factsByFile`, and `getIndexState` returns `status:'full'`. Assert:
    1. 200, and `BlastRadius.safeParse(res.json()).success`, plus the exact downstream/endpoints/crons;
    2. the stub received exactly the two paths;
    3. a PR uuid from another workspace or a random uuid → 404 `not_found`;
    4. a PR with no `pr_files` → 200 empty map and the stub not called;
    5. `status:'partial'` → `degraded:true, reason:'index_partial'`.
  - `routes-smoke.test.ts`: `GET /pulls/not-a-uuid/blast-radius` → 422 `validation_error` (no DB needed, validation runs first).
- **Done when:** the unit lane is green without Docker; with Docker the integration file passes. Otherwise it self-skips.
- **Verify:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · `cd server && pnpm exec vitest run test/blast.it.test.ts` (Docker)

#### S6. Server docs
- **Files:** [`server/README.md`](server/README.md) (edit) · `server/src/modules/blast/README.md` (new) · [`server/src/modules/repo-intel/README.md`](server/src/modules/repo-intel/README.md) (edit)
- **Skills:** none
- **Do:**
  - `server/README.md` API map (`:81-83`): add `blast["blast<br/>/pulls/:id/blast-radius"]` to the *Repo intelligence* subgraph.
  - Module README (short):
    - purpose;
    - data flow: `pr_files` → facade → mapper → contract;
    - the degraded table;
    - that the facade may fall back to ripgrep, which is logged as `source:'fallback'`;
    - limits come from `repo-intel/constants.ts`;
    - known limitations (global cap, name collisions, unattributed fallback endpoints).
  - repo-intel README `:45-47`: add "`getBlastRadius` is consumed by `modules/blast/` (`GET /pulls/:id/blast-radius`)."
- **Done when:** the three docs mention the route; the mermaid block is syntactically unchanged apart from the new node.
- **Verify:** visual review; `git diff --stat` shows only these docs for this step

### Client track

#### C1. Labels
- **Files:** [`client/messages/en/blast.json`](client/messages/en/blast.json) (edit)
- **Skills:** none
- **Do:**
  - Keep all existing keys (`graph.*` and `view.*` are P3).
  - Change `callerCount` to `"{count, plural, one {# caller} other {# callers}}"`. It is unused today (grep shows no reader).
  - Add:
    - `title` ("Blast radius")
    - `declaredIn` ("declared in {file}")
    - `noSymbols` ("No indexed symbols in this PR's changed files.")
    - `error` ("Couldn't load the blast radius.")
    - `retry` ("Retry")
    - `degraded.badge` ("Partial data")
    - `reason.flag_off` ("Repo intelligence is turned off on the server (REPO_INTEL_ENABLED=false).")
    - `reason.index_failed` ("The last index run failed — results come from a best-effort text search.")
    - `reason.index_partial` ("The index is partial — some files were skipped, so callers may be missing.")
    - `reason.repo_too_large` ("The repo is too large to index fully.")
    - `reason.no_data` ("This repo has not been indexed yet.")
    - `endpointsAria` ("Endpoints affected")
    - `cronsAria` ("Crons and jobs affected")
- **Done when:** valid JSON, every key the component reads exists.
- **Verify:** `cd client && node -e "JSON.parse(require('fs').readFileSync('messages/en/blast.json','utf8'))"`

#### C2. Hook
- **Files:** `client/src/lib/hooks/blast.ts` (new) · [`client/src/lib/hooks/index.ts`](client/src/lib/hooks/index.ts) (edit: `export * from "./blast";`, for parity with `:53-59`)
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`
- **Do:**
  - `"use client"`.
  - `usePrBlastRadius(prId: string | null | undefined, headSha: string | null | undefined)` → `useQuery({ queryKey: ["pr-blast-radius", prId, headSha], queryFn: () => api.get<BlastRadius>(\`/pulls/${prId}/blast-radius\`), enabled: !!prId })`.
  - Type from `@devdigest/shared`. `headSha` is in the key so a pushed commit refetches.
- **Done when:** typecheck is green; the hook is imported from `@/lib/hooks/blast` in C3.
- **Verify:** `cd client && pnpm typecheck`

#### C3. `BlastRadiusPanel` component + test
- **Files (all new, folder `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel/`):** `BlastRadiusPanel.tsx` · `BlastRadiusPanel.test.tsx` · `index.ts` (`export { BlastRadiusPanel, BlastRadiusPanel as default } from "./BlastRadiusPanel";`, mirroring `OverviewTab/index.ts`) · `styles.ts` · `helpers.ts`
- **Layer:** feature folder under the PR route (`_components/<Name>/<Name>.tsx`). It is named `BlastRadiusPanel` to avoid shadowing the `BlastRadius` contract type, with `FindingsPanel` as precedent.
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (tsx) · `react-testing-library` (test)
- **Do:**
  - Props: `{ prId: string; repoFullName: string | null; headSha: string }`.
  - `"use client"`, `useTranslations("blast")`, `usePrBlastRadius(prId, headSha)` from `@/lib/hooks/blast`.
  - `githubBlobUrl` from `@/app/repos/[repoId]/pulls/[number]/github-urls` (parent-segment module takes the alias, [client/INSIGHTS.md:138](client/INSIGHTS.md:138)).
  - Render per *Contract → UI surface*.
  - `helpers.ts` (pure):
    - `blastStats(b)` → `{ symbols, callers, endpoints, crons }` from the arrays (same rules as the server summary);
    - `declaringFiles(b, symbol)` → file list from `changed_symbols`.
  - Treat `degraded === undefined` as false. Styles use tokens only.
  - Test (real `messages/en/blast.json` via `NextIntlClientProvider messages={{ blast: messages }}`, relative import depth as in `FindingCard.test.tsx:5`; `vi.mock("@/lib/hooks/blast", …)` as in `ConventionsView.test.tsx:27`; `fireEvent` only). Cases:
    1. stats numbers for a 2-symbol fixture;
    2. a caller link's `href === "https://github.com/acme/payments-api/blob/<sha>/src/api/users.ts#L118"`;
    3. endpoint and cron chips render under their symbol only;
    4. `downstream: []` with 3 symbols → the `noDownstream` text with 3;
    5. `degraded:true, reason:'index_partial'` → badge and reason text visible; absent when `degraded:false`;
    6. loading → no crash / skeleton; error → `blast.error` text.
- **Done when:** tests pass; no string literal in JSX outside `t(...)`; no numeric caps in the component.
- **Verify:** `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel" && pnpm lint && pnpm typecheck`

#### C4. Render it in the Overview tab
- **Files:** [`…/[number]/_components/OverviewTab/OverviewTab.tsx`](client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx) (edit) · [`…/[number]/page.tsx`](client/src/app/repos/[repoId]/pulls/[number]/page.tsx) (edit, `:137` only)
- **Skills:** `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`
- **Do:**
  - `OverviewTabProps` gains `prId: string | null`, `repoFullName: string | null`, `headSha: string`.
  - After the description section, render `{prId && <BlastRadiusPanel prId={prId} repoFullName={repoFullName} headSha={headSha} />}` (sibling import `../BlastRadiusPanel`).
  - `page.tsx:137` becomes `<OverviewTab prBody={pr.body} prId={prId} repoFullName={repoFullName} headSha={pr.head_sha} />`.
  - The panel mounts only after `pr` loaded (`page.tsx:110`), so `GET /pulls/:id` has already refreshed `pr_files`.
  - Leave the pre-existing hardcoded `"Description"` label (`OverviewTab.tsx:16`) alone; out of scope.
- **Done when:** typecheck is green; the full client suite passes.
- **Verify:** `cd client && pnpm test && pnpm typecheck && pnpm lint`

#### C5. Client README
- **Files:** [`client/README.md`](client/README.md) (edit, `:36`)
- **Do:** add `GET /pulls/:id/blast-radius` to the PR-detail edge label in the route map.
- **Verify:** visual review

### MCP track

#### M1. API client methods + fake API + fixtures
- **Files:** [`mcp/src/api-client.ts`](mcp/src/api-client.ts) (edit) · [`mcp/test/helpers/fake-api.ts`](mcp/test/helpers/fake-api.ts) (edit) · [`mcp/test/helpers/fixtures.ts`](mcp/test/helpers/fixtures.ts) (edit) · [`mcp/test/api-client.test.ts`](mcp/test/api-client.test.ts) (edit)
- **Skills:** `typescript-expert`, `security`, `zod`
- **Do:**
  - `ApiClient` gains:
    - `getPull(prId, opts?): Promise<PrDetail>` → `GET /pulls/:id`, `parseOrThrow(PrDetail, …)`;
    - `getBlastRadius(prId, opts?): Promise<BlastRadius>` → `GET /pulls/:id/blast-radius`, `parseOrThrow(BlastRadius, …)`.

    Both use `encodeURIComponent` and shared schemas imported from `@devdigest/shared`.
  - `FixtureState` gains `pullDetails: Record<string, PrDetail>` and `blast: Record<string, BlastRadius>`. PR 482 gets:
    - a detail with 4 files (paths as in `server/src/db/seed.ts:129-132`);
    - a blast map with 2 downstream symbols, endpoints, a `job:` cron, `degraded:false`.

    PR 480 gets `degraded:true, reason:'no_data'` and empty lists.
  - Fake routes:
    - `GET /pulls/:id` (`parts.length === 2`) → `state.pullDetails[id]` or 404;
    - `GET /pulls/:id/blast-radius` → `state.blast[id]` or 404.
  - api-client tests: both parse; a malformed blast body → `ApiError('contract')`.
- **Done when:** the api-client tests pass and every existing test is still green (fixtures are additive).
- **Verify:** `cd mcp && npx vitest run test/api-client.test.ts && npm run typecheck`

#### M2. Concise shaping with caps
- **Files:** [`mcp/src/format.ts`](mcp/src/format.ts) (edit) · [`mcp/test/format.test.ts`](mcp/test/format.test.ts) (edit)
- **Skills:** `typescript-expert`, `security`
- **Do:**
  - Add `MAX_BLAST_SYMBOLS = 50` and `MAX_BLAST_DOWNSTREAM = 30`.
  - Add `shapeBlastRadius(blast: BlastRadius, { label, headSha }): Record<string, unknown>` producing *Contract → MCP result shape*:
    - callers become strings `"<file>:<line> <name>"`;
    - empty `endpoints`/`crons` are omitted;
    - the `hint` template interpolates only the `reason` enum value.
  - Caller count per symbol is **not** re-capped here: the server already capped it with `MAX_CALLERS_PER_SYMBOL`.
  - Char guard: while `JSON.stringify(payload).length > MAX_OUTPUT_CHARS` and downstream > 1, halve the shown downstream and update `truncated`.
  - Leave `toTextResult` unchanged; the payload has no `reviews` key, so it passes through (`format.ts:238-246`).
- **Done when:** tests cover string formats, the omit-empty rule, the symbol and downstream caps with accurate `truncated` counts, the char guard, and the degraded `hint`.
- **Verify:** `cd mcp && npx vitest run test/format.test.ts`

#### M3. Replace the stub
- **Files:** [`mcp/src/tools/get-blast-radius.ts`](mcp/src/tools/get-blast-radius.ts) (edit) · [`mcp/src/server.ts`](mcp/src/server.ts) (edit `:31-38` comment + `SERVER_INSTRUCTIONS`) · [`mcp/test/get-blast-radius.test.ts`](mcp/test/get-blast-radius.test.ts) (rewrite) · [`mcp/test/tools-list-budget.test.ts`](mcp/test/tools-list-budget.test.ts) (edit comment only)
- **Skills:** `typescript-expert`, `security`, `zod`
- **Do:**
  - `DESCRIPTION` = the 253-char string, verbatim. `inputSchema: { repo, pr }` and the same annotations. Delete the TODO block and replace it with a 3-line header naming the route and spec 09.
  - Handler `(args) => safe(async () => …)`:
    1. `createResolver(deps.api)`, then `resolveRepo`, then `resolvePr`. An unknown repo or PR raises the existing actionable `ToolError`.
    2. `const detail = await deps.api.getPull(pr.id)`. This refreshes the server's changed-file list exactly as opening the PR in the studio does (`pulls/routes.ts:241-252`).
    3. `const blast = await deps.api.getBlastRadius(pr.id)`.
    4. `return toTextResult(shapeBlastRadius(blast, { label: pr.label, headSha: detail.head_sha }))`.
    - A degraded or empty map is a **normal** result, not `isError`.
  - `SERVER_INSTRUCTIONS` = the 167-char string; update the comment to cite `specs/09-blast-radius.md`.
  - Tests:
    - happy path on `acme/payments-api` `#482`: `fake.calls` equal `GET /repos`, `GET /repos/:id/pulls`, `GET /pulls/:id`, `GET /pulls/:id/blast-radius`, in that order; payload `pr`, `summary`, caller strings; `isError` falsy;
    - degraded PR 480 → `degraded`, `reason`, `hint`;
    - unknown PR `#999` → `isError` with the resolver's "not found … Known PRs" text and **no** blast call;
    - blast route 404 via `failNext` → `isError` with `found nothing at GET /pulls/<id>/blast-radius (404)`;
    - no call is a POST.
  - Budget test: update the comment's measured numbers after the first green run. Constants stay.
- **Done when:** the whole MCP suite is green, including `tools-list-budget`, `stdout` and `stdio`. `listTools()` still returns exactly five names.
- **Verify:** `cd mcp && npm test && npm run lint && npm run typecheck`

#### M4. MCP docs + spec pointer
- **Files:** [`mcp/README.md`](mcp/README.md) (edit) · [`specs/08-mcp-server.md`](specs/08-mcp-server.md) (edit, two pointers)
- **Skills:** none
- **Do:**
  - README:
    - intro `:5-8`: drop "(a stub …)";
    - tool table `:55`: args `repo`, `pr` → `{ pr, head_sha, summary, degraded?, reason?, hint?, changed_symbols, downstream, truncated? }` via `GET /pulls/:id` + `GET /pulls/:id/blast-radius`, read-only;
    - "No `outputSchema`" bullet `:160-164`: remove the stub-specific sentence;
    - **delete** the "Blast radius: the homework seam" section `:175-194`;
    - add a short "Blast radius" design note: why `getPull` first, the caps, degraded is not an error.
  - `specs/08-mcp-server.md`: under `### get_blast_radius (stub, 184 chars)` (`:186`) and `### Server instructions` (`:151`), add one line: "Superseded by `specs/09-blast-radius.md` → *MCP tool: final strings*."
  - `.mcp.json`: no change (same server, same launch).
- **Done when:** README has no "stub", "not_implemented" or "homework seam" text for this tool (`rg -n "not_implemented|homework seam" mcp/README.md` is empty).
- **Verify:** `rg -n "not_implemented|homework seam" mcp/` (only historic INSIGHTS lines may remain)

### Wrap-up

#### W1. Root docs
- **Files:** [`README.md`](README.md) (edit `:89`) · [`TESTING.md`](TESTING.md) (edit, server-integration paragraph `:45-50`)
- **Do:**
  - L04 row → `` ~~`devdigest-mcp` server~~ · ~~Blast Radius~~ (reads `repo-intel`; Overview tab + `get_blast_radius`) ``.
  - TESTING.md: add "blast radius route" to the integration list.
- **Verify:** visual review

#### W2. Manual smoke (real stack)
- **Do:**
  1. `./scripts/dev.sh`.
  2. Open seeded `acme/payments-api` PR #482 → Overview. Expect the degraded badge with `reason.no_data` and the `noSymbols` or `noDownstream` state, because the seed has no clone (`seed.ts:95`).
  3. Import a real small TS repo, wait for the **Indexed** badge, open a PR. Expect stats, caller links opening GitHub at the head sha, and endpoint/cron chips.
  4. The API log shows one `blast radius read from repo-intel index (no re-index)` line per load with `source:"index"`, and **no** `repo-intel-index` job enqueue.
  5. In Claude Code run `get_blast_radius repo <owner/name> pr <n>` and compare its `downstream` with the UI.
- **Done when:** both surfaces show the same symbols, callers and chips for the same PR.
- **Verify:** manual

#### W3. Insights + gate
- **Do:**
  - `/engineering-insights`. Candidates:
    - the facade's global-vs-per-symbol cap;
    - `pr_files` is written only by `GET /pulls/:id`;
    - the first route with a `response:` schema;
    - the degraded-reason derivation.
  - Then `/pr-self-review` until `PASS`.
- **Verify:** `/pr-self-review`

### P3 (optional; each step is independent and can be dropped)

#### P3-a. Collapsible symbol groups
- **Files:** `BlastRadiusPanel.tsx`, `styles.ts`, `BlastRadiusPanel.test.tsx`, `blast.json` (+ `expand`, `collapse`)
- **Do:**
  - Each downstream header is a `<button aria-expanded>` with `ChevronDown`.
  - Default: all expanded when ≤ 5 groups, otherwise the first 3.
  - Local `useState<Set<string>>`.
  - Test toggling with `fireEvent`.
- **Verify:** `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusPanel"`

#### P3-b. Tree / Graph toggle with a plain SVG graph
- **Files:** `BlastRadiusPanel/_components/BlastGraph/{BlastGraph.tsx,BlastGraph.test.tsx,index.ts,styles.ts,helpers.ts}` (new) · `BlastRadiusPanel.tsx` (toggle)
- **Do:**
  - Two `Chip`s with `aria-pressed` read `view.tree` / `view.graph`.
  - Graph: two columns. Changed symbols on the left, caller files on the right, one `<line>` per caller edge. Layout is computed in `helpers.ts` (pure, tested).
  - `role="img" aria-label={t("graph.ariaLabel")}`; `graph.empty` when there is no downstream.
  - No new dependency; colours via tokens.
- **Verify:** as above plus `pnpm typecheck`

#### P3-c. Re-index button next to the degraded badge
- **Files:** `BlastRadiusPanel.tsx` (edit), `BlastRadiusPanel.test.tsx`, `blast.json` (+ `resync`, `resyncStarted`) · `OverviewTab.tsx`/`page.tsx` (pass the repo uuid `repoId` from `page.tsx:30`)
- **Do:**
  - Reuse `useResyncRepoIntel(repoId)` (`client/src/lib/hooks/repo-intel.ts:41-49`; `POST /repos/:id/resync` → 202).
  - Show it only when `degraded && reason !== 'flag_off'`; a resync cannot fix a server flag.
  - On success, show `resyncStarted` and invalidate `["pr-blast-radius", prId]` after the mutation. The index finishes asynchronously, so the text says "refresh in a minute".
  - Test that the mutation is called and the button is hidden for `flag_off`.
- **Verify:** as above

#### P3-d. "Prior PRs touching these files": **out of scope, no step**
It needs merged-PR history per file from GitHub. `PrHistory` (`brief.ts:65-78`) has no data source and no route, and building one is a GitHub-adapter feature, not an index read.

## Acceptance
1. `GET /pulls/<uuid>/blast-radius` returns 200 and a body that `BlastRadius.safeParse` accepts. The route declares `response: { 200: BlastRadius }` (`blast.it.test.ts`).
2. Unknown PR → 404 `not_found`; non-uuid → 422 `validation_error` (it test + `routes-smoke.test.ts`).
3. Per request, `getBlastRadius` is called exactly once and `getIndexState` once. With no changed files, neither is called. `indexRepo`/`refreshIndex`/`resyncRepo` are never called (`blast-service.test.ts`).
4. The mapper groups by symbol, never lists a symbol's declaring file among its callers, caps callers per symbol at the injected constant, orders by rank, keeps crons separate from endpoints, and passes `degraded` + `reason` per the table (`blast-helpers.test.ts`).
5. The Overview tab shows:
   - the stats row, per-symbol callers as `file:line` links to `github.com/<repo>/blob/<head_sha>/<file>#L<line>`, and endpoint and cron chips;
   - `noDownstream` when there are no callers;
   - a degraded badge plus the reason text when the index is off, failed, partial or missing.

   All text comes from `blast.json` (`BlastRadiusPanel.test.tsx`).
6. `get_blast_radius` returns the same symbols, callers and chips as the route, capped and concise. Unknown PR → actionable `isError`. Degraded → a normal result with `reason` and `hint`. It is read-only (GET calls only) and `readOnlyHint: true` (`get-blast-radius.test.ts`, `tools-list-budget.test.ts`).
7. The API log shows one `blast radius read from repo-intel index (no re-index)` line per request (W2).
8. `pnpm lint`, `pnpm arch` and `pnpm typecheck` are green in `server/`; `pnpm lint`, `pnpm typecheck` and `pnpm test` in `client/`; `npm run lint`, `npm run typecheck` and `npm test` in `mcp/`. `/pr-self-review` = PASS.

## Test plan
| Package | Command | Covers |
|---|---|---|
| server | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `blast-helpers`, `blast-service`, 422 smoke (no Docker) |
| server | `pnpm exec vitest run test/blast.it.test.ts` · `pnpm test` | route end to end on real Postgres (Docker) |
| server | `pnpm lint && pnpm arch && pnpm typecheck` | ring zones, cross-module edges, types |
| client | `pnpm test && pnpm typecheck && pnpm lint` | `BlastRadiusPanel` + everything else |
| mcp | `npm test && npm run lint && npm run typecheck` | api-client, format, tool, budget, stdout, stdio |
| manual | W2 | UI ↔ MCP parity, log line, real indexed repo |

## Risks & rollback
- **Facade caps callers globally, not per symbol** (`service.ts:372,386`). With more than 20 resolved callers in total, low-rank symbols can show none. The mapper's per-symbol cap cannot recover them. → Open question. Rollback: n/a.
- **Fallback path does request-time text search, not an index read.** When the flag is off or the index is not `full`/`partial`, the facade runs ripgrep over the clone (`service.ts:236-295`). It is labelled degraded and logged `source:'fallback'`. On a large clone it may be slow.
- **Endpoints/crons are unattributable on the fallback path.** There is no `factsByFile`, so per-symbol chips are empty and the badge says why.
- **Same symbol name declared in two changed files** is merged into one `downstream` entry: `viaSymbol` is a bare name (`types.ts:66`) and the persistent query matches on name (`repository.ts:525-529`). The declaring-file guard could also drop a genuine cross-file caller in that case. This is documented in the module README.
- **Line drift in links.** Caller lines come from the index at `lastIndexedSha` (default branch), while links point at the PR head sha. The link may land a few lines off in files the PR also touched.
- **First `response:` schema on this server.** A mapper bug surfaces as a generic 500 `internal_error` (`app.ts:130-134`), not as malformed data. `blast.it.test.ts` catches it.
- **`pr_files` freshness.** It is populated only by `GET /pulls/:id`. The UI mounts the panel after the detail loads; MCP calls `getPull` first. A stale head (PR pushed, detail not re-fetched) shows the old file set.
- **Rollback:** everything is additive.
  - Remove `blast` from `server/src/modules/index.ts`.
  - Revert the `OverviewTab`/`page.tsx` props and the MCP tool file.
  - The two contract fields are optional, so leaving them is harmless.
  - No migration, no lock-file change.

## Out of scope
- Any change to `server/src/modules/repo-intel/**` code, including the global cap, attribution of fallback endpoints, and disambiguating same-name symbols.
- "Prior PRs touching these files" (P3-d): needs GitHub history.
- A composed `PrBrief` / `pr_brief` persistence, the Intent/Risks/SmartDiff blocks, and prompt enrichment with blast data.
- An e2e flow (`e2e/specs/11-*.flow.json`): see Open questions.
- Pre-existing hardcoded `"Description"` in `OverviewTab.tsx:16`.
- Architectural review and security review: separate agents own those.
- Opening or pushing a PR: `/pr-self-review` and the gate own that.

## Open questions
- **Non-blocking:** fix the facade's global cap (`service.ts:386`) so it caps per `viaSymbol`, as `constants.ts:29` documents ("per changed symbol")? It is a small edit plus a test in `test/repo-intel-*.test.ts`, but it touches starter infra. **Default: no.** Keep the facade untouched; document the limitation. The user decides.
- **Non-blocking:** `routes.ts` value-imports `MAX_CALLERS_PER_SYMBOL` through the grandfathered `repo-intel/constants.ts` edge. `pnpm arch` allows it, but the rule comment says "do not widen further". The alternative is moving read limits to `modules/_shared/` (a refactor). **Default: use the allowed edge.** The architecture-reviewer may flag it.
- **Non-blocking:** link callers at the PR head sha (assignment) or at the index's `lastIndexedSha` (more accurate line numbers; needs an extra optional `indexed_sha` contract field)? **Default: head sha.**
- **Non-blocking:** should the blast route refuse the ripgrep fallback (return an empty degraded map) to guarantee zero request-time analysis? **Default: no.** Keep the facade's behaviour and log `source`.
- **Non-blocking:** MCP calls `GET /pulls/:id` before the blast route. This costs one GitHub refresh when a token is set, and buys the same file set as the UI. **Default: yes.** Drop it only if latency matters more than freshness.
- **Non-blocking:** update `SERVER_INSTRUCTIONS` to mention blast radius (167 chars)? **Default: yes.**
- **Non-blocking:** add a deterministic e2e flow asserting the degraded badge on seeded PR #482? **Default: no** (not requested).
- **Blocking:** none outstanding for the stated scope.

## Decisions (2026-09-26, confirmed by the user)
1. Route path is `GET /pulls/:id/blast-radius`.
2. `server/src/modules/repo-intel/**` is not edited; the global caller cap is documented as a limitation.
3. **All three P3 steps are in scope: P3-a (collapsible groups), P3-b (Tree/Graph toggle with SVG graph), P3-c (resync button).** P3-d stays out.
4. Caller links point at the PR head sha.
5. `BFS_DEPTH` stays as is and is not exposed in the response.
6. Execution: step 0 first, then server / client / mcp implementers in parallel, then architecture-reviewer ∥ plan-verifier.

## Amendments after implementation (2026-09-26)
- **S2:** `toBlastRadius` and `buildSummary` take an extra `changedFilesCount` argument: the `S === 0` summary template needs the changed-file count, which `BlastResult` does not carry.
- **P3-a:** the open/closed state is `useState<Record<string, boolean>>` of per-symbol overrides on top of the ≤5 / first-3 defaults, not a `Set<string>`. The group header keeps the symbol name as its accessible name; "Expand"/"Collapse" is a `title` tooltip.
- **P3-b:** the Tree/Graph toggle is two hand-rolled `<button aria-pressed>` styled like `Chip`, because the vendored `Chip` has no aria pass-through (precedent: `SeverityPills.tsx`, `PRRow.tsx`).
- **MCP strings rule:** the *Constraints* rule ("MCP-authored strings interpolate only identifiers or enum values") applies to prose the model reads as an instruction (`hint`, `truncated.hint`). The data strings in `changed_symbols` / `callers` (`"<file>:<line> <name>"`) are JSON array values, not prose, and are allowed by the *MCP result shape*.
- **`retry` label:** dropped from `blast.json`; the vendored `ErrorState` renders its own retry label.
- **Architecture review:** `routes.ts` keeps the value import of `MAX_CALLERS_PER_SYMBOL` from `repo-intel/constants.ts` (the grandfathered depcruise edge). The assignment's P2 criterion asks for the limit to come from that file; a blast-local constant would satisfy the onion rule but not the criterion. Recorded as a follow-up: pin the depcruise exemption to `repos/service.ts` once the limits move to `modules/_shared/`.
- **`conventions.it.test.ts:474`** failed once in a full `pnpm test` run and passes alone (7/7); it drives a review run and touches no blast file. Treated as flaky, not a regression.
- **Gate pass (2026-09-26):** `/pr-self-review` first flagged two react-best-practices CRITICALs (a `useState` mirror of the resync mutation status; `BlastRadiusPanel` over 200 lines). Fixed by using `resync.isSuccess` and extracting the per-symbol card into `_components/BlastGroup/` (own `styles.ts`, `index.ts`, `BlastGroup.test.tsx`). Chip rows and the stats row are labelled `role="group"`s; the speculative `export * from "./blast"` barrel line was dropped (import from `@/lib/hooks/blast`). Final verdict: PASS, 5 static WARNINGs (known), 5 SUGGESTIONs.
