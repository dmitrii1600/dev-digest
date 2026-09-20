import { describe, it, expect } from "vitest";
import { currentVersion, isCurrent } from "./helpers";

const V = [{ version: 2 }, { version: 5 }, { version: 1 }];

describe("VersionsTab helpers", () => {
  it("isCurrent marks only the highest version", () => {
    expect(isCurrent(5, V)).toBe(true);
    expect(isCurrent(2, V)).toBe(false);
    expect(isCurrent(1, [])).toBe(false);
  });

  it("currentVersion is the highest version regardless of order", () => {
    expect(currentVersion(V)).toEqual({ version: 5 });
    expect(currentVersion([{ version: 3 }])).toEqual({ version: 3 });
    expect(currentVersion([])).toBeNull();
  });
});
