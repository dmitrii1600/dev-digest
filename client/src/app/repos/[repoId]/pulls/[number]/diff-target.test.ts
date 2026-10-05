import { describe, it, expect } from "vitest";
import { diffTargetHref, isInDiff, parseFileRef, readDiffTarget } from "./diff-target";

const sp = (q: string) => new URLSearchParams(q);

describe("parseFileRef", () => {
  it("strips ./ and a :n / :a-b suffix, keeping the first line", () => {
    expect(parseFileRef("./src/a.ts:12-30")).toEqual({ file: "src/a.ts", line: 12 });
    expect(parseFileRef("src/a.ts:7")).toEqual({ file: "src/a.ts", line: 7 });
  });
  it("gives a null line for a bare path or a zero line", () => {
    expect(parseFileRef("src/a.ts")).toEqual({ file: "src/a.ts", line: null });
    expect(parseFileRef("src/a.ts:0")).toEqual({ file: "src/a.ts", line: null });
  });
});

describe("readDiffTarget", () => {
  it("reads file and a valid line", () => {
    expect(readDiffTarget(sp("tab=diff&file=src%2Fa.ts&line=12"))).toEqual({ file: "src/a.ts", line: 12 });
  });
  it("treats abc / 0 / -1 as no line", () => {
    for (const bad of ["abc", "0", "-1"]) {
      expect(readDiffTarget(sp(`file=a.ts&line=${bad}`))).toEqual({ file: "a.ts", line: null });
    }
  });
  it("is null without a file", () => {
    expect(readDiffTarget(sp("tab=diff&line=3"))).toBeNull();
    expect(readDiffTarget(sp("file="))).toBeNull();
  });
});

describe("isInDiff", () => {
  it("is exact: a case variant or near miss is not in the diff", () => {
    expect(isInDiff("src/a.ts", ["src/a.ts"])).toBe(true);
    expect(isInDiff("Src/a.ts", ["src/a.ts"])).toBe(false);
    expect(isInDiff("src/a.ts.bak", ["src/a.ts"])).toBe(false);
  });
});

describe("diffTargetHref", () => {
  it("sets tab/file/line and keeps trace", () => {
    const href = diffTargetHref("/repos/r/pulls/1", "trace=r1&tab=overview", { file: "src/a.ts", line: 12 });
    const [path, query] = href.split("?");
    expect(path).toBe("/repos/r/pulls/1");
    const p = new URLSearchParams(query);
    expect(p.get("tab")).toBe("diff");
    expect(p.get("file")).toBe("src/a.ts");
    expect(p.get("line")).toBe("12");
    expect(p.get("trace")).toBe("r1");
    expect(query).toContain("file=src%2Fa.ts");
  });
  it("omits line when null and drops an old one", () => {
    const href = diffTargetHref("/x", "line=9", { file: "a.ts", line: null });
    expect(new URLSearchParams(href.split("?")[1]).has("line")).toBe(false);
  });
});
