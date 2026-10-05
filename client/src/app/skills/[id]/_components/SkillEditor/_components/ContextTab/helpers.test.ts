import { describe, it, expect } from "vitest";
import { serializeAs, serializedText } from "./helpers";

const files = [
  { path: "docs/b.md", kind: "docs" as const },
  { path: "specs/a.md", kind: "specs" as const },
  { path: "INSIGHTS.md", kind: "insights" as const },
  { path: "x.md" },
];

describe("serializeAs", () => {
  it("keeps attach order, not listing order, and carries each kind", () => {
    expect(serializeAs(["specs/a.md", "INSIGHTS.md", "docs/b.md"], files)).toEqual([
      { kind: "specs", path: "specs/a.md" },
      { kind: "insights", path: "INSIGHTS.md" },
      { kind: "docs", path: "docs/b.md" },
    ]);
  });

  it("omits an attached path that is not in the listing and falls back to other", () => {
    expect(serializeAs(["gone.md", "specs/a.md", "x.md"], files)).toEqual([
      { kind: "specs", path: "specs/a.md" },
      { kind: "other", path: "x.md" },
    ]);
    expect(serializeAs(["gone.md"], files)).toEqual([]);
  });
});

describe("serializedText", () => {
  it("puts the heading first and exactly one line starting with ##", () => {
    const text = serializedText("## Project context", serializeAs(["specs/a.md", "INSIGHTS.md"], files), (k) => k);
    expect(text).toBe("## Project context\n- [specs] specs/a.md\n- [insights] INSIGHTS.md");
    expect(text.split("\n").filter((l) => l.startsWith("##"))).toHaveLength(1);
    expect(serializedText("## Project context", [], (k) => k)).toBe("## Project context");
  });
});
