/**
 * Architecture check for @devdigest/api — `pnpm arch`.
 *
 * The other half of the onion rules. `eslint.config.mjs` owns what a per-file
 * import zone can express; this file owns what it cannot: import cycles, the
 * `src/vendor/**` tree (which ESLint ignores), and edges between sibling
 * folders that only make sense as a graph.
 *
 * The rings, the rationale and the grandfathered list live in
 * `.claude/skills/onion-architecture/` — read `rules.md` before changing a rule
 * here, and `enforcement.md` before adding an exception.
 *
 * dependency-cruiser is already a runtime dependency of this package (it backs
 * `adapters/depgraph`), so this check costs no new install.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'A cycle means two files cannot be understood, tested or replaced separately. ' +
        'Break it by moving the shared thing inward (a port, a contract, a constant).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // ---- Ring 3: adapters ------------------------------------------------
    {
      name: 'adapter-not-to-db',
      comment:
        'Rule 10 — an adapter that also persists is doing two jobs. Return data and let ' +
        'ring 2 decide what to store. Grandfathered: adapters/auth/local.ts.',
      severity: 'error',
      from: { path: '^src/adapters/', pathNot: '^src/adapters/auth/local\\.ts$' },
      to: { path: '^src/db/' },
    },
    {
      name: 'adapter-not-to-feature',
      comment:
        'Rule 10 — infrastructure must not know features. Move the shared constant to the ' +
        'adapter, or inward next to the port. Grandfathered: astgrep, depgraph.',
      severity: 'error',
      from: {
        path: '^src/adapters/',
        pathNot: '^src/adapters/(astgrep|depgraph)/index\\.ts$',
      },
      to: { path: '^src/modules/' },
    },
    {
      name: 'adapter-not-to-container',
      comment:
        'Rule 9 — an adapter receives what it needs; it does not resolve dependencies. ' +
        'The container wires, it is not a registry to query.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/platform/container\\.ts$' },
    },

    // ---- Kernel ----------------------------------------------------------
    {
      name: 'platform-not-to-feature',
      comment:
        'Rule 10 — only platform/container.ts (the composition root) may name a feature. ' +
        'Anything else in platform/ depending on modules/ inverts the onion.',
      severity: 'error',
      from: { path: '^src/platform/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^src/modules/' },
    },

    // ---- Module boundaries ------------------------------------------------
    {
      name: 'no-cross-module-reach-in',
      comment:
        'Rule 10 — a slice stays independent. Shared entities are resolved from the ' +
        'composition root (container.agentsRepo, container.reviewRepo, container.repoIntel), ' +
        'not by importing another module folder. modules/_shared/** is the exception.\n' +
        'Grandfathered: repo-intel/constants.ts — repos/service.ts reads INDEX_JOB_KIND and ' +
        'REFRESH_JOB_KIND from it to enqueue an index job. The job kinds are cross-cutting; ' +
        'the fix is to move them to modules/_shared/, not to widen this rule further.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: '^src/modules/($1|_shared)/|^src/modules/repo-intel/constants\\.ts$',
      },
    },

    // ---- Rings 0-1: the vendored contracts tree ---------------------------
    // ESLint ignores src/vendor/**, so these two rules are the only thing
    // keeping the innermost rings clean.
    {
      name: 'contract-stays-pure',
      comment:
        'Ring 0 — a contract describes data and depends on nothing in the server. If a ' +
        'contract needs a type from a module, the type is in the wrong place.',
      severity: 'error',
      from: { path: '^src/vendor/shared/contracts/' },
      to: { path: '^src/(?!vendor/shared/)' },
    },
    {
      name: 'port-stays-pure',
      comment:
        'Ring 1 — a port is declared in terms of contracts only. A port that imports an ' +
        'adapter, the db or a module has inverted the dependency it exists to invert.',
      severity: 'error',
      from: { path: '^src/vendor/shared/adapters\\.ts$' },
      to: { path: '^src/(?!vendor/shared/)' },
    },

    // ---- Hygiene ---------------------------------------------------------
    {
      name: 'not-to-dev-dep',
      comment:
        'Shipped code must not import a devDependency — it is absent in production.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(db/(migrate|seed|seed-prompts)\\.ts)$' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|src/db/migrations)/' },
    // Cross-package code is wired through tsconfig `paths`, never published
    // modules (see ../AGENTS.md) — without this the aliases are unresolvable.
    tsConfig: { fileName: 'tsconfig.json' },
    // `import type` is erased at compile time, so it is not a runtime edge.
    // Keep it false: a type-only import of `Container` is how ring 2 states the
    // shape it needs without depending on the composition root at runtime.
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
