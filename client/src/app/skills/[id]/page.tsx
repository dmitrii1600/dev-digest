/* /skills/:id — Skill Editor (L02). Left skill rail + Config/Preview/Versions/
   Stats tabs. Tab state lives in ?tab=. Master-detail layout copied from
   /agents/[id]/page.tsx — same idiom, same 280px rail. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { SkillListItem } from "@/app/skills/_components/SkillListItem";
import { AddSkillDrawer } from "@/app/skills/_components/SkillsListView/_components/AddSkillDrawer";
import { useSkills, useSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "@/lib/skill-tokens";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { SkillEditor } from "./_components/SkillEditor";
import { VALID_TABS } from "./_components/SkillEditor/constants";

export default function SkillEditorPage() {
  const t = useTranslations("skills");
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const update = useUpdateSkill();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (tb: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", tb);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {drawerOpen && <AddSkillDrawer onClose={() => setDrawerOpen(false)} />}
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* left: skill rail */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{t("page.heading")}</h1>
              <Button kind="primary" size="sm" icon="Plus" onClick={() => setDrawerOpen(true)}>
                {t("page.addSkill")}
              </Button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
            {(skills ?? []).map((sk) => (
              <SkillListItem
                key={sk.id}
                skill={sk}
                active={sk.id === id}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !skill ? (
          <div style={{ flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ padding: "16px 28px 0", flexShrink: 0 }}>
              <a href="/skills" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {t("detail.back")}
              </a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 28px 0", flexShrink: 0 }}>
              <Icon.Sparkles size={18} style={{ color: SKILL_TYPE_COLOR[skill.type] ?? SKILL_TYPE_COLOR_FALLBACK }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
              <Badge color={SKILL_TYPE_COLOR[skill.type] ?? SKILL_TYPE_COLOR_FALLBACK}>
                {t(`listItem.type.${skill.type}`)}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <SkillEditor skill={skill} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
