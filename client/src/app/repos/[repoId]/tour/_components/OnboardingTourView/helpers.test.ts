import { describe, it, expect } from "vitest";
import { errorCopyKey, githubFileUrl, timeAgo, tourUrl } from "./helpers";

describe("onboarding tour helpers", () => {
  it("builds a default-branch blob URL with each path segment encoded", () => {
    expect(githubFileUrl("acme/api", "main", "src/a b.ts")).toBe(
      "https://github.com/acme/api/blob/main/src/a%20b.ts",
    );
  });

  it("buckets the age into now / minutes / hours / days", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);
    expect(ago(10_000)).toEqual({ unit: "now", count: 0 });
    expect(ago(5 * 60_000)).toEqual({ unit: "minutes", count: 5 });
    expect(ago(3 * 3_600_000)).toEqual({ unit: "hours", count: 3 });
    expect(ago(2 * 86_400_000)).toEqual({ unit: "days", count: 2 });
  });

  it("maps error codes (and reasons) to copy keys, falling back to the generic one", () => {
    expect(errorCopyKey("repo_not_indexed", { reason: "flag_off" })).toBe("errors.repo_not_indexed.flag_off");
    expect(errorCopyKey("generation_failed", { reason: "timeout" })).toBe("errors.generation_failed.timeout");
    expect(errorCopyKey("provider_key_missing", { provider: "openrouter" })).toBe("errors.provider_key_missing");
    expect(errorCopyKey("repo_not_indexed", { reason: "bogus" })).toBe("errors.unknown");
    expect(errorCopyKey("nope")).toBe("errors.unknown");
    expect(errorCopyKey(undefined)).toBe("errors.unknown");
  });

  it("builds the tour page URL", () => {
    expect(tourUrl("http://x", "r1")).toBe("http://x/repos/r1/tour");
  });
});
