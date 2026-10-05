import { describe, it, expect } from "vitest";
import { decorateDiagram, diagramKind, errorCopyKey, githubFileUrl, splitArchitecture, timeAgo, tourUrl } from "./helpers";

describe("onboarding tour helpers", () => {
  it("builds a default-branch blob URL with each path segment encoded", () => {
    expect(githubFileUrl("acme/api", "main", "src/a b.ts")).toBe(
      "https://github.com/acme/api/blob/main/src/a%20b.ts",
    );
  });

  it("buckets the age into now / minutes / hours / days", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
    expect(ago(10_000)).toEqual({ unit: "now", count: 0 });
    expect(ago(5 * 60_000)).toEqual({ unit: "minutes", count: 5 });
    expect(ago(3 * 3_600_000)).toEqual({ unit: "hours", count: 3 });
    expect(ago(2 * 86_400_000)).toEqual({ unit: "days", count: 2 });
  });

  it("maps error codes (and reasons) to copy keys, falling back to the generic one", () => {
    expect(errorCopyKey("repo_not_indexed", { reason: "flag_off" })).toBe("errors.repo_not_indexed.flag_off");
    expect(errorCopyKey("generation_failed", { reason: "timeout" })).toBe("errors.generation_failed.timeout");
    expect(errorCopyKey("provider_key_missing", { provider: "openrouter" })).toBe("errors.provider_key_missing");
    expect(errorCopyKey("repo_not_indexed", { reason: "bogus" })).toBe("errors.unknown");
    expect(errorCopyKey("nope")).toBe("errors.unknown");
    expect(errorCopyKey(undefined)).toBe("errors.unknown");
  });

  it("builds the tour page URL", () => {
    expect(tourUrl("http://x", "r1")).toBe("http://x/repos/r1/tour");
  });

  it("classifies diagram nodes into store / edge / client / entry", () => {
    expect(diagramKind("db Postgres")).toBe("store");
    expect(diagramKind("R redis")).toBe("store");
    expect(diagramKind("MW middleware")).toBe("edge");
    expect(diagramKind("A auth guard")).toBe("edge");
    expect(diagramKind("C client")).toBe("client");
    expect(diagramKind("S server.ts")).toBe("entry");
    expect(diagramKind("P api/public/*")).toBe("entry");
    expect(diagramKind("X widgets")).toBeUndefined();
  });

  it("appends one class line per kind for declared and bare nodes, leaving the model's text as is", () => {
    const src = [
      "flowchart LR",
      "  C[client] --> S[server.ts]",
      "  S --> MW[middleware]",
      "  MW -->|cache| R[(redis)]",
      "  MW --> API[api/public/*] --> PG[(postgres)]",
      "  S -- logs to --> X[widgets]",
    ].join("\n");
    const out = decorateDiagram(src);
    expect(out.startsWith(src)).toBe(true);
    const added = out
      .slice(src.length)
      .trim()
      .split("\n")
      .map((l) => l.trim());
    expect(added).toContain("class C tour_client");
    expect(added).toContain("class S,API tour_entry");
    expect(added).toContain("class MW tour_edge");
    expect(added).toContain("class R,PG tour_store");
    expect(added.join(" ")).not.toMatch(/\blogs\b|\bX\b/);
  });

  it("leaves a diagram that is not a flowchart, or has nothing to classify, unchanged", () => {
    const seq = "sequenceDiagram\n  A->>B: hi";
    expect(decorateDiagram(seq)).toBe(seq);
    const plain = "flowchart TD\n  X[widgets] --> Y[gadgets]";
    expect(decorateDiagram(plain)).toBe(plain);
  });

  it("moves a ```mermaid block out of the prose, using it only when the diagram field is empty", () => {
    const fence = "```mermaid\nflowchart LR\n  A --> B\n```";
    const prose = `Intro.\n\n${fence}\n\nOutro.`;
    expect(splitArchitecture(prose, "flowchart TD\n  X --> Y")).toEqual({
      prose: "Intro.\n\nOutro.",
      diagram: "flowchart TD\n  X --> Y",
    });
    expect(splitArchitecture(prose, null)).toEqual({ prose: "Intro.\n\nOutro.", diagram: "flowchart LR\n  A --> B" });
    expect(splitArchitecture("Just prose.", null)).toEqual({ prose: "Just prose.", diagram: null });
  });
});
