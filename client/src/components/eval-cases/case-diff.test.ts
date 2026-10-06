import { describe, it, expect } from "vitest";
import { diffTooLarge, formatRanges, overlapsChanged, parsePastedDiff, utf8Bytes } from "./case-diff";

/* The fixture strings are the ones in server/test/evals-authoring-helpers.test.ts — the two
   sides must agree on files and ranges (client/server rule drift, INSIGHTS.md). */
const TWO_FILES = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "+added",
  " tail",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -5,1 +5,2 @@",
  "-old",
  "+new1",
  "+new2",
].join("\n");

const PLACEHOLDER = '--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: "sk_live_..."';

const paths = (r: ReturnType<typeof parsePastedDiff>) => (r.ok ? r.files.map((f) => f.path) : r.reason);

describe("parsePastedDiff — same fixtures as the server's pastedDiffFiles", () => {
  it("(a) a diff --git 2-file diff gives 2 files with their `+` runs and a hunk-only patch", () => {
    const r = parsePastedDiff(TWO_FILES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.map((f) => [f.path, f.ranges])).toEqual([
      ["src/a.ts", [[2, 2]]],
      ["src/b.ts", [[5, 6]]],
    ]);
    expect(r.files[0]).toMatchObject({ additions: 1, deletions: 0 });
    expect(r.files[1]).toMatchObject({ additions: 2, deletions: 1 });
    expect(r.files[0]?.patch?.startsWith("@@ -1,2 +1,3 @@")).toBe(true);
  });

  it("(b) the editor placeholder is one file, src/config.ts, range [10,10]", () => {
    const r = parsePastedDiff(PLACEHOLDER);
    expect(r.ok && r.files.map((f) => [f.path, f.ranges])).toEqual([["src/config.ts", [[10, 10]]]]);
  });

  it("(c) a bare 2-file diff needs git headers", () => {
    const bare = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,1 +1,2 @@",
      "+a",
      "--- a/y.ts",
      "+++ b/y.ts",
      "@@ -1,1 +1,2 @@",
      "+b",
    ].join("\n");
    expect(paths(parsePastedDiff(bare))).toBe("needs_git_headers");
  });

  it("(d) a hunk without file headers, (e) a header without a hunk, (f) a lone deletion, and empty text are rejected", () => {
    expect(paths(parsePastedDiff("@@ -1,1 +1,2 @@\n+a"))).toBe("unparseable");
    expect(paths(parsePastedDiff("--- a/x.ts\n+++ b/x.ts\n"))).toBe("unparseable");
    expect(paths(parsePastedDiff("diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone"))).toBe(
      "unparseable",
    );
    expect(paths(parsePastedDiff("  \n"))).toBe("empty");
  });

  it("(g) a root-level path is kept, (h) CRLF parses like LF", () => {
    const lf = "--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,2 @@\n context\n+added";
    expect(paths(parsePastedDiff(lf))).toEqual(["README.md"]);
    const crlf = parsePastedDiff(lf.replace(/\n/g, "\r\n"));
    const plain = parsePastedDiff(lf);
    expect(crlf.ok && plain.ok && crlf.files.map((f) => [f.path, f.ranges])).toEqual(
      plain.ok ? plain.files.map((f) => [f.path, f.ranges]) : null,
    );
    expect(plain.ok && plain.files[0]?.ranges).toEqual([[2, 2]]);
  });

  it("(k) a deletion-only hunk has no ranges, and src/a.ts and src/a.tsx stay two files", () => {
    const del = parsePastedDiff("--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,1 @@\n keep\n-gone");
    expect(del.ok && del.files[0]?.ranges).toEqual([]);
    const two = parsePastedDiff(
      "diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n+x\ndiff --git a/src/a.tsx b/src/a.tsx\n+++ b/src/a.tsx\n@@ -1,1 +1,2 @@\n+y",
    );
    expect(paths(two)).toEqual(["src/a.ts", "src/a.tsx"]);
  });

  it("splits a run at a context line and merges consecutive additions", () => {
    const r = parsePastedDiff("--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,6 @@\n+a\n+b\n ctx\n+c");
    expect(r.ok && r.files[0]?.ranges).toEqual([
      [1, 2],
      [4, 4],
    ]);
  });
});

describe("parsePastedDiff — marker and look-alike lines (same fixtures as the server)", () => {
  it("does not count a '\\ No newline' marker as a line, and keeps it out of the counts", () => {
    const d = "--- a/f.ts\n+++ b/f.ts\n@@ -1,2 +1,2 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file";
    const r = parsePastedDiff(d);
    expect(r.ok && r.files.map((f) => [f.path, f.ranges])).toEqual([["f.ts", [[1, 1]]]]);
    expect(r.ok && r.files[0]).toMatchObject({ additions: 1, deletions: 1 });
  });

  it("a deleted SQL comment (`--- ...` in the diff) does not shift the new-side line of the next added line", () => {
    const d = "--- a/db/q.sql\n+++ b/db/q.sql\n@@ -1,3 +1,3 @@\n select 1;\n--- old comment\n+-- new comment\n select 2;";
    const r = parsePastedDiff(d);
    expect(r.ok && r.files.map((f) => [f.path, f.ranges])).toEqual([["db/q.sql", [[2, 2]]]]);
  });
});

describe("range and size helpers", () => {
  it("formats runs and checks overlap inclusively", () => {
    expect(
      formatRanges([
        [12, 12],
        [20, 24],
      ]),
    ).toBe("12, 20–24");
    const file = { ranges: [[10, 12]] as [number, number][] };
    expect(overlapsChanged(file, 12, 15)).toBe(true);
    expect(overlapsChanged(file, 13, 15)).toBe(false);
    expect(overlapsChanged(file, 1, 9)).toBe(false);
  });

  it("counts UTF-8 bytes: 65 536 is allowed, 65 537 is not, and a 2-byte char counts twice", () => {
    expect(diffTooLarge("a".repeat(65_536))).toBe(false);
    expect(diffTooLarge("a".repeat(65_537))).toBe(true);
    expect(utf8Bytes("é")).toBe(2);
    expect(diffTooLarge("a".repeat(65_535) + "é")).toBe(true);
  });
});
