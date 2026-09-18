/**
 * `sortBySeverity` is shared by the PR list and the run timeline so the two
 * previews cannot order findings differently. It must also leave the caller's
 * array alone — both callers pass an array that belongs to a cached query.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { sortBySeverity } from "./useFindingsPreview";

function f(id: string, severity: FindingRecord["severity"]): FindingRecord {
  return { id, severity } as FindingRecord;
}

describe("sortBySeverity", () => {
  it("puts the most severe first", () => {
    const out = sortBySeverity([f("s", "SUGGESTION"), f("c", "CRITICAL"), f("w", "WARNING")]);
    expect(out.map((x) => x.id)).toEqual(["c", "w", "s"]);
  });

  it("does not mutate the input — it may be a cached query's array", () => {
    const input = [f("s", "SUGGESTION"), f("c", "CRITICAL")];
    sortBySeverity(input);
    expect(input.map((x) => x.id)).toEqual(["s", "c"]);
  });

  it("keeps an unknown severity last rather than dropping it", () => {
    const out = sortBySeverity([f("x", "NOPE" as FindingRecord["severity"]), f("c", "CRITICAL")]);
    expect(out.map((x) => x.id)).toEqual(["c", "x"]);
  });

  it("is stable within one severity, so equal findings keep review order", () => {
    const out = sortBySeverity([f("a", "WARNING"), f("b", "WARNING"), f("c", "WARNING")]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
