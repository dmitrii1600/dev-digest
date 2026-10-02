import { describe, it, expect } from "vitest";
import { bytesToBase64, crumbFor, isDirty, isPastCap, toLf } from "./helpers";

describe("ProjectContextView helpers", () => {
  it("compares text for unsaved changes after CRLF to LF", () => {
    expect(isDirty("a\r\nb", "a\nb")).toBe(false);
    expect(isDirty("a\nb ", "a\nb")).toBe(true);
    expect(toLf("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("round-trips a BOM + CRLF buffer through base64, and an empty buffer is empty", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x61, 0x0d, 0x0a, 0x62]);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
    expect(bytesToBase64(bytes.buffer)).toBe(bytesToBase64(bytes));
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  it("encodes a buffer larger than one chunk", () => {
    const bytes = new Uint8Array(70_000).fill(0x41);
    expect(atob(bytesToBase64(bytes)).length).toBe(70_000);
  });

  it("builds the crumb and finds a path past the listing cap", () => {
    expect(crumbFor("o/r", "Project Context", null)).toEqual([
      { label: "o/r", mono: true },
      { label: "Project Context" },
    ]);
    expect(crumbFor("o/r", "Project Context", "a.md").at(-1)).toEqual({ label: "a.md", mono: true });
    expect(isPastCap("x.md", [{ path: "a.md" }])).toBe(true);
    expect(isPastCap("a.md", [{ path: "a.md" }])).toBe(false);
  });
});
