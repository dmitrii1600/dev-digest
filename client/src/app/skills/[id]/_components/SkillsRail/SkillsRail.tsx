/* SkillsRail — the editor's left column: the same `SkillCard` tiles as the
   `/skills` grid (type, source, version, agent count, toggle, delete) so the
   two screens never disagree about a skill, plus the same **Add Skill**
   modal. Selecting a tile keeps the current tab; deleting the open skill
   returns to the grid. Both modals are mounted here, never inside a card. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@devdigest/ui";
import { AddSkillModal } from "@/app/skills/_components/AddSkillModal";
import { DeleteSkillConfirm } from "@/app/skills/_components/DeleteSkillConfirm";
import { SkillCard } from "@/app/skills/_components/SkillCard";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { s } from "./styles";

export function SkillsRail({ activeId, tab }: { activeId: string; tab: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading } = useSkills();
  const update = useUpdateSkill();
  const [addOpen, setAddOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const deleting = skills?.find((sk) => sk.id === deletingId) ?? null;

  return (
    <div style={s.rail}>
      {addOpen && <AddSkillModal onClose={() => setAddOpen(false)} />}
      {deleting && (
        <DeleteSkillConfirm
          skill={deleting}
          onDeleted={(deleted) => {
            setDeletingId(null);
            if (deleted.id === activeId) router.push("/skills");
          }}
          onCancel={() => setDeletingId(null)}
        />
      )}
      <div style={s.head}>
        <div style={s.headRow}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setAddOpen(true)}>
            {t("page.addSkill")}
          </Button>
        </div>
      </div>
      <div style={s.list}>
        {isLoading && (
          <>
            <Skeleton height={110} />
            <Skeleton height={110} />
          </>
        )}
        {(skills ?? []).map((sk) => (
          <SkillCard
            key={sk.id}
            skill={sk}
            active={sk.id === activeId}
            onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
            onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
            onDelete={() => setDeletingId(sk.id)}
          />
        ))}
      </div>
    </div>
  );
}
