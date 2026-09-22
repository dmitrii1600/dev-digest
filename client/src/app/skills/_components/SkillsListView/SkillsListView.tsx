"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { AddSkillModal } from "../AddSkillModal";
import { DeleteSkillConfirm } from "../DeleteSkillConfirm";
import { filterSkills } from "./helpers";
import { s } from "./styles";

/** `/skills` — a card grid, same shape as `/agents`. A card click opens the
 *  editor at `/skills/[id]?tab=config`; the toggle and the trash button stop
 *  propagation so they never navigate. **Add Skill** opens `AddSkillModal`
 *  (Create / From file / Import from URL) — the same modal the editor rail
 *  opens. Delete goes through `DeleteSkillConfirm`, mounted here (not in the
 *  card) because `Modal` renders in place. */
export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const list = filterSkills(skills ?? [], search);
  const deleting = skills?.find((sk) => sk.id === deletingId) ?? null;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {addOpen && <AddSkillModal onClose={() => setAddOpen(false)} />}
      {deleting && (
        <DeleteSkillConfirm
          skill={deleting}
          onDeleted={() => setDeletingId(null)}
          onCancel={() => setDeletingId(null)}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setAddOpen(true)}>
            {t("page.addSkill")}
          </Button>
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setAddOpen(true)}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                onClick={() => router.push(`/skills/${sk.id}?tab=config`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                onDelete={() => setDeletingId(sk.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
