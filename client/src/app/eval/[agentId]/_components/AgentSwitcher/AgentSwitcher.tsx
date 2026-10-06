/* AgentSwitcher — jump to another agent that has eval cases, keeping the selected
   window. It `push`es, so Back returns to the previous agent (AC-13). A native
   <select> under a visible label, so it is keyboard-operable with an accessible name. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { EvalAgentCard } from "@devdigest/shared";
import type { EvalWindow } from "../window";

const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)" };

export function AgentSwitcher({
  agents,
  agentId,
  window,
}: {
  agents: Pick<EvalAgentCard, "agent_id" | "agent_name">[];
  agentId: string;
  window: EvalWindow;
}) {
  const t = useTranslations("eval");
  const router = useRouter();
  const options = agents.map((a) => ({ value: a.agent_id, label: a.agent_name }));
  return (
    <label style={LABEL}>
      {t("agentPage.switcherLabel")}
      <SelectInput
        value={agentId}
        mono={false}
        options={options}
        onChange={(id) => {
          if (id !== agentId) router.push(`/eval/${id}?window=${window}`);
        }}
      />
    </label>
  );
}
