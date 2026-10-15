import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// L06 lane: only the eval-related test areas. `*` stands in for the [id]/[repoId]/[number]
// route segments, because brackets are glob character classes. A new test file under
// these areas is picked up without editing this list.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "src/app/eval/**/*.test.{ts,tsx}",
      "src/components/eval-cases/**/*.test.{ts,tsx}",
      "src/components/eval-metrics/**/*.test.{ts,tsx}",
      "src/app/agents/*/_components/AgentEditor/_components/EvalsTab/**/*.test.{ts,tsx}",
      "src/app/skills/*/_components/SkillEditor/_components/EvalsTab/**/*.test.{ts,tsx}",
      "src/components/finding-card/**/*.test.{ts,tsx}",
      "src/components/findings-panel/**/*.test.{ts,tsx}",
      "src/lib/hooks/evals.test.tsx",
      "src/test/eval-contract-sync.test.ts",
    ],
  },
});
