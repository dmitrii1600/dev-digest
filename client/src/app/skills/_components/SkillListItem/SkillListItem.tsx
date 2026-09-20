"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TYPE_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "@/lib/skill-tokens";
import { needsVetting } from "./helpers";
import { s } from "./styles";

/** One row in the Skills Lab rail — name, type badge, source badge, enabled
 *  toggle. An unvetted `imported_*` skill (disabled by default on import)
 *  shows a "needs vetting" badge instead of the source badge. */
export function SkillListItem({
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
    <div onClick={onClick} style={s.row(!!active, skill.enabled)} role="button" tabIndex={0}>
      <div style={s.main}>
        <div style={s.nameRow}>
          <span style={s.typeDot(color)} />
          <span style={s.name}>{skill.name}</span>
        </div>
        <div style={s.badgeRow}>
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
        </div>
      </div>
      {onToggle && (
        <div style={s.toggleWrap} onClick={(e) => e.stopPropagation()}>
          <Toggle on={skill.enabled} onChange={onToggle} size={14} />
        </div>
      )}
    </div>
  );
}
