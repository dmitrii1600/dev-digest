/* SkillCard — one skill tile, used by BOTH the `/skills` grid and the editor's
   rail so the two screens show the same data: type-tinted icon, name, enabled
   toggle, delete, description, and the type / source / version / agent-count
   badges. Clicking the tile opens the editor; the toggle flips `enabled` in
   place and the trash button asks the owner to confirm — both stop
   propagation so they never navigate. A `flagged` skill (the server's
   injection scan tripped) shows a red badge instead of its source and its
   toggle is inert: the server would answer 422 anyway. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TYPE_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "@/lib/skill-tokens";
import { isFlagged, needsVetting } from "./helpers";
import { s } from "./styles";

const noop = () => {};

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
  onDelete,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("skills");
  const color = SKILL_TYPE_COLOR[skill.type] ?? SKILL_TYPE_COLOR_FALLBACK;
  const vetting = needsVetting(skill.source, skill.enabled);
  const flagged = isFlagged(skill);

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)} role="button" tabIndex={0}>
      <div style={s.headerRow}>
        <div style={s.iconBox(color)}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={flagged ? s.toggleDisabled : undefined}
            title={flagged ? t("security.toggleDisabled") : undefined}
            aria-disabled={flagged || undefined}
          >
            <Toggle on={skill.enabled} onChange={flagged ? noop : onToggle} size={14} />
          </div>
        )}
        {onDelete && (
          <div onClick={(e) => e.stopPropagation()}>
            <IconBtn icon="Trash" label={t("card.delete")} size={26} danger onClick={onDelete} />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={color} bg={color + "1a"}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        {flagged ? (
          <span title={t("security.flaggedTitle")}>
            <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
              {t("security.flagged")}
            </Badge>
          </span>
        ) : vetting ? (
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
        <Badge color="var(--text-secondary)" icon="Cpu">
          {t("card.agents", { count: skill.agent_count })}
        </Badge>
      </div>
    </div>
  );
}
