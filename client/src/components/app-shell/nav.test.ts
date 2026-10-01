import { describe, it, expect } from "vitest";
import { NAV } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

describe("WORKSPACE nav entries", () => {
  it("lists Pull Requests, Onboarding Tour, Project Context in that order", () => {
    const items = NAV.find((g) => g.section === "WORKSPACE")!.items;
    const i = items.findIndex((x) => x.key === "pulls");
    expect(items[i + 1]).toMatchObject({
      key: "onboarding-tour",
      label: "Onboarding Tour",
      href: "/repos/:repoId/tour",
    });
    expect(items[i + 2]).toMatchObject({ key: "context", label: "Project Context", href: "/repos/:repoId/context" });
  });

  it("activates each entry on its own route, and leaves Add repository unselected", () => {
    expect(activeKeyFor("/repos/x/tour")).toBe("onboarding-tour");
    expect(activeKeyFor("/onboarding")).toBe("");
    expect(activeKeyFor("/repos/x/context")).toBe("context");
  });
});
