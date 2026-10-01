import { describe, it, expect } from "vitest";
import { NAV } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

describe("Project Context nav entry", () => {
  it("sits in WORKSPACE right after Pull Requests and activates on its route", () => {
    const items = NAV.find((g) => g.section === "WORKSPACE")!.items;
    const i = items.findIndex((x) => x.key === "pulls");
    expect(items[i + 1]).toMatchObject({ key: "context", label: "Project Context", href: "/repos/:repoId/context" });
    expect(activeKeyFor("/repos/x/context")).toBe("context");
  });
});
