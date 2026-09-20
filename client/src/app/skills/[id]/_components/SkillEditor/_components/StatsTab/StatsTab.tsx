"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Donut, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { formatAcceptRate, toDonutSegments } from "./helpers";
import { s } from "./styles";

/** Usage stats — tiles + a by-category donut. Every number here is
 *  agent-attributed (see `SkillStats`'s doc comment): a finding can't be
 *  traced to a skill directly, only to a run of an agent it's attached to.
 *  The caveat is stated below the tiles, not left implicit. */
export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.tiles}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
        <Skeleton height={140} />
      </div>
    );
  }
  if (isError || !stats) {
    return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  const segments = toDonutSegments(stats.by_category);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <MetricCard label={t("stats.agents")} value={stats.agents} />
        <MetricCard label={t("stats.runs")} value={stats.runs_30d} />
        <MetricCard label={t("stats.findings")} value={stats.findings_30d} />
        <MetricCard label={t("stats.acceptRate")} value={formatAcceptRate(stats.accept_rate)} />
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("stats.byCategory")}</div>
        {segments.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("stats.noCategories")}</div>
        ) : (
          <Donut segments={segments} valuePrefix="" />
        )}
      </div>

      <div style={s.caveat}>
        <Icon.Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{t("stats.attributionCaveat")}</span>
      </div>
    </div>
  );
}
