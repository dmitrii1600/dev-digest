import { describe, it, expect } from "vitest";
import { estimateTokens, filterDocs, isOverSoftCap, mergeDocRows, moveRow } from "./helpers";

const files = [
  { path: "docs/b.md", kind: "docs" as const, tokens: 20 },
  { path: "specs/a.md", kind: "specs" as const, tokens: 10, used_by: 2 },
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

  it("leaves a null-token row out of the total while a 0 row counts as 0, and copies usedBy", () => {
    const list = [
      { path: "a.md", kind: "docs" as const, tokens: null },
      { path: "b.md", kind: "docs" as const, tokens: 0 },
      { path: "c.md", kind: "docs" as const, tokens: 7, used_by: 3 },
    ];
    const rows = mergeDocRows(list, ["a.md", "b.md", "c.md", "gone.md"]);
    expect(rows.find((r) => r.path === "a.md")?.tokens).toBeNull();
    expect(rows.find((r) => r.path === "b.md")?.tokens).toBe(0);
    expect(rows.find((r) => r.path === "gone.md")?.tokens).toBeNull();
    expect(estimateTokens(rows)).toBe(7);
    expect(rows.find((r) => r.path === "c.md")?.usedBy).toBe(3);
    expect(rows.find((r) => r.path === "a.md")?.usedBy).toBe(0);
    expect(mergeDocRows(list, []).find((r) => r.path === "a.md")?.tokens).toBeNull();
  });

  it("treats exactly 4,000 tokens as under the soft cap and 4,001 as over", () => {
    expect(isOverSoftCap(4000)).toBe(false);
    expect(isOverSoftCap(4001)).toBe(true);
  });
});
