/* AgentAvatar — a tinted icon tile for an agent. Decorative (aria-hidden): the
   caller always renders the agent's name next to it. */
import React from "react";
import { Icon } from "@devdigest/ui";
import { agentLook } from "./agent-look";

export function AgentAvatar({
  name,
  size = "md",
}: {
  name: string | null | undefined;
  size?: "sm" | "md";
}) {
  const { icon, color } = agentLook(name);
  const Glyph = Icon[icon];
  const box = size === "sm" ? 22 : 30;
  return (
    <span
      aria-hidden
      data-icon={icon}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: box,
        height: box,
        borderRadius: 8,
        flexShrink: 0,
        color,
        background: `${color}1f`,
      }}
    >
      <Glyph size={size === "sm" ? 13 : 16} />
    </span>
  );
}
