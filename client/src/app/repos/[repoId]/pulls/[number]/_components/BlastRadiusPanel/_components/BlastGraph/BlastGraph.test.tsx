import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { layoutBlastGraph } from "./helpers";
import { BlastGraph } from "./BlastGraph";

afterEach(cleanup);

const DOWNSTREAM: DownstreamImpact[] = [
  {
    symbol: "applyRateLimit",
    callers: [
      { name: "registerPublicRoutes", file: "src/api/public/webhooks.ts", line: 42 },
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
  it("places one node per changed symbol and per distinct caller file", () => {
    const layout = layoutBlastGraph(DOWNSTREAM);
    expect(layout.symbolNodes.map((n) => n.id)).toEqual(["applyRateLimit", "RateLimitConfig"]);
    expect(layout.fileNodes.map((n) => n.id)).toEqual(["src/api/public/webhooks.ts", "src/api/users.ts"]);
  });

  it("emits one edge per caller, even when several callers share a file", () => {
    const layout = layoutBlastGraph(DOWNSTREAM);
    expect(layout.edges).toHaveLength(3);
  });

  it("degrades to a single-row layout with no callers", () => {
    const layout = layoutBlastGraph([]);
    expect(layout.symbolNodes).toEqual([]);
    expect(layout.fileNodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });
});

describe("BlastGraph", () => {
  it("renders an accessible graph with one <line> per caller edge", () => {
    renderWithIntl(<BlastGraph downstream={DOWNSTREAM} />);
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg.querySelectorAll("line")).toHaveLength(3);
    expect(screen.getByText("applyRateLimit")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("shows the empty state when there is no downstream", () => {
    renderWithIntl(<BlastGraph downstream={[]} />);
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
