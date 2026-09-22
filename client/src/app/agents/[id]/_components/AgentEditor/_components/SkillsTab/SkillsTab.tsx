/* SkillsTab — agent editor Skills tab. One list of EVERY workspace skill:
   drag handle, checkbox (bound to the agent_skills.enabled binding), name,
   type badge. Position is independent of enabled-ness, so the checkbox never
   adds/removes a row — an unchecked skill can sit between two checked ones.
   Checking a never-linked skill lazily creates its binding via one PATCH;
   dragging (or arrow-key reordering on the focused handle) persists the
   whole ordered list via one POST. Only ENABLED rows can be moved: an
   unchecked row keeps its slot but its handle is disabled and it is not
   draggable (criterion 31). See client/specs/02-skills-lab.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Skeleton, TextInput } from "@devdigest/ui";
import { useAgentSkillLinks, useSetAgentSkills, useUpdateAgentSkillLink } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "@/lib/skill-tokens";
import { DRAG_HANDLE_GLYPH } from "./constants";
import { filterRows, mergeSkillRows, moveRow } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const { data: skills } = useSkills();
  const { data: links } = useAgentSkillLinks(agentId);
  const setSkills = useSetAgentSkills(agentId);
  const updateLink = useUpdateAgentSkillLink(agentId);

  const [filter, setFilter] = React.useState("");
  const dragIndex = React.useRef<number | null>(null);

  if (!skills || !links) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={160} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={200} />
        </div>
      </div>
    );
  }

  const rows = mergeSkillRows(skills, links);
  const visibleRows = filterRows(rows, filter);
  const enabledCount = links.filter((l) => l.enabled).length;

  // Reorders the FULL list (not just the filtered view) and persists it in
  // one call — this is what both native drag and arrow-key reordering call.
  // A disabled row is never moved: it cannot start a drag, its handle ignores
  // the keyboard, and a stale dragIndex pointing at one is dropped here too.
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= rows.length) return;
    if (!rows[from]?.enabled) return;
    const next = moveRow(rows, from, to);
    setSkills.mutate({ skill_ids: next.map((row) => row.skill.id) });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("skills.enabledCount", { linked: enabledCount, total: skills.length })}
        </Badge>
        <div style={s.filter}>
          <TextInput value={filter} onChange={setFilter} placeholder={t("skills.filterPlaceholder")} />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>
      <div style={s.list}>
        {visibleRows.map((row) => {
          // Reorder operates on the full (unfiltered) list, so look up this
          // row's real index there rather than its index in `visibleRows`.
          const index = rows.findIndex((r) => r.skill.id === row.skill.id);
          const color = SKILL_TYPE_COLOR[row.skill.type] ?? SKILL_TYPE_COLOR_FALLBACK;
          return (
            <div
              key={row.skill.id}
              style={s.row(row.enabled)}
              draggable={row.enabled}
              onDragStart={(e) => {
                if (!row.enabled) {
                  e.preventDefault();
                  return;
                }
                dragIndex.current = index;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex.current != null) reorder(dragIndex.current, index);
                dragIndex.current = null;
              }}
            >
              <button
                type="button"
                style={s.handle(row.enabled)}
                aria-label={t("skills.dragHandle", { name: row.skill.name })}
                aria-disabled={!row.enabled}
                onKeyDown={(e) => {
                  if (!row.enabled) return;
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    reorder(index, index - 1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    reorder(index, index + 1);
                  }
                }}
              >
                {DRAG_HANDLE_GLYPH}
              </button>
              <Checkbox
                checked={row.enabled}
                onChange={(next) => updateLink.mutate({ skillId: row.skill.id, enabled: next })}
              />
              <span className="mono" style={s.name}>
                {row.skill.name}
              </span>
              <Badge color={color} style={s.typeBadge}>
                {row.skill.type}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
