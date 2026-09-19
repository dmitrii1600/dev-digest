// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint for @devdigest/api.
 *
 * Scoped deliberately: `typecheck` already carries the weight of correctness
 * here, so lint covers what the compiler cannot see — unused code, unsafe
 * escapes, accidental `any`, and (below) the direction of imports between
 * architectural rings.
 *
 * This is not a monorepo, so each package owns its own config and its own
 * install (see ../AGENTS.md).
 */

// ---------------------------------------------------------------------------
// Onion rings — import zones
//
// The rings, the rationale and the exceptions live in
// `.claude/skills/onion-architecture/` (SKILL.md → layers.md → rules.md →
// enforcement.md). This file is only the half of it a linter can see:
// per-file zones over import specifiers. Cycles, the ignored `src/vendor/**`
// tree and cross-module reach-ins are checked by `pnpm arch`
// (.dependency-cruiser.cjs) instead.
//
// Ring 2 = modules/<name>/{service,helpers,constants}.ts + the review use case
//          + platform/{model-router,run-logger,trace-builder,price-book}.ts
// Ring 3 = adapters/**, db/**, modules/*/repository*.ts, repo-intel/pipeline/**
// Ring 4 = modules/*/routes.ts, modules/index.ts, app.ts, server.ts,
//          platform/container.ts, modules/_shared/context.ts
// ---------------------------------------------------------------------------

const SKILL = 'see .claude/skills/onion-architecture/rules.md';

/** Writing a query, or importing the schema/client that makes one possible. */
const query = {
  group: [
    'drizzle-orm',
    'drizzle-orm/*',
    '**/db/schema*',
    '**/db/client*',
    '**/db/seed*',
  ],
  message: `Rule 2 — persistence is ring 3. Move the query into modules/<name>/repository.ts and inject it (${SKILL}).`,
};

/** Drizzle row types leaking outward as domain types. */
const rowTypes = {
  group: ['**/db/rows*'],
  message: `Rule 5 — a $inferSelect row is a table shape, not a domain type. Map row → contract in helpers.ts (${SKILL}).`,
};

const fastify = {
  group: ['fastify', 'fastify-*', '@fastify/*'],
  message: `Rule 1 — HTTP is ring 4. A use case takes plain arguments, not FastifyRequest (${SKILL}).`,
};

const sdk = {
  group: [
    'openai',
    'openai/*',
    '@anthropic-ai/*',
    'octokit',
    'simple-git',
    '@ast-grep/*',
    'graphology',
    'graphology-*',
    'js-tiktoken',
    'js-tiktoken/*',
    'postgres',
    'dependency-cruiser',
    '@vscode/ripgrep',
  ],
  message: `Rule 3 — a vendor SDK belongs in adapters/<concern>/<tech>.ts behind an interface, resolved from the Container (${SKILL}).`,
};

const nodeIo = {
  group: ['node:fs', 'node:fs/*', 'fs', 'fs/*', 'node:child_process', 'child_process'],
  message: `Rule 4 — the filesystem is ring 3. Put it behind an adapter (${SKILL}).`,
};

/** Ring 2 must not reach into ring 3 implementations. */
const adapters = {
  group: ['**/adapters/**'],
  message: `Rule 8 — depend on the port (vendor/shared/adapters.ts), not the adapter; resolve it from the Container (${SKILL}).`,
};

const zodRuntime = {
  group: ['zod'],
  message: `Rule 7 — validate once, at the boundary. A use case takes a parsed z.infer type; it does not re-parse (${SKILL}).`,
};

const dbFromAdapter = {
  group: ['**/db/**'],
  message: `Rule 10 — an adapter that also persists is doing two jobs. Return data and let ring 2 decide (${SKILL}).`,
};

const featureModules = {
  group: ['**/modules/**'],
  message: `Rule 10 — infrastructure and the kernel must not know features. Only platform/container.ts (the composition root) may import modules/** (${SKILL}).`,
};

const container = {
  group: ['**/platform/container*'],
  message: `Rule 9 — take the ports you need as constructor arguments; the Container wires them at the edge (${SKILL}).`,
};

/** `no-restricted-imports` over a list of pattern groups. */
const zone = (...patterns) => ({
  'no-restricted-imports': /** @type {const} */ (['error', { patterns }]),
});

const RING_2 = [
  'src/modules/*/service.ts',
  'src/modules/*/helpers.ts',
  'src/modules/*/constants.ts',
  'src/modules/reviews/run-executor.ts',
  'src/modules/reviews/findings.ts',
  'src/modules/reviews/diff-loader.ts',
  'src/modules/_shared/severity.ts',
  'src/platform/model-router.ts',
  'src/platform/run-logger.ts',
  'src/platform/trace-builder.ts',
  'src/platform/price-book.ts',
];

export default tseslint.config(
  {
    // Vendored and generated trees are do-not-touch — linting them would only
    // produce findings nobody is allowed to fix.
    ignores: [
      'node_modules/**',
      'dist/**',
      'src/vendor/**',
      'src/db/migrations/**',
      'clones/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // An unused parameter is often deliberate (a handler signature, a
      // discarded capture). Underscore is the opt-out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` is a smell we want visible, but the codebase predates the rule
      // and this change is not a typing project — surface it, do not block on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // The server logs through pino (`app.log`), never console — so a console
      // call is either a leftover debug line or a deliberate, marked exception.
      'no-console': 'warn',
    },
  },
  {
    // The arch config is CommonJS (this package is ESM, so it needs the `.cjs`
    // extension to be `require`-able by depcruise).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    // …the exceptions being the two CLI entrypoints, which have no logger and
    // whose whole job is to talk to the operator's terminal.
    files: ['src/db/migrate.ts', 'src/db/seed.ts'],
    rules: { 'no-console': 'off' },
  },

  // ---- Ring 2: application ------------------------------------------------
  // The use cases. No HTTP, no SQL, no SDK, no disk — only ports, contracts
  // and the repository the composition root handed them.
  {
    files: RING_2,
    rules: zone(query, rowTypes, fastify, sdk, nodeIo, adapters, zodRuntime),
  },

  // ---- Ring 4: transport --------------------------------------------------
  // A route may use Fastify and may call any inner ring, but it is not where a
  // query or an SDK call belongs. Everything below the HTTP shape goes to a
  // service; everything outside the process goes to an adapter.
  {
    files: ['src/modules/*/routes.ts'],
    rules: zone(query, rowTypes, sdk, nodeIo),
  },

  // ---- Ring 3: adapters ---------------------------------------------------
  // Infrastructure implements a port and returns data. It does not persist, it
  // does not know features, and it never reaches for the container.
  {
    files: ['src/adapters/**/*.ts'],
    rules: zone(dbFromAdapter, featureModules, container),
  },

  // ---- Kernel: platform, minus the composition root -----------------------
  // `platform/container.ts` is the one file allowed to name every concrete
  // class — that is what a composition root is. Nothing else in platform/ may
  // depend on a feature.
  {
    files: ['src/platform/*.ts'],
    ignores: ['src/platform/container.ts'],
    rules: zone(featureModules),
  },

  // ---- Grandfathered ------------------------------------------------------
  // Pre-existing violations, frozen so the rules can be `error` for new code.
  // Each entry keeps every rule it does NOT currently break, so these files
  // cannot drift further. The intended fix for each is in
  // `.claude/skills/onion-architecture/enforcement.md`. Shrink this list; never
  // add to it.
  {
    // Imports `db/rows.js` — `AgentRow` is in the public signature of
    // `resolveTargets`/`runReview`.
    files: ['src/modules/reviews/service.ts'],
    rules: zone(query, fastify, sdk, nodeIo, adapters, zodRuntime),
  },
  {
    // Imports `db/schema.js` + `db/rows.js` — takes `typeof schema.repos.$inferSelect`.
    files: ['src/modules/reviews/run-executor.ts'],
    rules: zone(fastify, sdk, nodeIo, adapters, zodRuntime),
  },
  {
    // Imports `db/schema.js` and the `adapters/git/diff-parser` helper directly.
    files: ['src/modules/reviews/diff-loader.ts'],
    rules: zone(fastify, sdk, nodeIo, zodRuntime),
  },
  {
    // `toRepoDto` maps a row, so it imports `db/schema.js` for the row type.
    files: ['src/modules/repos/helpers.ts'],
    rules: zone(fastify, sdk, nodeIo, adapters, zodRuntime),
  },
  {
    // The repo-intel facade drives astgrep/extract and reads files itself
    // instead of delegating to its own ring-3 pipeline.
    files: ['src/modules/repo-intel/service.ts'],
    rules: zone(query, rowTypes, fastify, sdk, zodRuntime),
  },
  {
    // Four modules never got a service; their route files hold the queries.
    files: [
      'src/modules/pulls/routes.ts',
      'src/modules/polling/routes.ts',
      'src/modules/settings/routes.ts',
      'src/modules/workspace/routes.ts',
    ],
    rules: zone(rowTypes, sdk, nodeIo),
  },
  {
    // Both import `SUPPORTED_EXT` / `MAX_SIGNATURE_CHARS` from
    // `modules/repo-intel/constants.js`.
    files: ['src/adapters/astgrep/index.ts', 'src/adapters/depgraph/index.ts'],
    rules: zone(dbFromAdapter, container),
  },
  {
    // The auth adapter reads workspaces/users straight from Postgres.
    files: ['src/adapters/auth/local.ts'],
    rules: zone(featureModules, container),
  },

  {
    // Tests reach for casts, partial fixtures and concrete classes on purpose.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
