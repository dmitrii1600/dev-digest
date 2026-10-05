import type { AgentCase } from "../../src/index.js";
import { cases as strictCases } from "../architecture-reviewer/architecture-reviewer.cases.js";

/**
 * The lite variant is the SAME agent with one hard rule removed: "name the exact documented rule
 * identifier per finding". So it is graded on the strict variant's exact tasks (same prompts, same
 * fixtures) MINUS the citation practices — which lite is designed not to satisfy. Asserting them
 * would contradict the artifact under test (Haiku fails them too, by design), not measure a defect.
 *
 * Everything else stays: both variants must still FIND the violations, quote them verbatim, assign
 * severity, and end with a gate verdict. What moves between the two runs is only the citation, which
 * is exactly the A/B this pair exists to expose — run `pnpm eval:delta` on the two labeled repeats.
 */
const CITATION_PRACTICE = /names the (?:specific|exact) documented rule identifier/i;

// Case names stay identical to the strict variant so `pnpm eval:delta strict lite` pairs them;
// the citation practices simply show up on the strict side only (`X% -> —%`).
export const cases: AgentCase[] = strictCases.map((c) => ({
  ...c,
  practices: c.practices?.filter((p) => !CITATION_PRACTICE.test(p)),
}));
