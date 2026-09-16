// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint for @devdigest/e2e.
 *
 * Scoped to what `typecheck` cannot see — unused code and unsafe escapes.
 * Type-aware rules are off: they would cost a second typecheck for a second
 * opinion on the same files.
 *
 * This is not a monorepo, so each package owns its own config and install
 * (see ../CLAUDE.md). This one installs with **npm**, matching its lockfile.
 */
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'test-results/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
