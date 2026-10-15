import { describe, it, expect } from "vitest";
import type { FindingRecord, MultiReviewAgent, MultiReviewDetail, RunSummary } from "@devdigest/shared";
import { disagreementRows, groupFindings, totalCost, wallTimeMs } from "./helpers";

let n = 0;
function finding(
  file: string,
  start: number,
  end = start,
  severity: FindingRecord["severity"] = "WARNING",
): FindingRecord {
  n += 1;
  return {
    id: `f${n}`, severity, category: "bug", title: `t-${file}-${start}-${severity}`, file,
    start_line: start, end_line: end, rationale: "r", suggestion: null, confidence: 0.9,
    kind: "finding", trifecta_components: null, evidence: null, review_id: "r1",
    accepted_at: null, dismissed_at: null,
  } as FindingRecord;
}
function agent(findings: FindingRecord[], run: Partial<RunSummary> = {}): MultiReviewAgent {
  return {
    run: {
      run_id: `run${n++}`, agent_id: "a", agent_name: "A", provider: null, model: null,
      status: "done", error: null, duration_ms: 1000, tokens_in: 1, tokens_out: 1, cost_usd: 0.01,
      findings_count: findings.length, findings_counts: null, grounding: null,
      ran_at: "2026-10-11T10:00:00.000Z", score: 80, blockers: 0, multi_run_id: "m", ...run,
    } as RunSummary,
    summary: null,
    findings,
  };
}
const sizes = (g: ReturnType<typeof groupFindings>) => g.map((x) => x.length);

describe("groupFindings", () => {
  it("links at the +-3 boundary and not one line past it", () => {
    expect(groupFindings([agent([finding("src/a.ts", 10)]), agent([finding("src/a.ts", 16)])])).toHaveLength(1);
    expect(groupFindings([agent([finding("src/a.ts", 10)]), agent([finding("src/a.ts", 17)])])).toHaveLength(2);
  });

  it("never groups case variants or different directories", () => {
    expect(groupFindings([agent([finding("src/A.ts", 10)]), agent([finding("src/a.ts", 10)])])).toHaveLength(2);
    expect(groupFindings([agent([finding("config.ts", 10)]), agent([finding("src/config.ts", 10)])])).toHaveLength(2);
  });

  it("keeps two findings of one agent apart when no other agent bridges them", () => {
    expect(sizes(groupFindings([agent([finding("a.ts", 10), finding("a.ts", 10)])]))).toEqual([1, 1]);
  });

  it("chains transitively and is order independent", () => {
    const a = agent([finding("a.ts", 10)]);
    const b = agent([finding("a.ts", 15)]);
    const c = agent([finding("a.ts", 20)]);
    const ids = (g: ReturnType<typeof groupFindings>) => g.map((grp) => grp.map((m) => m.finding.id));
    expect(sizes(groupFindings([a, b, c]))).toEqual([3]);
    // Same agents, input order changed: groups hold the same finding ids.
    const forward = ids(groupFindings([a, b, c]))[0]!.slice().sort();
    const reversed = ids(groupFindings([c, b, a]))[0]!.slice().sort();
    expect(reversed).toEqual(forward);
    // Findings shuffled inside an agent: identical output.
    const x = agent([finding("a.ts", 1), finding("b.ts", 50)]);
    const y = agent([...x.findings].reverse());
    expect(ids(groupFindings([x])).flat().sort()).toEqual(ids(groupFindings([{ ...x, findings: y.findings }])).flat().sort());
    expect(groupFindings([x]).map((g) => g[0]!.finding.file)).toEqual(
      groupFindings([{ ...x, findings: y.findings }]).map((g) => g[0]!.finding.file),
    );
  });
});

describe("disagreementRows", () => {
  it("is not a conflict when both completed agents agree", () => {
    const agents = [agent([finding("a.ts", 10)]), agent([finding("a.ts", 11)])];
    const rows = disagreementRows(agents, groupFindings(agents));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isConflict).toBe(false);
  });

  it("is a conflict when one flagged and one did not", () => {
    const agents = [agent([finding("a.ts", 10)]), agent([])];
    const [row] = disagreementRows(agents, groupFindings(agents));
    expect(row!.cells.map((c) => c.kind)).toEqual(["flagged", "didNotFlag"]);
    expect(row!.isConflict).toBe(true);
  });

  it("shows a failed agent as no result and does not count it", () => {
    const agents = [agent([finding("a.ts", 10)]), agent([], { status: "failed" })];
    const [row] = disagreementRows(agents, groupFindings(agents));
    expect(row!.cells[1]!.kind).toBe("noResult");
    expect(row!.isConflict).toBe(false);
  });

  it("takes the header from the most severe finding", () => {
    const crit = finding("a.ts", 12, 12, "CRITICAL");
    const agents = [agent([finding("a.ts", 10, 10, "SUGGESTION")]), agent([crit])];
    const [row] = disagreementRows(agents, groupFindings(agents));
    expect(row!.header).toEqual({ file: "a.ts", line: 12, title: crit.title });
    expect(row!.isConflict).toBe(true);
  });
});

describe("totalCost / wallTimeMs", () => {
  const detail = (agents: MultiReviewAgent[]): MultiReviewDetail => ({
    id: "m", pr: { id: "p", number: 1, title: "t" }, ran_at: "2026-10-11T10:00:00.000Z", agents,
  });

  it("is unknown when a completed run has no cost, and skips failed runs", () => {
    expect(totalCost(detail([agent([]), agent([], { cost_usd: null })]))).toBeNull();
    expect(totalCost(detail([agent([]), agent([], { status: "failed", cost_usd: null })]))).toBe(0.01);
  });

  it("is null while a run is running, else last end minus start", () => {
    expect(wallTimeMs(detail([agent([]), agent([], { status: "running", duration_ms: null })]))).toBeNull();
    expect(wallTimeMs(detail([agent([], { duration_ms: 1000 }), agent([], { duration_ms: 3000 })]))).toBe(3000);
  });
});
