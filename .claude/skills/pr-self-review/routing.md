# Routing and severity

The routing table itself lives in `ROUTES` in `.claude/hooks/pr-self-review-gate.mjs`,
and `scope` applies it — this file explains the *why* and the parts a script cannot
decide. If the two ever disagree, the script is right and this file is stale.

## Groups

| Group | Files | Always | Conditionally |
|---|---|---|---|
| **frontend** | `client/src/**/*.{ts,tsx}`, not tests, not `vendor/` | `frontend-ui-architecture`, `react-best-practices` | `next-best-practices` when the file is an App Router convention file (`page`, `layout`, `loading`, `error`, `not-found`, `template`, `default`, `route`, `middleware`) or contains `'use client'` / `'use server'` / a `next/*` import |
| **frontend-tests** | `client/**/*.test.tsx?` | `react-testing-library` | — |
| **backend** | `server/src/**/*.ts`, not `vendor/ui` | `onion-architecture` | `fastify-best-practices` for `routes.ts`, `app.ts`, `server.ts`, `platform/**` · `drizzle-orm-patterns` for `repository*.ts`, `db/**` · `postgresql-table-design` for `db/schema/**` · `security` for `routes.ts`, `adapters/{auth,secrets,github}/**` · `zod` + `typescript-expert` for `vendor/shared/contracts/**` |
| **engine** | `reviewer-core/src/**/*.ts`, not tests | `typescript-expert` | `security` for `prompt.ts`, `grounding.ts`, `llm/**` · `zod` for schema / structured-output files |
| **convention-only** | `e2e/**`, `server/test/**`, `client/messages/**`, vendored trees, `.claude/**`, `.github/**`, `scripts/**`, `docs/**`, specs, migrations, configs, every non-source extension | — (static rules + machine checks only) | — |
| **unrouted** | any other `.ts/.tsx/.js/.mjs/.cjs` | — | reported as a WARNING so the table gets extended |

Why the groups are cut this way:

- **One skill per question.** `frontend-ui-architecture` and `react-best-practices` have
  explicit "does not cover X, see Y" boundaries in their descriptions; loading both on a
  component file is intended, loading `next-best-practices` on a plain hook is noise.
- **`typescript-expert` is not on every `.ts` file.** It is broad and long; on a routes
  file it would restate what `fastify-best-practices` already says. It earns its place on
  the engine (type-level code) and on the contracts (the shared types).
- **`security` is targeted, not global.** Its own philosophy is confidence-based: it wants
  attacker-controlled input, which lives at the HTTP boundary, the auth/secrets adapters,
  and the prompt assembly. Everywhere else it would produce LOW findings it tells you not
  to report.
- **Tests are their own group.** `react-testing-library` reviews tests; nothing else should
  judge a test file by component rules.

## Severity normalisation

The report uses the product's own enum, read from
`server/src/vendor/shared/contracts/findings.ts` at run time. Skills speak other scales:

| Skill says | Report severity |
|---|---|
| `react-best-practices` **CRITICAL** | CRITICAL |
| `react-best-practices` **HIGH** | WARNING |
| `react-best-practices` **MEDIUM** | SUGGESTION |
| `security` **HIGH** confidence (pattern + attacker-controlled input confirmed) | CRITICAL |
| `security` **MEDIUM** (pattern, source unclear) | WARNING |
| `security` **LOW** | do not report |
| `onion-architecture` rules 1–11 (any, including review-only 5/6/9/11) | CRITICAL |
| `onion-architecture` "where do I put it" table — wrong folder, still right ring | WARNING |
| `frontend-ui-architecture` — feature→feature import, `src/components|lib` → `src/app`, `fetch` in a component, hardcoded user-facing string | CRITICAL |
| `frontend-ui-architecture` — promotion ladder / placement smell / speculative shared / barrel | WARNING |
| `next-best-practices` — RSC boundary broken (`'use client'` on a page/layout, server-only import in a client file, async API used sync) | CRITICAL |
| `next-best-practices` — metadata, image/font, bundling advice | SUGGESTION |
| `fastify-best-practices` — validation missing / `.parse()` in handler / plugin order | CRITICAL (these are also onion rules 6 and AGENTS conventions) |
| `fastify-best-practices` — everything else | SUGGESTION |
| `drizzle-orm-patterns` / `postgresql-table-design` — missing constraint, wrong type, hand-written migration | WARNING (CRITICAL if a static rule also fires) |
| `zod` — schema re-parsed in ring 2, `z.any`, missing `.strict()` on a wire contract | WARNING |
| `react-testing-library` — asserting on implementation details, missing `await` on user events | WARNING |
| `typescript-expert` — unsafe `as`, `any` in a public signature | WARNING |
| `insights` — diff repeats a *What Doesn't Work* entry | WARNING |
| anything else | SUGGESTION |

`finalize` also accepts `HIGH → WARNING` and `MEDIUM/LOW/INFO → SUGGESTION` if a raw word
slips through, and drops any other value.

## Static rules (the script owns these)

Run by `scope`, `finalize` and both gates. Source: the "Do not touch", "Naming
conventions" and "Gotchas" sections of the five `AGENTS.md` files.

| Rule | Severity | Fires when |
|---|---|---|
| `migration-edited` | CRITICAL | an existing `server/src/db/migrations/*.sql` or snapshot is modified/removed |
| `migration-name` / `migration-journal` | CRITICAL | a new migration is not `NNNN_name.sql`, or `meta/_journal.json` did not change with it |
| `lockfile` | CRITICAL | a lock-file changed without its `package.json`, or was deleted |
| `claude-md-stub` | CRITICAL | a `CLAUDE.md` contains anything but `@AGENTS.md` (HTML comments allowed) |
| `do-not-touch` | CRITICAL, waivable | `reviewer-core/src/grounding.ts` changed, or `INJECTION_GUARD` appears in the `prompt.ts` hunks |
| `test-naming` | CRITICAL / WARNING | a `server/test` file that imports testcontainers or `db/client` is not `*.it.test.ts` / the reverse |
| `engine-purity` | CRITICAL | `reviewer-core/src` gains an import of fs, child_process, net, pg, drizzle, octokit, fastify |
| `secret` | CRITICAL | `.env*`, `secrets.json`, or an added line that looks like an API key / private key |
| `e2e-flow` | CRITICAL | a flow file is misnamed or uses the AI `chat` command |
| `shared-drift` | WARNING | `vendor/shared` changed in one copy only |
| `pr-size` | WARNING | > 40 files or > 1500 changed lines |
| `no-insights` / `insights-rewrite` | WARNING | > 150 added source lines with no `INSIGHTS.md` change / an existing entry removed |
| `component-test-missing` | WARNING | a new `_components/<Name>/<Name>.tsx` without `<Name>.test.tsx` |
| `unrouted-skill` / `unrouted-file` | WARNING | a skill on disk with no route, a route with no skill, a source file with no group |

Failed machine checks are reported as `skill: "check"` CRITICALs by `finalize`.

## Judgement rules the script cannot check

Walk these explicitly in step 3, per group. They are the review-only half of the repo's
conventions; each maps to CRITICAL unless noted.

**backend**
- Onion rule 5 — a `$inferSelect` row type in a ring-2 public signature (`service.ts`, `helpers.ts`).
- Onion rule 6 — `Schema.parse(req.body)` in a handler instead of a declared route schema.
- Onion rule 9 — a new service taking the whole `Container` instead of the ports it uses.
- Onion rule 11 — a new module without `service.ts` (+ `repository.ts` if it touches Postgres) and an entry in `modules/index.ts`.
- Relative import without the `.js` extension (ESM; resolution is not rewritten).
- A file whose name matches no zone (`feature-models.ts`, `status.ts`) — WARNING, see `onion-architecture/enforcement.md`.
- Cost handling that coerces an unknown cost to `0` instead of `null` (root `INSIGHTS.md`, Codebase Patterns) — WARNING.

**frontend**
- `'use client'` on a page or layout rather than the smallest leaf (`client/AGENTS.md`).
- `fetch` in a component instead of a hook in `src/lib/hooks/*` through `src/lib/api.ts`.
- A user-facing string literal in JSX instead of `messages/en/<namespace>.json` + `useTranslations`.
- A hand-rolled primitive that `@devdigest/ui` already has — WARNING.
- A payload type re-declared locally instead of imported from `@devdigest/shared` — WARNING.
- Relative import that climbs out of the folder instead of `@/` — SUGGESTION.

**engine**
- Untrusted text entering a prompt without `wrapUntrusted()`.
- Response shape described in prompt prose instead of the JSON Schema — WARNING.
- A new prompt slot that changes `assemblePrompt`'s shape when empty — WARNING.

**convention-only**
- `e2e` flow with non-deterministic locators, or one that could trigger a model call — WARNING.
- A `messages/en` key added in one namespace file and read from another — WARNING.
