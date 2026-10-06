import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room. A full
    // dependency-checker report alone took ~145 s on Haiku, plus the judge: 240 s timed out.
    testTimeout: 480_000,
    hookTimeout: 480_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
