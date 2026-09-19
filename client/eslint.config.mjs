// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint for @devdigest/web.
 *
 * `typecheck` already covers types, so lint earns its keep on the one class of
 * bug TypeScript cannot see here: hook misuse. `rules-of-hooks` and
 * `exhaustive-deps` are the reason this config exists at all.
 *
 * This is not a monorepo, so each package owns its own config and install
 * (see ../AGENTS.md).
 */
export default tseslint.config(
  {
    // Build output and vendored trees. `src/vendor/**` mirrors the server's
    // canonical contracts and the design system — do-not-touch, so linting it
    // would only produce findings nobody is allowed to fix.
    ignores: ['node_modules/**', '.next/**', 'next-env.d.ts', 'src/vendor/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` is a smell we want visible, but this is not a typing project —
      // surface it, do not block the build on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // A missing dep is a real staleness bug, but several existing effects
      // suppress it deliberately (see ReviewRunAccordion). Warn, so new ones
      // are noticed without the old ones failing CI.
      'react-hooks/exhaustive-deps': 'warn',
      // Fires on the theme/localStorage hydration pattern used across the app:
      // read the real value on the client, then set it. Rewriting those to
      // avoid the extra pass is a separate, hydration-sensitive change — keep
      // the rule visible rather than silencing or half-fixing it.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Node-side config files (next.config.mjs, vitest.config.ts) run outside the
    // browser, so the base config's browser assumption flags `process`.
    files: ['*.mjs', '*.ts', '*.config.*'],
    ignores: ['src/**'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly', console: 'readonly' },
    },
  },
  {
    // TypeScript resolves identifiers itself; `no-undef` in a .ts file only
    // ever produces false positives on types and ambient globals.
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-undef': 'off' },
  },
  {
    // ---- Layer boundary: shared may not import routes ---------------------
    // `src/components` and `src/lib` are the shared layer; `src/app` is the
    // route layer above them. Imports flow downward only, so shared code that
    // reaches back into a route is what turns a structured app into a cycle —
    // and it is invisible in review, because each such import looks reasonable
    // on its own. The rings and the reasoning live in
    // `.claude/skills/frontend-ui-architecture/` (SKILL.md → boundaries.md).
    //
    // Core `no-restricted-imports` rather than `import/no-restricted-paths`:
    // this package does not carry eslint-plugin-import, and the server already
    // expresses its onion zones the same way.
    files: ['src/components/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '@/app', '**/app/*'],
              message:
                'Shared code cannot import a route. Move what both need down into src/components or src/lib, or compose them in the route — see .claude/skills/frontend-ui-architecture/references/boundaries.md.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests reach for casts and partial fixtures on purpose.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
