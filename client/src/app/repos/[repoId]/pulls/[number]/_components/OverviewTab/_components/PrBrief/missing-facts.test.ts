import { describe, it, expect } from "vitest";
import { BRIEF_FACT_PAIRS, BlastDegradedReason } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/brief.json";
import { missingFactKey } from "./missing-facts";

/** Client half of the pin to the contract: every pair the server may store has
    copy, and no copy is orphaned. */

const facts = messages.missingFacts as Record<string, unknown>;

function resolve(key: string): unknown {
  // key is `missingFacts.<name>` — one level deep
  return facts[key.replace(/^missingFacts\./, "")];
}

describe("missing-facts copy", () => {
  it("has non-empty copy for every contract pair, and none for pairs the contract lacks", () => {
    for (const [fact, status] of BRIEF_FACT_PAIRS) {
      const copy = resolve(missingFactKey(fact, status));
      expect(typeof copy, `${fact}/${status}`).toBe("string");
      expect((copy as string).length).toBeGreaterThan(0);
    }
    const expected = new Set(
      BRIEF_FACT_PAIRS.map(([fact, status]) => missingFactKey(fact, status).replace("missingFacts.", "")),
    );
    const orphans = Object.keys(facts).filter(
      (k) => k !== "title" && k !== "blastReason" && !expected.has(k),
    );
    expect(orphans).toEqual([]);
  });

  it("has a blast reason line for every degraded reason", () => {
    const reasons = facts.blastReason as Record<string, string>;
    for (const reason of BlastDegradedReason.options) {
      expect(reasons[reason], reason).toBeTruthy();
    }
  });
});
