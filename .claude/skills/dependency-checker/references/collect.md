# Collecting the data

Run everything from the repo root. All commands are read-only. On Windows use Git Bash
(`du`, `grep`, `sed` are available there).

## 1. Declared dependencies

Read each `<pkg>/package.json` — `dependencies`, `devDependencies`, `peerDependencies`,
`scripts`. Record `name@range` and the type. Resolved versions come from the lockfile or
the installed package:

```sh
node -p "require('./server/node_modules/zod/package.json').version"
```

## 2. Installed sizes

```sh
du -sh server/node_modules                      # package total
du -sh server/node_modules/fastify              # one direct dependency
du -sh server/node_modules/@tanstack/react-query  # scoped: keep the scope
```

For all direct deps of a package at once:

```sh
cd server && node -e "const p=require('./package.json');for(const d of Object.keys({...p.dependencies,...p.devDependencies}))console.log(d)" \
  | while read d; do du -sh "node_modules/$d" 2>/dev/null; done | sort -rh
```

Notes:

- This is **installed size on disk** (includes the package's own nested files), not bundle
  size. Say so in the table header. With pnpm, `node_modules/<dep>` is a symlink into
  `.pnpm/` — use `du -shL` to follow it.
- No `node_modules` → the package is not installed; write `n/m` and note it in Scope.

## 3. Usage — is it actually used?

Imported in source:

```sh
grep -rlE "from ['\"]<dep>(/[^'\"]*)?['\"]|require\(['\"]<dep>" <pkg>/src <pkg>/test 2>/dev/null
```

Used without an import — check before calling anything unused:

- `scripts` in `package.json` (`vitest`, `tsx`, `tsc`, `eslint`, `drizzle-kit`, `next`)
- config files: `vitest.config.ts`, `eslint.config.*`, `next.config.*`, `postcss.config.*`,
  `tailwind.config.*`, `drizzle.config.ts`
- `@types/*` — used if the matching package is used

A dep with no import, no script and no config mention is **unused**.

## 4. Internal dependencies

```sh
grep -n -A8 '"paths"' */tsconfig.json
grep -rnE "from ['\"](\.\./)+(server|client|reviewer-core|mcp|e2e)/" --include=*.ts --include=*.tsx .
grep -rnE "from ['\"]@devdigest/[a-z-]+/" --include=*.ts --include=*.tsx server client mcp
```

The second and third greps find **deep imports** — anything past a package's entry point.
Exclude `node_modules`, `.next`, `clones/`.

Vendored-copy drift (shared contracts live in two places):

```sh
diff -rq server/src/vendor/shared client/src/vendor/shared
```

## 5. Cross-package drift

Collect `dep → {package: version}` for every dep that appears in two or more packages.
Two or more distinct versions = drift. Rank by whether the library crosses a package
boundary (contracts, types) — `zod` drift matters more than `prettier` drift.

## 6. Optional, network-bound (skip with `--offline`)

| Check | pnpm (`server`, `client`, `evals`) | npm (`reviewer-core`, `e2e`, `mcp`) |
|---|---|---|
| Vulnerabilities | `pnpm audit --prod --json` | `npm audit --omit=dev --json` |
| Outdated | `pnpm outdated --format json` | `npm outdated --json` |
| Why is X installed | `pnpm why <dep>` | `npm ls <dep>` |

Run each in its own package folder with its own package manager. If a check is skipped or
fails, list it in Scope under "Not measured".
