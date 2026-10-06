import { describe, it, expect } from "vitest";
import { inWindow, parseWindow, sinceFor } from "./window";

describe("parseWindow", () => {
  it("accepts exactly the four windows and falls back to 30d for anything else", () => {
    expect(parseWindow("7d")).toBe("7d");
    expect(parseWindow("90d")).toBe("90d");
    expect(parseWindow("all")).toBe("all");
    expect(parseWindow("30D")).toBe("30d"); // case variant is not a window
    expect(parseWindow("14d")).toBe("30d"); // near miss
    expect(parseWindow("")).toBe("30d");
    expect(parseWindow(null)).toBe("30d");
    expect(parseWindow(undefined)).toBe("30d");
  });
});

describe("sinceFor", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("is exactly N x 24 h before now, and undefined for all", () => {
    expect(sinceFor("7d", now)).toBe(new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString());
    expect(sinceFor("30d", now)).toBe("2026-09-06T12:00:00.000Z");
    expect(sinceFor("90d", now)).toBe("2026-07-08T12:00:00.000Z");
    expect(sinceFor("all", now)).toBeUndefined();
  });
});

describe("inWindow", () => {
  it("keeps a run exactly at the bound and drops one 1 ms earlier; no bound keeps everything", () => {
    const since = "2026-09-06T12:00:00.000Z";
    expect(inWindow("2026-09-06T12:00:00.000Z", since)).toBe(true);
    expect(inWindow("2026-09-06T11:59:59.999Z", since)).toBe(false);
    expect(inWindow("2020-01-01T00:00:00Z", undefined)).toBe(true);
  });
});
