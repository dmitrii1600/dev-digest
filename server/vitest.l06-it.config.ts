import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// L06 integration lane: the eval and eval-seed *.it.test.ts files only (needs Docker).
// `include` is replaced, not merged — mergeConfig would concatenate it with the base globs.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/evals*.it.test.ts', 'test/seed-eval.it.test.ts'],
  },
});
