import { describe, it, expect } from "vitest";
import type { PrFile } from "@devdigest/shared";
import { previewHunks } from "./helpers";

const file = (patch: string | null | undefined, path = "src/config.ts"): PrFile => ({
  path,
  additions: 0,
  deletions: 0,
  patch,
});
const at = (line: number) => ({ file: "src/config.ts", start_line: line, end_line: line });

// Hunks cover new-side lines 10-14 and 30-31.
const PATCH = ["@@ -10,3 +10,5 @@", " a", "+b", "+c", " d", " e", "@@ -30,1 +30,2 @@", " x", "+y"].join("\n");

describe("previewHunks", () => {
  it("keeps a hunk when the finding sits on its last new-side line and drops it one line later", () => {
    expect(previewHunks([file(PATCH)], at(14))?.lines[0]).toBe("@@ -10,3 +10,5 @@");
    expect(previewHunks([file(PATCH)], at(15))).toBeNull();
  });

  it("keeps every overlapping hunk and none of the others", () => {
    const r = previewHunks([file(PATCH)], { file: "src/config.ts", start_line: 12, end_line: 30 })!;
    expect(r.lines).toContain("@@ -30,1 +30,2 @@");
    expect(r.lines).toContain("@@ -10,3 +10,5 @@");
    const only = previewHunks([file(PATCH)], at(30))!;
    expect(only.lines).not.toContain("@@ -10,3 +10,5 @@");
  });

  it("matches the path exactly", () => {
    expect(previewHunks([file(PATCH, "src/Config.ts")], at(11))).toBeNull();
    expect(previewHunks([file(PATCH, "src/config.ts.bak")], at(11))).toBeNull();
  });

  it("returns null without a patch or a file", () => {
    expect(previewHunks([file(null)], at(11))).toBeNull();
    expect(previewHunks([file(undefined)], at(11))).toBeNull();
    expect(previewHunks(undefined, at(11))).toBeNull();
  });

  it("treats a header without a length as one line", () => {
    const p = "@@ -5 +5 @@\n-old\n+new";
    expect(previewHunks([file(p)], at(5))).not.toBeNull();
    expect(previewHunks([file(p)], at(6))).toBeNull();
  });

  it("caps at 200 lines and flags truncation only past 200", () => {
    const body = (n: number) => ["@@ -1,300 +1,300 @@", ...Array.from({ length: n - 1 }, (_, i) => ` l${i}`)].join("\n");
    expect(previewHunks([file(body(200))], at(1))).toMatchObject({ truncated: false });
    const r = previewHunks([file(body(201))], at(1))!;
    expect(r.lines).toHaveLength(200);
    expect(r.truncated).toBe(true);
  });
});
