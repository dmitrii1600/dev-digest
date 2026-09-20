/* DeleteSkillConfirm — the skill-flavoured `ConfirmModal`: owns the
   `useDeleteSkill` mutation and the `delete.*` copy so the `/skills` grid and
   the editor rail (its second consumer) confirm a delete the same way. Must
   be mounted at page/rail level, never inside a `SkillCard`: `Modal` renders
   in place, so clicks inside it would bubble into the card's `onClick`
   (client/INSIGHTS.md). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { useDeleteSkill } from "@/lib/hooks/skills";

export function DeleteSkillConfirm({
  skill,
  onDeleted,
  onCancel,
}: {
  skill: Skill;
  onDeleted: (skill: Skill) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  return (
    <ConfirmModal
      title={t("delete.title")}
      body={t("delete.body", { name: skill.name })}
      confirmLabel={t("delete.confirm")}
      cancelLabel={t("delete.cancel")}
      onConfirm={() => del.mutate(skill.id, { onSuccess: () => onDeleted(skill) })}
      onCancel={onCancel}
      busy={del.isPending}
    />
  );
}
