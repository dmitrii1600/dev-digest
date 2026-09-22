import { describe, it, expect } from "vitest";
import { diffLines, isUnchanged } from "./diff";

describe("diffLines", () => {
  it("marks an added line and keeps the surrounding context", () => {
    const lines = diffLines("a\nb", "a\nb\nc");
    expect(lines.map((l) => l.kind)).toEqual(["ctx", "ctx", "add"]);
    expect(lines[2]).toMatchObject({ text: "c", newNo: 3 });
  });

  it("marks a removed line", () => {
    const lines = diffLines("a\nb\nc", "a\nc");
    expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["ctx:a", "del:b", "ctx:c"]);
    expect(lines[1]).toMatchObject({ oldNo: 2 });
  });

  it("reads a replacement as a delete plus an add", () => {
    const lines = diffLines("one", "two");
    expect(lines.map((l) => l.kind).sort()).toEqual(["add", "del"]);
  });

  it("treats a missing predecessor as an all-new body", () => {
    const lines = diffLines(null, "a\nb");
    expect(lines.every((l) => l.kind === "add")).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it("numbers old and new sides independently", () => {
    const lines = diffLines("a\nb\nc", "a\nx\nb\nc");
    const added = lines.find((l) => l.kind === "add")!;
    expect(added).toMatchObject({ text: "x", newNo: 2 });
    expect(added.oldNo).toBeUndefined();
  });
});

describe("isUnchanged", () => {
  it("is true only when every line is context", () => {
    expect(isUnchanged(diffLines("a\nb", "a\nb"))).toBe(true);
    expect(isUnchanged(diffLines("a\nb", "a\nc"))).toBe(false);
  });
});
