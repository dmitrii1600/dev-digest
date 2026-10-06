import { describe, it, expect } from "vitest";
import { formatExpectationJson, parseExpectationJson } from "./expectation-json";

const DRAFT = { type: "must_find", file: "src/config.ts", start_line: 10, end_line: 12 } as const;

describe("expectation JSON", () => {
  it("round-trips the form values in a fixed key order", () => {
    const text = formatExpectationJson(DRAFT);
    expect(Object.keys(JSON.parse(text))).toEqual(["type", "file", "start_line", "end_line"]);
    expect(text).toContain('\n  "type"');
    expect(parseExpectationJson(text)).toEqual({ ok: true, value: DRAFT });
  });

  it("names the failure: parse, shape, or too large", () => {
    expect(parseExpectationJson('{"type":"must_find"}')).toEqual({ ok: false, reason: "shape" });
    expect(parseExpectationJson(JSON.stringify({ ...DRAFT, extra: 1 }))).toEqual({ ok: false, reason: "shape" });
    expect(parseExpectationJson(JSON.stringify({ ...DRAFT, start_line: 1.5 }))).toEqual({ ok: false, reason: "shape" });
    expect(parseExpectationJson(JSON.stringify({ ...DRAFT, start_line: 0 }))).toEqual({ ok: false, reason: "shape" });
    expect(parseExpectationJson(JSON.stringify({ ...DRAFT, type: "nope" }))).toEqual({ ok: false, reason: "shape" });
    expect(parseExpectationJson("[1]")).toEqual({ ok: false, reason: "shape" });
    expect(parseExpectationJson('{"type":"must_find",}')).toEqual({ ok: false, reason: "parse" });
  });

  it("start after end is not a shape error (the form names it)", () => {
    expect(parseExpectationJson(JSON.stringify({ ...DRAFT, start_line: 9, end_line: 4 })).ok).toBe(true);
  });

  it("allows 8 192 bytes and rejects 8 193", () => {
    const pad = (n: number) => JSON.stringify(DRAFT).slice(0, -1) + " ".repeat(n) + "}";
    const base = new TextEncoder().encode(pad(0)).length;
    expect(parseExpectationJson(pad(8192 - base)).ok).toBe(true);
    expect(parseExpectationJson(pad(8193 - base))).toEqual({ ok: false, reason: "too_large" });
  });
});
