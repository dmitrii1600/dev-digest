/* SkillCard — one skill in the `/skills` grid: type-tinted icon, name, enabled
   toggle, description, and the type / source / version badges. Mirrors
   `agents/_components/AgentCard` so both Skills Lab lists behave the same way:
   clicking the card opens the editor, the toggle flips `enabled` in place. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TYPE_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "@/lib/skill-tokens";
import { needsVetting } from "../SkillListItem/helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const color = SKILL_TYPE_COLOR[skill.type] ?? SKILL_TYPE_COLOR_FALLBACK;
  const vetting = needsVetting(skill.source, skill.enabled);

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)} role="button" tabIndex={0}>
      <div style={s.headerRow}>
        <div style={s.iconBox(color)}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={color} bg={color + "1a"}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        {vetting ? (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        ) : (
          <Badge color="var(--text-muted)">{t(`listItem.source.${skill.source}`)}</Badge>
        )}
        <Badge color="var(--text-muted)" mono>
          {t("card.version", { version: skill.version })}
        </Badge>
      </div>
    </div>
  );
}
