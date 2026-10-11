import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// Diffs carry no comments about what is wrong — the skill has to name the problem itself.
//
// cross-module-reach-in.diff seeds two independent violations:
//   - reviews/service.ts imports ../brief/repository.js and ../brief/helpers.js
//     → onion rule 10, the "a module may not import another module's folder" clause
//   - reviews/routes.ts runs db.select() itself
//     → onion rule 2 (drizzle only in ring 3) — the CONTROL expectation
// The rule-10 practice is the one that should drop when that clause is removed from SKILL.md;
// the rule-2 practice must hold either way, which is what proves the drop is specific.
//
// allowed-shared-import.diff is the negative: a module importing a type from @devdigest/shared
// and its OWN constants is legal and must not be flagged as a cross-module reach-in.
const REVIEW = (file: string) =>
  `Review this server diff against the backend architecture rules and list every rule it breaks.\n\n${fx(file)}`;

export const cases: SkillCase[] = [
  {
    name: "flags the cross-module reach-in and points to the container",
    kind: "quality",
    prompt: REVIEW("cross-module-reach-in.diff"),
    practices: [
      "flags server/src/modules/reviews/service.ts importing ../brief/repository.js (and ../brief/helpers.js) as a violation — one module reaching into another module's folder",
      "says the cross-module access must go through the container (container.* / an injected port) instead of a direct import of the other module",
      "names the rule for the cross-module finding as onion-architecture rule 10, or quotes its 'a module may not import another module's folder' wording",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
  {
    name: "control: flags the query in the route regardless of rule 10",
    kind: "quality",
    prompt: REVIEW("cross-module-reach-in.diff"),
    practices: [
      "flags the `db.select().from(reviews)` call added to server/src/modules/reviews/routes.ts as a violation — drizzle / db access only in ring 3 (a repository), not in a route",
      "says the query belongs in modules/reviews/repository.ts and the route should call the service",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
  {
    name: "negative: a shared-contract import and own constants are not a reach-in",
    kind: "quality",
    prompt: REVIEW("allowed-shared-import.diff"),
    practices: [
      "does not flag the `import type { BriefSummary } from \"@devdigest/shared\"` as a cross-module violation — shared contracts are ring 0 and importable from every ring",
      "does not flag importing ./constants.js from the same module as a violation",
      "reports that the diff breaks no rule (or only non-blocking suggestions)",
    ],
    threshold: 1.0,
    maxTurns: 10,
  },
];
