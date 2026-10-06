---
name: dependency-checker
description: >-
  Audits the dependencies of this repo and of each of its packages (server, client,
  reviewer-core, e2e, mcp, evals): external npm dependencies by type and installed size,
  internal cross-package dependencies wired through tsconfig path aliases, version drift of
  the same library across packages, unused or misplaced dependencies, deep imports that
  bypass a package's public entry point. Produces one structured report — Scope, a Mermaid
  dependency graph, a size breakdown table, findings ranked P0 / P1 / P2 / Info with a
  concrete recommendation each, and a short prioritized Summary. Use when asked to "check
  dependencies", "audit deps", "what are our heaviest packages", "are there unused /
  duplicated dependencies", "draw the dependency graph", "dependency report", or before a
  dependency cleanup or upgrade. Analysis only — it never edits package.json or lockfiles.
argument-hint: "[package ...] [--offline]"
---

# Dependency Checker

Answers one question: **what does each package in this repo depend on, what does it cost,
and what should we fix first?** The output is a report a developer can act on without
re-doing the analysis — every number has a source, every finding names a file.

Companions:

- [references/collect.md](references/collect.md) — the exact commands to gather the data,
  per package manager, and how to detect usage.
- [references/report-template.md](references/report-template.md) — the report contract:
  section order, table columns, finding format, Mermaid conventions. **Follow it exactly.**

## Hard rules

- **Analysis only.** Never edit a `package.json`, never touch a lockfile, never run
  `install` / `add` / `remove` / `update`. Removing or upgrading a dependency is a
  *recommendation for the user to confirm*, written as such ("Recommend removing … —
  confirm, then run `pnpm remove moment` in `server/`").
- **Not a monorepo.** The packages are standalone, each with its own `package.json` and
  lockfile. They share code through **tsconfig `paths` aliases and relative imports**, never
  through `workspace:*` or pnpm/npm workspaces. Never describe them as workspace-linked.
- **Every finding is specific.** It names a package, a dependency and a file
  (`server/package.json`, `server/src/services/review-service.ts`). "Consider optimizing
  dependencies" is not a finding.
- **Every number has a source.** Sizes come from `du` on `node_modules`, versions from
  `package.json` / lockfile. What was not measured is written as `n/m` (not measured) —
  never estimated silently.
- **Data already given wins.** If the prompt already contains the collected data
  (package.json contents, sizes, grep results), build the report from it directly — do not
  ask for tool access or more data.

## Packages in scope

| Package | Path | Package manager | Lockfile |
|---|---|---|---|
| `@devdigest/api` | `server/` | pnpm | `server/pnpm-lock.yaml` |
| `@devdigest/web` | `client/` | pnpm | `client/pnpm-lock.yaml` |
| `@devdigest/reviewer-core` | `reviewer-core/` | npm | `reviewer-core/package-lock.json` |
| `@devdigest/e2e` | `e2e/` | npm | `e2e/package-lock.json` |
| `@devdigest/mcp` | `mcp/` | npm | `mcp/package-lock.json` |
| evals | `evals/` | pnpm | `evals/pnpm-lock.yaml` |

With arguments, analyze only the named packages, but still show their internal edges to
the others. Packages that exist in the prompt's data but not in this table are analyzed too.

## Two kinds of dependency — never mix them

| Kind | How it is wired | Where to find it | Example |
|---|---|---|---|
| **External** | npm package in `dependencies` / `devDependencies` / `peerDependencies` | `package.json`, lockfile, `node_modules` | `fastify`, `next`, `zod` |
| **Internal** | tsconfig `paths` alias or relative import across a package folder | `tsconfig.json` `paths`, `grep` for `../<pkg>/` | `@devdigest/shared` → `server/src/vendor/shared`, `@devdigest/reviewer-core` → `reviewer-core/src/index.ts` |

Known internal wiring (verify against the tree, it can change):

- `server` → `@devdigest/reviewer-core` (`../reviewer-core/src/index.ts`) and
  `@devdigest/shared` (`server/src/vendor/shared`, the **canonical** copy).
- `client` → its **own vendored copy** `client/src/vendor/shared` (known to drift from the
  server copy) and `@devdigest/ui`.
- `mcp` → `../server/src/vendor/shared`.

An internal import that goes **past the public entry point** (e.g. `reviewer-core/src/pipeline.js`
instead of `@devdigest/reviewer-core`) is a boundary violation, not a style nit.

## Workflow

1. **Scope.** Resolve which packages to analyze and which package manager owns each.
2. **Collect** (see [references/collect.md](references/collect.md)): per package — declared
   deps with version and type, installed size of each direct dep, total `node_modules`
   size, usage (is it imported anywhere, or used via CLI / config), tsconfig `paths`, and
   cross-package imports. Optional and network-bound: `audit`, `outdated` — skip with
   `--offline` and say so in Scope.
3. **Classify** each external dep: **type** (`runtime` / `dev` / `peer`) and **category**
   (`framework`, `db`, `validation`, `ui`, `test`, `build`, `lint`, `util`, `date`, `ai`, …).
4. **Cross-check** across packages: same library at different versions (drift), the same
   heavy library installed in several packages, a dep declared but never used, a dep
   imported but not declared, a runtime-only tool in `dependencies` that belongs in
   `devDependencies` (or the reverse).
5. **Rank** every finding with the severity tiers below.
6. **Write the report** exactly per [references/report-template.md](references/report-template.md).

## Severity tiers

| Tier | Meaning | Typical findings |
|---|---|---|
| **P0** | Breaks a boundary, correctness or security — fix before the next PR | deep import bypassing a package's public entry point; dep imported but not declared; known high/critical vulnerability in a runtime dep; `workspace:*` or a cross-package relative dependency in a `package.json` |
| **P1** | Real cost or real risk — fix this sprint | version drift of a library that crosses a package boundary (e.g. `zod` used by shared contracts); unused runtime dependency; runtime dep that should be dev (or reverse); heavy runtime dep with a lighter or already-present alternative; vendored-copy drift |
| **P2** | Hygiene — schedule it | drift in dev tooling (`typescript`, `vitest`); unused dev dep; outdated minor versions; duplicate dev tooling that could be aligned |
| **Info** | Worth knowing, no action needed | large but justified deps (`next`, `playwright`); deliberate per-package duplication caused by the not-a-monorepo design |

Tie-breakers inside a tier: runtime before dev, shared-contract libraries before leaf
libraries, bigger installed size first.

## Output contract (summary)

Five sections, in this order, with these names — full detail in the template:

1. **Scope** — packages analyzed, package manager, what was measured and what was skipped.
2. **Dependency Graph** — one ```` ```mermaid ```` `flowchart`; internal edges dashed and
   labelled with the alias, P0 edges highlighted.
3. **Size Breakdown** — a per-package totals table, then a per-dependency table
   (dep, version, type, category, installed size, used?, notes), heaviest first.
4. **Findings & Priorities** — grouped under `P0`, `P1`, `P2`, `Info`; each finding has
   Where / Evidence / Impact / Recommendation / Effort.
5. **Summary** — 3–5 numbered, concrete takeaways ordered by priority.

## Anti-patterns

- Treating `@devdigest/shared` or `@devdigest/reviewer-core` as npm packages.
- A size statement without a table ("next is pretty big").
- An unranked bullet list of findings.
- Reporting a dev tool as "unused" because nothing imports it — `vitest`, `tsx`,
  `typescript`, `eslint` are used via `scripts` and config files.
- Calling `next` or `playwright` a problem just for being large.
- Presenting a removal as already done.
- Version drift that appears only as a note in the size table — every drift is its own
  finding with a tier.
- Speculating about "if we ever move to a monorepo / workspaces" — it is not the design;
  recommend within the standalone-package layout.
- A finding about package-to-package wiring that does not say `internal (tsconfig alias)` or
  `internal (relative import)`.
- Findings invented to fill a tier. A clean repo gets `_None._` under P0/P1 — that is a
  valid, complete answer.
