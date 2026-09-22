/* AgentCard — model chip, skills count, enabled toggle. Stats are an A5 mount;
   we render the provider/model + skill count here. The skill count is the
   number of ENABLED skill bindings for this agent — a caller may pass
   `skillCount` to override (e.g. a test), otherwise the card fetches its own
   `agent_skills` and computes it. One extra request per card is cheap
   (client/specs/02-skills-lab.md: "nearly free"). Delete goes through the
   shared `ConfirmModal` — the same one the skill cards use — never
   `window.confirm`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, IconBtn, Toggle } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { useAgentSkillLinks, useDeleteAgent } from "@/lib/hooks/agents";
import { modelColor } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  active,
  skillCount,
  onClick,
  onToggle,
}: {
  ag: Agent;
  active?: boolean;
  skillCount?: number;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  const { data: skillLinks } = useAgentSkillLinks(ag.id);
  const enabledSkillCount = skillCount ?? skillLinks?.filter((l) => l.enabled).length;
  const color = modelColor(ag.model);
  const [confirming, setConfirming] = React.useState(false);
  return (
    <div onClick={onClick} style={s.card(!!active, ag.enabled)}>
      {confirming && (
        // The modal is portal-less, so a click inside it bubbles to the card.
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title={t("card.deleteTitle")}
            body={t("card.deleteBody", { name: ag.name })}
            confirmLabel={t("card.deleteConfirm")}
            cancelLabel={t("card.deleteCancel")}
            busy={del.isPending}
            onCancel={() => setConfirming(false)}
            onConfirm={() => del.mutate(ag.id, { onSuccess: () => setConfirming(false) })}
          />
        </div>
      )}
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <span style={s.name}>{ag.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={ag.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <div onClick={(e) => e.stopPropagation()}>
          <IconBtn icon="Trash" label={t("card.deleteLabel")} size={26} danger onClick={() => setConfirming(true)} />
        </div>
      </div>
      <div style={s.description}>{ag.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.modelChip(color)}>
          {ag.model}
        </span>
        {enabledSkillCount != null && (
          <Badge color="var(--text-secondary)" icon="Sparkles">
            {t("card.skillCount", { count: enabledSkillCount })}
          </Badge>
        )}
      </div>
    </div>
  );
}
