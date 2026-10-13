/* Pure rules for the multi-agent results page: match groups (AC-13), disagreement
   rows (AC-14/15), wall time and total cost (AC-9, EC-7). No React, no IO. */
import type { FindingRecord, MultiReviewAgent, MultiReviewDetail, Severity } from "@devdigest/shared";
import { MATCH_LINE_SLACK, SEVERITY_RANK } from "./constants";

export interface Member {
  finding: FindingRecord;
  agentIndex: number;
}
export type MatchGroup = Member[];

export type Cell =
  | { kind: "flagged"; findings: FindingRecord[] }
  | { kind: "didNotFlag" }
  | { kind: "noResult" };

export interface Row {
  header: { file: string; line: number; title: string };
  cells: Cell[];
  isConflict: boolean;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareMembers(a: Member, b: Member): number {
  return (
    cmp(a.finding.file, b.finding.file) ||
    a.finding.start_line - b.finding.start_line ||
    a.finding.end_line - b.finding.end_line ||
    a.agentIndex - b.agentIndex ||
    cmp(a.finding.id, b.finding.id)
  );
}

function linked(a: Member, b: Member): boolean {
  return (
    a.agentIndex !== b.agentIndex &&
    a.finding.file === b.finding.file &&
    a.finding.start_line - MATCH_LINE_SLACK <= b.finding.end_line + MATCH_LINE_SLACK &&
    b.finding.start_line - MATCH_LINE_SLACK <= a.finding.end_line + MATCH_LINE_SLACK
  );
}

/** Connected components of the "same location" relation between findings of
   different agents. Deterministic whatever the input order. */
export function groupFindings(agents: MultiReviewAgent[]): MatchGroup[] {
  const members: Member[] = agents
    .flatMap((a, agentIndex) => a.findings.map((finding) => ({ finding, agentIndex })))
    .sort(compareMembers);
  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (linked(members[i]!, members[j]!)) parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, Member[]>();
  members.forEach((m, i) => {
    const root = find(i);
    const list = byRoot.get(root);
    if (list) list.push(m);
    else byRoot.set(root, [m]);
  });
  // Members are already sorted, so groups sort by their first member.
  return [...byRoot.values()].sort((a, b) => compareMembers(a[0]!, b[0]!));
}

function topSeverity(findings: FindingRecord[]): Severity {
  return findings.reduce<Severity>(
    (best, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[best] ? f.severity : best),
    findings[0]!.severity,
  );
}

/** One row per group (a group of one included), one cell per selected agent. */
export function disagreementRows(agents: MultiReviewAgent[], groups: MatchGroup[]): Row[] {
  return groups.map((group) => {
    const head = [...group].sort(
      (a, b) =>
        SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
        a.finding.start_line - b.finding.start_line ||
        a.agentIndex - b.agentIndex,
    )[0]!;
    const cells: Cell[] = agents.map((agent, i) => {
      const mine = group.filter((m) => m.agentIndex === i).map((m) => m.finding);
      if (mine.length > 0) return { kind: "flagged", findings: mine };
      return agent.run.status === "done" ? { kind: "didNotFlag" } : { kind: "noResult" };
    });
    // A conflict = the completed agents did not all give the same answer
    // ("did not flag" is its own answer). noResult cells never count.
    const answers = new Set<string>();
    agents.forEach((agent, i) => {
      const cell = cells[i]!;
      if (agent.run.status !== "done") return;
      answers.add(cell.kind === "flagged" ? topSeverity(cell.findings) : "none");
    });
    return {
      header: { file: head.finding.file, line: head.finding.start_line, title: head.finding.title },
      cells,
      isConflict: answers.size > 1,
    };
  });
}

function inFlight(status: string | null | undefined): boolean {
  return status === "running" || status == null;
}

/** Start to the last agent's end, in ms. Null while any run is still in flight. */
export function wallTimeMs(detail: MultiReviewDetail): number | null {
  if (detail.agents.some((a) => inFlight(a.run.status))) return null;
  let end: number | null = null;
  for (const { run } of detail.agents) {
    if (run.ran_at == null || run.duration_ms == null) continue;
    const t = Date.parse(run.ran_at) + run.duration_ms;
    if (end == null || t > end) end = t;
  }
  return end == null ? null : end - Date.parse(detail.ran_at);
}

/** Sum of the completed runs' cost; null when any completed run's cost is unknown. */
export function totalCost(detail: MultiReviewDetail): number | null {
  let sum = 0;
  for (const { run } of detail.agents) {
    if (run.status !== "done") continue;
    if (run.cost_usd == null) return null;
    sum += run.cost_usd;
  }
  return sum;
}

/** 8200 gives "8.2s"; unknown gives "—". */
export function formatSecondsOrDash(ms: number | null | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}
