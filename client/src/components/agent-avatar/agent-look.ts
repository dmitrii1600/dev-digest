/* agent-look — the icon + colour a built-in reviewer is drawn with.
   Keyed by EXACT name; any other name (custom agents, null) gets the neutral look. */
import type { IconName } from "@devdigest/ui";

export interface AgentLook {
  icon: IconName;
  color: string;
}

const NEUTRAL: AgentLook = { icon: "Cpu", color: "#6b7280" };

const LOOKS: Record<string, AgentLook> = {
  "Security Reviewer": { icon: "Shield", color: "#ef4444" },
  "Performance Reviewer": { icon: "Zap", color: "#f59e0b" },
  "Test Quality Reviewer": { icon: "Lightbulb", color: "#3b82f6" },
  "API Contract Reviewer": { icon: "Users", color: "#8b5cf6" },
  "General Reviewer": { icon: "Boxes", color: "#10b981" },
};

export function agentLook(name: string | null | undefined): AgentLook {
  if (name && Object.prototype.hasOwnProperty.call(LOOKS, name)) return LOOKS[name]!;
  return NEUTRAL;
}
