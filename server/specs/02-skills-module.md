# Skills module and the prompt slot (API)

**Status:** Implemented. The cross-package spec is
[`../../specs/03-skills.md`](../../specs/03-skills.md); this one covers only
`@devdigest/api`.

## Problem

Three tables, a full set of contracts and five working repository methods exist
for a feature no route serves.

`skills`, `skill_versions` and `agent_skills` ship in `0000_init.sql` and stay
empty. `AgentsRepository.linkedSkills` / `skillIdsForAgent` / `linkSkill` /
`unlinkSkill` / `setSkills` (`modules/agents/repository.ts:189-240`) are
implemented and called from nowhere. `GET`/`POST /agents/:id/skills` are wired to
them, so an agent can already be given skills that do not exist and can never be
created.

And `run-executor.ts:190-212` builds the `reviewPullRequest` input without
`skills`, so even a populated `agent_skills` would change nothing about a review.

## Scope

In:

- `modules/skills/` — `routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`,
  `constants.ts`; one import and one entry in `modules/index.ts`.
- `SkillsRepository` on the composition root as `container.skillsRepo`.
- `PATCH` and `DELETE /agents/:id/skills/:skillId`, and a fix to `setSkills`.
- `buildSkillBlocks` in `run-executor.ts` and the `skills` spread at the
  `reviewPullRequest` call site.
- One generated migration: `agent_skills.enabled`, `skill_versions.note`,
  `skills_ws_idx`.
- `fflate` as a dependency, used only for in-memory archive parsing.
- **Added 2026-09-20:** `POST /skills/import/url(/preview)`; the `UrlFetcher`
  port (`vendor/shared/adapters.ts`) with `adapters/url-fetcher/` (guard +
  `FetchUrlFetcher`) and `MockUrlFetcher`; `modules/skills/injection-scan.ts`;
  `security` on the `Skill` / `SkillImportPreview` DTOs; the enable gate in
  `SkillsService.update` / `restore`.

Out:

- New tables. Two columns and one index on tables that already exist.
- A change to `reviewer-core`. The slot and its semantics are already right.
- ~~An HTTP adapter for URL import.~~ Arrived 2026-09-20, and as promised it
  goes through the DI container (`container.urlFetcher`), not a bare `fetch`.
- Denormalizing skill bodies onto `agent_runs`. The run trace already records the
  assembled text; a second copy is one more thing to keep in step.

## Contract

**Routes.** `modules/skills/routes.ts`, following `modules/agents/routes.ts`
exactly: `withTypeProvider<ZodTypeProvider>()`, `getContext` first in every
handler, request bodies declared locally (shared holds response DTOs only),
declarative `schema`, `undefined` from the service becoming `NotFoundError` in
the route.

```
GET    /skills                        → Skill[]
GET    /skills/:id                    → Skill
POST   /skills                        → Skill              201
PUT    /skills/:id                    → Skill
DELETE /skills/:id                    → { ok: true }
GET    /skills/:id/versions           → SkillVersion[]     newest first
GET    /skills/:id/versions/:version  → SkillVersion
POST   /skills/:id/restore            → Skill              { version, note? }
GET    /skills/:id/agents             → SkillUsage[]
GET    /skills/:id/stats              → SkillStats
POST   /skills/import/preview         → SkillImportPreview writes nothing
POST   /skills/import                 → Skill              201
```

`VersionParams` copies the agents one, `z.coerce.number().int().positive()`
included, so a non-numeric `:version` is a **422** and not a 404.

On the agent side, two routes over repository methods that already exist:

```
PATCH  /agents/:id/skills/:skillId    → AgentSkillLink[]   { enabled?, order? }
DELETE /agents/:id/skills/:skillId    → AgentSkillLink[]
```

**Why `setSkills` has to change.** It is `DELETE WHERE agent_id` followed by a
bulk insert with `order = index`. Correct today, and a data-loss bug the moment
`agent_skills.enabled` exists: every reorder would silently clear every binding
the user had enabled. It reads the existing `skill_id → enabled` map first and
re-inserts with the flag preserved, defaulting a newly linked id to `false`. The
route contract does not change.

**Two read paths over the link table, on purpose.** `linkedSkills` stays
unfiltered because the editor has to render disabled bindings. `blocksForAgent`
is the narrow one the prompt uses: `skills.enabled AND agent_skills.enabled`,
ordered by `agent_skills.order`. Filtering in the query, not in the caller.

**Why the repository goes on the container.** `run-executor.ts` lives in
`modules/reviews`. Importing `modules/skills/repository.js` from there is a
cross-folder edge `pnpm arch` fails on. `container.skillsRepo` is a memoized
getter beside `agentsRepo`, which is what the composition root is for.

**Versioning.** Changing `body` bumps `skills.version` and inserts a
`skill_versions` row with `onConflictDoNothing()`. Changing name, description or
type, or toggling `enabled`, does not — the same rule `isConfigChange` applies to
agents, except that `skill_versions` snapshots the body rather than a config
blob. Restore reads version *N* and writes it as *max + 1* with the note
`Restored v{N}`; an applied version is never mutated, for the same reason an
applied migration is never edited.

**Import transport is base64 in JSON, not multipart.** `client/src/lib/api.ts`
sets `content-type: application/json` on any non-null body, so `FormData` would
arrive with a broken boundary. Patching the fetch wrapper and adding
`@fastify/multipart` was the alternative. Base64 needs neither, and — the
deciding reason — it keeps the route declaratively zod-validated, which a
multipart body cannot be. A 1 MiB cap makes the 33 % overhead irrelevant.

**Archive limits**, in `constants.ts`, each rejection naming its reason in the
preview: 1 MiB decoded upload, 200 entries, 256 KiB per entry, 4 MiB total
uncompressed aborted mid-inflate rather than checked afterwards. Any entry whose
normalized path escapes the root, and any symlink entry, is refused. Traversal
cannot bite us because nothing is written to disk; it is checked anyway.

Core selection inside an archive, shallowest first: `SKILL.md`, then `README.md`,
then the only `.md` if there is exactly one, otherwise reject.

**URL import (2026-09-20).** `previewUrlImport(url)` and
`commitUrlImport(workspaceId, url, overrides)` call
`container.urlFetcher.fetch(url, { maxBytes: MAX_UPLOAD_BYTES })`, refuse a
non-accepted `content-type` (`text/html` in particular — the "GitHub blob page,
not raw" mistake — with a message that says so), derive the filename from the
final URL's last path segment (`.md`/`.markdown`/`.txt`/`.zip`, else `SKILL.md`
or `SKILL.zip` by content type) and hand the bytes to the same `parseImport`,
now taking a `source` argument. Commit re-fetches; nothing from the preview is
trusted back. The port lives in `vendor/shared/adapters.ts` and not next to the
adapter like `Tokenizer` does, because the ring-2 lint zone forbids *any*
import from `adapters/**` in a service — type-only included. The adapter cannot
import `MAX_UPLOAD_BYTES` either (`adapter-not-to-feature`), so the service
passes `maxBytes` in. Guard rules — protocol, hostname, literal and resolved
address classes, redirect re-check, timeout, declared and streamed size — are
in `adapters/url-fetcher/guard.ts` / `fetch.ts` and `test/url-fetcher.test.ts`.

**Injection scan and the enable gate (2026-09-20).** `injection-scan.ts` is a
ring-2 pure module (added to `RING_2` in `eslint.config.mjs` so the zone rules
cover it) exporting `INJECTION_RULES` and `scanSkillBody`. `toSkillDto` attaches
`security` — computed on read for `SCANNED_SOURCES` (`imported_url`,
`imported_file`), `not_scanned` otherwise — and `parseImport` attaches it to the
preview. `SkillsService.update` loads the row first and, when the result would
be an enabled scanned skill with a flagged body, throws `ValidationError` with
`{ findings }`; `restore` applies the same check to the snapshot. The service
now takes its repository from `container.skillsRepo` instead of constructing
one over `container.db`, which is what lets `test/skills-service.test.ts` run
the gate on an in-memory fake without Postgres.

**Frontmatter is read with a key-value line parser, not a YAML library.** Three
optional string keys off untrusted input do not justify anchors, aliases, tags
and a parser's CVE history.

**Token accounting.** `buildSkillBlocks` counts with `container.tokenizer` and
logs `skills: N skill(s) attached (T tokens)` through `RunLogger`, so the line
lands in the SSE stream, the persisted trace log and stdout at once. The
tokenizer's header currently scopes it to `modules/repo-intel`; that comment is
widened to name prompt-slot accounting as its second consumer. Under `map-reduce`
the block is sent once per chunk — the per-run total is a multiple of `T`.

**The failed-run paths stay as they are.** `run-executor.ts:430` and
`trace-builder.ts:60` hardcode `skills: null`; a run that never assembled a
prompt has no skills block, and that is the truth.

## Acceptance

- `GET /skills` is workspace-scoped; a skill in another workspace is invisible
  through the route and returns `undefined` from the service, asserted directly
  against a second workspace.
- Editing a body bumps the version and appends a snapshot; editing a name or
  toggling `enabled` leaves both alone.
- `GET /skills/:id/versions` is newest-first; `/versions/:version` returns one;
  `/versions/abc` is 422; an unknown id or version is 404.
- Restore appends rather than rewinds: after restoring v2 of a five-version
  skill, the latest version is 6 and its body equals v2's.
- Reordering an agent's skills leaves every `enabled` flag as it was.
- `PATCH` flips one binding without touching any `order`; `DELETE` unlinks.
- `blocksForAgent` omits a globally disabled skill and a disabled binding, and
  returns the rest in `order`.
- With nothing attached, the assembled user message is byte-identical to the one
  produced before this change.
- A non-`manual` body arrives inside `<untrusted>` delimiters.
- Archive rejection cases each fail with their own reason and touch no file:
  traversal path, symlink entry, 300 entries, a 10 MiB member, a bomb.
- `POST /skills/import` ignores a client-supplied body and re-derives it.
- `POST /skills/import/url/preview` with an injected body returns
  `security.status: 'flagged'`; `POST /skills/import/url` lands `imported_url`,
  disabled, and `PUT { enabled: true }` on it is a 422 whose `details.findings`
  names the rule and line; a clean body edit in the same `PUT` succeeds.
  `not a url` is a 422 before the fetcher is touched.
- `assertPublicHttpUrl` rejects `ftp:`, `file:`, `localhost`, `*.local`,
  `127.0.0.1`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `0.0.0.0`,
  `[::1]`, IPv4-mapped IPv6, `fe80::/10`, `fc00::/7` and embedded credentials;
  `FetchUrlFetcher` refuses a redirect hop or a DNS answer into any of those,
  more than three hops, a `content-length` over the cap, and a streamed body
  over the cap.
- Covered by `test/skills.it.test.ts` and `test/agent-skills.it.test.ts` (real
  Postgres, `.it.` suffix mandatory), plus `test/skills-import.test.ts` and
  `test/prompt-skills.test.ts`. `blocksForAgent`'s filter/order coverage lives
  in `skills.it.test.ts` rather than a separate `skills-resolve.test.ts` — see
  the cross-package spec's Acceptance section for why. The URL import and the
  injection scan add `test/skills-injection-scan.test.ts`,
  `test/url-fetcher.test.ts`, `test/skills-service.test.ts` and a
  `routes-smoke.test.ts` case (auth + fetcher mocked, no DB).
- `pnpm lint`, `pnpm arch`, `pnpm typecheck` and `pnpm test` stay green. Every new
  file uses a conventional name — an unrecognized one matches no onion zone and
  leaves the architecture without failing anything.

## Open questions

- `fflate` is a new dependency in a package that has avoided one for archive
  work so far. A hand-rolled central-directory reader over `node:zlib` would keep
  the count at zero, at the cost of owning a zip parser. Is the dependency the
  right trade?

  **Resolved: yes, but partially hand-rolled anyway.** `fflate` (zero
  dependencies, ~8 KB, synchronous) does the inflate; `unzipSync`'s `filter`
  callback doesn't expose a zip entry's external file attributes, which is
  where a symlink's unix mode bits live, so `modules/skills/helpers.ts` reads
  the central directory itself (`readExternalAttrs`) for just that one field.
  Net: no full zip parser to own, but the traversal/symlink/size guards run
  BEFORE any entry is inflated either way.
