import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AgentAvatar } from "./AgentAvatar";
import { agentLook } from "./agent-look";

describe("agentLook", () => {
  it("maps the five built-in names exactly", () => {
    expect(agentLook("Security Reviewer")).toEqual({ icon: "Shield", color: "#ef4444" });
    expect(agentLook("Performance Reviewer")).toEqual({ icon: "Zap", color: "#f59e0b" });
    expect(agentLook("Test Quality Reviewer")).toEqual({ icon: "Lightbulb", color: "#3b82f6" });
    expect(agentLook("API Contract Reviewer")).toEqual({ icon: "Users", color: "#8b5cf6" });
    expect(agentLook("General Reviewer")).toEqual({ icon: "Boxes", color: "#10b981" });
  });

  it.each(["security reviewer", "Security Reviewer v2", "", null, undefined, "toString"])(
    "falls back to the neutral look for %j",
    (name) => {
      expect(agentLook(name)).toEqual({ icon: "Cpu", color: "#6b7280" });
    },
  );
});

describe("AgentAvatar", () => {
  it("renders a decorative tile for the agent's icon", () => {
    const { container } = render(<AgentAvatar name="Security Reviewer" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.dataset.icon).toBe("Shield");
  });
});
