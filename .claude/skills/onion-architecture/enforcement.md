# Enforcement

Two commands, both green on `main`, both required before a commit:

```sh
cd server && pnpm lint      # eslint.config.mjs      — per-file import zones
cd server && pnpm arch      # .dependency-cruiser.cjs — the graph
```

They are separate on purpose: a structural failure should not read like a style failure.
`lint` is also what fires in the editor, so ring violations surface while you type.

## Why this split

ESLint sees one file at a time and matches on the *import specifier*, which is exactly right
for "a service may not import Drizzle" and useless for "these two folders must not form a
cycle". dependency-cruiser resolves the graph, follows the tsconfig `paths` aliases, and can
express a back-reference (`modules/a` may not import `modules/$1≠a`). Neither tool alone
covers the eleven rules; together they cover nine of them, and the remaining two (rules 5
and 6 — row types in a signature, hand-rolled `.parse()`) are type-level and judgement
calls, so they stay review-only.

One constraint drove the split as much as capability: `src/vendor/**` is in ESLint's
`ignores`, so no lint rule can ever protect rings 0–1. `contract-stays-pure` and
`port-stays-pure` in the arch config are the only things guarding the innermost rings.

**No new dependency was added.** `dependency-cruiser` is already a runtime dependency of
`server/` — `adapters/depgraph/index.ts` wraps it — so the lockfile is untouched, which
matters here because lockfiles are do-not-touch.

---

## What lives where

| Rule | Check | Mechanism |
|---|---|---|
| 1 `fastify` outside ring 4 | lint | `no-restricted-imports` on the ring-2 zone |
| 2 persistence outside ring 3 | lint | same, plus the `routes.ts` zone |
| 3 vendor SDK outside `adapters/**` | lint | same, on every zone |
| 4 `node:fs` / `child_process` outside ring 3 | lint | same |
| 5 row type in a ring-2 signature | review | a type in a signature is not an import |
| 6 `.parse()` in a handler | review | — |
| 7 `zod` imported by ring 2 | lint | `no-restricted-imports` |
| 8 ring 2 importing an adapter | lint | `**/adapters/**` pattern |
| 9 adapter reaching for the container | arch | `adapter-not-to-container` |
| 10 sideways / outward folder edges | arch | `adapter-not-to-db`, `adapter-not-to-feature`, `platform-not-to-feature`, `no-cross-module-reach-in` |
| 11 module missing a service | review | — |
| (bonus) cycles, dev-dep leaks, pure contracts and ports | arch | `no-circular`, `not-to-dev-dep`, `contract-stays-pure`, `port-stays-pure` |

`tsPreCompilationDeps` is deliberately `false` in the arch config: `import type` is erased at
compile time, so a type-only import of `Container` is not a runtime edge. That is what lets
ring 2 name the shape it needs without the composition root becoming a runtime dependency —
and it is why the `container.ts ↔ modules/**` relationship is not reported as a cycle.

---

## Reading a failure

A lint failure names the rule and points back at `rules.md`:

```
src/modules/repos/service.ts
  1:1  error  'drizzle-orm' import is restricted from being used by a pattern.
              Rule 2 — persistence is ring 3. Move the query into
              modules/<name>/repository.ts and inject it
              (see .claude/skills/onion-architecture/rules.md)   no-restricted-imports
```

An arch failure names the edge:

```
  error platform-not-to-feature: src/platform/jobs.ts → src/modules/repos/repository.ts
```

In both cases the fix is placement, not the rule. Move the code to the ring that owns it —
the query to a repository, the SDK behind an adapter, the shared constant inward.

---

## The grandfathered list

These are the violations that existed before the checks did. They are frozen file by file so
the rules could be `error` for new code on day one, and each entry keeps every rule it does
**not** currently break — so a grandfathered file cannot drift further.

**Shrink this list. Never add to it.** If you need a new exception, read the last section.

### Ring 2 holding ring-3 concerns

| File | Breaks | Intended fix |
|---|---|---|
| `modules/reviews/service.ts` | imports `db/rows.js`; `AgentRow` is in the public signature of `resolveTargets` / `runReview` | give the use case the 3–4 agent fields it actually reads; map in `helpers.ts` |
| `modules/reviews/run-executor.ts` | imports `db/schema.js` + `db/rows.js`; takes `typeof schema.repos.$inferSelect` | same — a narrow `RepoContext` input built by the caller |
| `modules/reviews/diff-loader.ts` | imports `db/schema.js` and `adapters/git/diff-parser.js` directly | take the parsed diff as an argument; the route or the container supplies the parser |
| `modules/repos/helpers.ts` | imports `db/schema.js` for the row type in `toRepoDto` | acceptable at the mapper boundary; the row type should come from `repository.ts`, not the schema barrel |
| `modules/repo-intel/service.ts` | imports `adapters/astgrep`, `adapters/codeindex/extract` and `node:fs/promises` | delegate to its own ring-3 `pipeline/**`, which already owns these; the facade should call, not parse |

### Routes doing their own persistence

| Files | Breaks | Intended fix |
|---|---|---|
| `modules/{pulls,polling,settings,workspace}/routes.ts` | import `drizzle-orm` + `db/schema.js` | the missing halves of rule 11 — add `service.ts` + `repository.ts` to each and move the queries down. `pulls/routes.ts` (383 lines, incl. GitHub sync and per-PR aggregates) is the one worth doing first |

### Adapters reaching sideways

| File | Breaks | Intended fix |
|---|---|---|
| `adapters/auth/local.ts` | imports `db/client.js`, `db/schema.js`, `db/seed.js` | either accept a lookup function, or accept that "local auth" *is* a DB read and move it behind a small port of its own |
| `adapters/{astgrep,depgraph}/index.ts` | import `modules/repo-intel/constants.js` (`SUPPORTED_EXT`, `MAX_SIGNATURE_CHARS`) | move those two constants next to the adapters, or inward to `modules/_shared/` |

### Cross-module edge

| Edge | Breaks | Intended fix |
|---|---|---|
| `modules/repos/service.ts` → `modules/repo-intel/constants.js` | reads `INDEX_JOB_KIND` / `REFRESH_JOB_KIND` to enqueue an index job | job kinds are cross-cutting — move them to `modules/_shared/`. This one is exempted in `.dependency-cruiser.cjs` by path, not by folder, so no other cross-module edge slips through with it |

### Not grandfathered, but not enforced either

Two holes worth knowing rather than pretending away:

- `modules/settings/feature-models.ts` and `modules/pulls/status.ts` are ring-2-ish files
  whose names match no zone glob, so no zone applies to either. `status.ts` happens to be
  pure; `feature-models.ts` imports `drizzle-orm` and the `Container`. Giving a file a
  conventional name (`service.ts`, `helpers.ts`, `constants.ts`, `repository.ts`) is what
  puts it in a ring — an unconventional name opts out silently, so prefer the conventional
  one even when the file is small.
- Rules 5, 6, 9 and 11 have no machine check at all. They are in the SKILL.md checklist
  because that is the only place they can be.

---

## Adding an exception

In order of preference:

1. **Move the code.** Nearly always the right answer, and usually smaller than it looks.
2. **Widen a ring definition** in `layers.md` *and* the zone glob, when a file genuinely
   belongs to a ring the map does not yet name. Change the map, not just the config, or the
   two disagree and the next agent believes the wrong one.
3. **A one-line, commented per-file override** in the relevant config, added to the table
   above with its intended fix. This is the grandfathering mechanism, and every entry is a
   debt with a name.

What not to do: delete a rule, turn a zone to `warn`, add a blanket
`/* eslint-disable no-restricted-imports */`, or move a file to a non-conventional name so no
zone matches it. All four work, and all four make the check a decoration — which is exactly
what this skill was written to replace.

When a rule turns out to be wrong rather than inconvenient, that is worth recording: run
`/engineering-insights` and put it in `server/INSIGHTS.md` under *Codebase Patterns* with the
why.

---

## Sources

- [`no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports) — the
  `patterns` / `group` form. It matches the **import specifier as written**, so
  `**/db/schema*` catches `'../../db/schema.js'`; it never sees a resolved path.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) ·
  [rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
  — `forbidden` rules, `circular`, and the `$1` back-reference in `to.pathNot` that
  `no-cross-module-reach-in` is built on.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — the
  declarative alternative: named element types and an allow/disallow policy instead of
  hand-written zones. Not used here because it would add a dependency for something two
  already-present tools cover, but it is the escape hatch if the zone list stops scaling.
- [Ensuring dependency rules in a Node + TypeScript app with eslint-plugin-boundaries](https://medium.com/@taynan_duarte/ensuring-dependency-rules-in-a-nodejs-application-with-typescript-using-eslint-plugin-boundaries-68b70ce32437)
- [Validate dependencies according to Clean Architecture](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c)
