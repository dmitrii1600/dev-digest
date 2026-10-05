/* missing-facts — maps a stored `{ fact, status }` pair to its `brief.json`
   copy key. The 16 allowed pairs are owned by `BRIEF_FACT_PAIRS` in the shared
   contract; `missing-facts.test.ts` pins the copy to them. */
import type { BriefMissingFact } from "@devdigest/shared";

export function missingFactKey(fact: BriefMissingFact["fact"], status: string): string {
  return `missingFacts.${fact}_${status}`;
}
