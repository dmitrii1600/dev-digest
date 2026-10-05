import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The skill normally gathers this itself (Read/Bash/Grep), but "quality" cases run with no tools
// (skillTask measures the SKILL.md content in isolation — see tasks.ts). So each prompt hands over
// a raw snapshot of what the collection step would have produced.
//
// The fixtures are RAW command output — package.json, tsconfig paths, `du`, an `rg` import list —
// with no commentary. Nothing says which dependency is unused, which versions drift or which import
// is wrong; the model has to derive that from the data. Seeded problems in repo-snapshot.md:
//   1. moment declared in server/package.json, imported nowhere          → unused runtime dep
//   2. zod 3.23.8 in server + reviewer-core, 3.22.4 in client           → version drift
//   3. server/src/services/review-service.ts → ../../../reviewer-core/src/pipeline.js
//                                                                        → deep import past the entry point
//   4. server/src/services/date.ts imports date-fns, server does not declare it
//                                                                        → undeclared dependency
// clean-snapshot.md has none of them — the negative case.
const HANDOFF =
  "Here is the raw data the collection step produced — treat it as already collected and build the report from it directly (do not ask for tool access or more data).";

const REPO = `${HANDOFF}\n\n${fx("repo-snapshot.md")}`;
const CLEAN = `${HANDOFF}\n\n${fx("clean-snapshot.md")}`;

export const cases: SkillCase[] = [
  {
    name: "full report follows the required 5-section structure with a Mermaid graph",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO}`,
    grounding: ["```mermaid", "flowchart"],
    practices: [
      "the report has a section named 'Scope' listing which packages (client, server, reviewer-core, e2e) were analyzed",
      "the report includes a Mermaid diagram (a fenced ```mermaid code block using flowchart) showing dependency relationships between packages",
      "the report has a section with a size breakdown table showing dependencies and their installed size, not just a vague size statement",
      "the report has a 'Findings & Priorities' section that groups findings under explicit severity tiers P0, P1, P2 and Info — not an unranked bullet list",
      "the report ends with a Summary section giving 3-5 concrete, actionable takeaways ordered by priority",
    ],
    threshold: 0.8,
    maxTurns: 10,
  },
  {
    name: "derives the seeded problems from raw data, with internal and external kept apart",
    kind: "quality",
    prompt: `This repo isn't a monorepo — packages share code through TypeScript path aliases. Analyze our dependencies, including how the packages depend on each other internally, and tell me what to fix first.\n\n${REPO}`,
    practices: [
      "flags server/src/services/review-service.ts importing reviewer-core/src/pipeline.js by relative path (instead of reviewer-core's public entry point) as a P0 finding",
      "flags that server/src/services/date.ts imports date-fns while server/package.json does not declare it, as an undeclared dependency",
      "calls out moment as declared in server/package.json but never imported, i.e. an unused runtime dependency",
      "calls out zod being declared at 3.22.4 in client but 3.23.8 in server and reviewer-core as version drift, as its own finding rather than only a note in a table",
      "labels the @shared alias and the reviewer-core relative import as internal dependencies, distinct from external npm packages",
      "does not describe the packages as linked via workspace:* or pnpm/npm workspaces, and does not propose migrating to a monorepo",
    ],
    threshold: 0.8,
    maxTurns: 10,
  },
  {
    name: "negative: a clean snapshot gets no fabricated findings",
    kind: "quality",
    prompt: `Check our dependencies and tell me what to prioritize fixing.\n\n${CLEAN}`,
    practices: [
      "reports no P0 and no P1 findings — the P0 and P1 tiers are empty or explicitly marked as none",
      "does not claim any declared dependency is unused (fastify, zod, vitest, typescript and tsx are all imported or used via scripts)",
      "does not report version drift for zod, which is 3.23.8 in both packages",
      "does not flag the @devdigest/reviewer-core alias import in server/src/services/review-service.ts as a boundary violation — it goes through the public entry point",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
];
