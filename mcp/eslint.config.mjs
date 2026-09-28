// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint for @devdigest/mcp.
 *
 * Scoped to what `typecheck` cannot see — unused code, unsafe escapes, and the
 * two process-isolation rules that keep this package a pure HTTP client:
 * stdout is the MCP protocol channel (no console.log), and no import ever
 * reaches into server/reviewer-core source or their runtime deps.
 *
 * This is not a monorepo, so each package owns its own config and install
 * (see ../AGENTS.md). This one installs with **npm**, matching its lockfile.
 */
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**'] },
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
      // stdout is the JSON-RPC channel: only StdioServerTransport may write to
      // it. Every log line goes through src/log.ts to process.stderr.
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Relative-only (`../server/**`, `../../server/**`, same for
              // reviewer-core): a bare `**/server/**` glob would also catch
              // `@modelcontextprotocol/sdk/server/mcp.js`, an unrelated SDK
              // subpath this package legitimately imports.
              group: [
                '../server/*',
                '../server/**',
                '../../server/*',
                '../../server/**',
                '../reviewer-core/*',
                '../reviewer-core/**',
                '../../reviewer-core/*',
                '../../reviewer-core/**',
              ],
              message: 'mcp is an HTTP adapter; import contracts via @devdigest/shared only',
            },
          ],
          paths: [
            { name: 'pino', message: 'mcp never imports the server logger.' },
            { name: 'drizzle-orm', message: 'mcp never talks to Postgres directly.' },
            { name: 'fastify', message: 'mcp is an HTTP client, not a Fastify app.' },
            { name: 'postgres', message: 'mcp never talks to Postgres directly.' },
          ],
        },
      ],
    },
  },
);
