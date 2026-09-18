// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint for @devdigest/api.
 *
 * Scoped deliberately: `typecheck` already carries the weight of correctness
 * here, so lint covers what the compiler cannot see — unused code, unsafe
 * escapes, and accidental `any`. Type-aware rules are NOT enabled; they would
 * slow the run to a typecheck's cost for a second opinion on the same files.
 *
 * This is not a monorepo, so each package owns its own config and its own
 * install (see ../CLAUDE.md).
 */
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
    // …the exceptions being the two CLI entrypoints, which have no logger and
    // whose whole job is to talk to the operator's terminal.
    files: ['src/db/migrate.ts', 'src/db/seed.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests reach for casts and partial fixtures on purpose.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
