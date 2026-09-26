import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Single-sourced contracts live in the server's vendored shared (this
      // package borrows them, same as reviewer-core; see tsconfig paths).
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared/index.ts'),
      // The shared contracts import 'zod' bare. Resolve it from mcp's own
      // node_modules so CI does not need a server install at all.
      zod: path.resolve(__dirname, 'node_modules/zod'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
