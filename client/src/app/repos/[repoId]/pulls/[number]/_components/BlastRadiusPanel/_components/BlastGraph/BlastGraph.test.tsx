import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ChangedSymbol, DownstreamImpact } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { layoutBlastGraph, shortenPath, truncate } from "./helpers";
import { BlastGraph } from "./BlastGraph";

afterEach(cleanup);

const CHANGED_SYMBOLS: ChangedSymbol[] = [
  { name: "applyRateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
  { name: "RateLimitConfig", file: "src/middleware/ratelimit.ts", kind: "interface" },
];

const DOWNSTREAM: DownstreamImpact[] = [
  {
    symbol: "applyRateLimit",
    callers: [
      { name: "registerPublicRoutes", file: "src/api/public/webhooks.ts", line: 42, endpoints: ["GET /users/:id"] },
      { name: "createUser", file: "src/api/users.ts", line: 118 },
    ],
    endpoints_affected: ["GET /users/:id"],
    crons_affected: [],
  },
  {
    symbol: "RateLimitConfig",
    callers: [{ name: "createUser", file: "src/api/users.ts", line: 120 }],
    endpoints_affected: [],
    crons_affected: ["job:digest"],
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ blast: messages }}>{ui}</NextIntlClientProvider>);
}

describe("layoutBlastGraph (pure)", () => {
  it("places one node per changed symbol and appends () for callable kinds", () => {
    const layout = layoutBlastGraph(CHANGED_SYMBOLS, DOWNSTREAM);
    expect(layout.symbolNodes.map((n) => n.id)).toEqual(["applyRateLimit", "RateLimitConfig"]);
    expect(layout.symbolNodes.map((n) => n.label)).toEqual(["applyRateLimit()", "RateLimitConfig"]);
  });

  it("dedupes callers by name+file into one node each", () => {
    const layout = layoutBlastGraph(CHANGED_SYMBOLS, DOWNSTREAM);
    // createUser calls both symbols but is one caller (same name+file).
    expect(layout.callerNodes.map((n) => n.id)).toEqual([
      "registerPublicRoutes::src/api/public/webhooks.ts",
      "createUser::src/api/users.ts",
    ]);
    expect(layout.callerNodes.map((n) => n.title)).toEqual([
      "src/api/public/webhooks.ts:42",
      "src/api/users.ts:118",
    ]);
  });

  it("uses per-caller endpoints/crons when present, and the group facts otherwise", () => {
    const layout = layoutBlastGraph(CHANGED_SYMBOLS, DOWNSTREAM);
    // Group 1 has a caller-level endpoint fact; group 2 has none on its
    // caller, so it falls back to the group's own crons_affected.
    expect(layout.endpointNodes.map((n) => ({ id: n.id, kind: n.kind }))).toEqual([
      { id: "endpoint:GET /users/:id", kind: "endpoint" },
      { id: "cron:job:digest", kind: "cron" },
    ]);
  });

  it("emits one symbol->caller edge per caller and one caller->fact edge per attributed fact", () => {
    const layout = layoutBlastGraph(CHANGED_SYMBOLS, DOWNSTREAM);
    // 3 callers total (2 + 1) plus 2 facts attributed = 5 edges.
    expect(layout.edges).toHaveLength(5);
    expect(layout.edges.every((e) => e.d.startsWith("M "))).toBe(true);
  });

  it("degrades to an empty layout with no downstream", () => {
    const layout = layoutBlastGraph([], []);
    expect(layout.symbolNodes).toEqual([]);
    expect(layout.callerNodes).toEqual([]);
    expect(layout.endpointNodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});

describe("shortenPath / truncate (pure)", () => {
  it("keeps short paths and shortens deep ones to the last two segments", () => {
    expect(shortenPath("api/users.ts")).toBe("api/users.ts");
    expect(shortenPath("src/api/users.ts")).toBe("…/api/users.ts");
    expect(shortenPath("client/src/app/repos/[repoId]/page.tsx")).toBe("…/[repoId]/page.tsx");
  });

  it("cuts the head of an over-long label and keeps the tail", () => {
    expect(truncate("abcdefghij", 6)).toBe("…fghij");
    expect(truncate("abc", 6)).toBe("abc");
  });
});

describe("BlastGraph", () => {
  it("renders an accessible graph with symbol, caller and endpoint/cron nodes", () => {
    renderWithIntl(<BlastGraph changedSymbols={CHANGED_SYMBOLS} downstream={DOWNSTREAM} />);
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg.querySelectorAll("path")).toHaveLength(5);
    const labels = Array.from(svg.querySelectorAll("text")).map((n) => n.textContent);
    expect(labels).toEqual([
      "applyRateLimit()",
      "RateLimitConfig",
      "registerPublicRoutes",
      "createUser",
      "GET /users/:id",
      "job:digest",
    ]);
  });

  it("renders a three-item legend below the graph", () => {
    renderWithIntl(<BlastGraph changedSymbols={CHANGED_SYMBOLS} downstream={DOWNSTREAM} />);
    expect(screen.getByText("changed symbol")).toBeInTheDocument();
    expect(screen.getByText("callers")).toBeInTheDocument();
    expect(screen.getByText("endpoints affected")).toBeInTheDocument();
  });

  it("shows the empty state when there is no downstream", () => {
    renderWithIntl(<BlastGraph changedSymbols={CHANGED_SYMBOLS} downstream={[]} />);
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
