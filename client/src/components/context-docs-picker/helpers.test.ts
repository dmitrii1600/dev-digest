import { describe, it, expect } from "vitest";
import { estimateTokens, filterDocs, mergeDocRows, moveRow } from "./helpers";

const files = [
  { path: "docs/b.md", kind: "docs" as const, tokens: 20 },
  { path: "specs/a.md", kind: "specs" as const, tokens: 10 },
  { path: "z.md", kind: "other" as const, tokens: 5 },
];

describe("context-docs-picker helpers", () => {
  it("puts attached rows first in attach order and flags a lost path as missing", () => {
    const rows = mergeDocRows(files, ["z.md", "gone.md", "specs/a.md"]);
    expect(rows.map((r) => r.path)).toEqual(["z.md", "gone.md", "specs/a.md", "docs/b.md"]);
    expect(rows.find((r) => r.path === "gone.md")?.missing).toBe(true);
    expect(rows.find((r) => r.path === "docs/b.md")?.attached).toBe(false);
  });

  it("sums tokens over attached, non-missing rows only", () => {
    const rows = mergeDocRows(files, ["specs/a.md", "gone.md", "docs/b.md"]);
    expect(estimateTokens(rows)).toBe(30);
  });

  it("filters by path substring without reordering, and moves a row", () => {
    const rows = mergeDocRows(files, ["z.md"]);
    expect(filterDocs(rows, "  SPECS").map((r) => r.path)).toEqual(["specs/a.md"]);
    expect(filterDocs(rows, "").map((r) => r.path)).toEqual(rows.map((r) => r.path));
    expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });
});
