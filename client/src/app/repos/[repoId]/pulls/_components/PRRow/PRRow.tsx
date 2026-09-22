/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, SEV } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import type { Severity } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { FindingsPreviewCard, useFindingsPreview } from "@/components/findings-preview";
import { usePrReviews } from "@/lib/hooks/reviews";
import { SIZE_COLOR, STATUS_META } from "@/app/repos/[repoId]/pulls/constants";
import { latestReviewFindings, relativeTime, sizeOf } from "@/app/repos/[repoId]/pulls/helpers";
import { s } from "@/app/repos/[repoId]/pulls/styles";

/** Severity levels, most severe first. */
const CHIP_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed

  // Hover preview. The findings themselves are NOT on the list payload — they
  // are fetched lazily from the same query the PR page uses (key ["reviews",
  // prId]), so hovering warms the cache and the subsequent click renders
  // instantly. Nothing is requested until the pointer actually lands.
  const { anchor, open: openPreview, scheduleClose, cancelClose } = useFindingsPreview();
  const [chipFilter, setChipFilter] = React.useState<Severity | null>(null);
  const { data: reviews, isLoading: previewLoading } = usePrReviews(anchor ? pr.id : null);

  const counts = pr.findings_counts;
  const presentSeverities = counts ? CHIP_ORDER.filter((sev) => counts[sev] > 0) : [];

  // The chip filter is per-hover, so it dies with the card.
  const closePreview = React.useCallback(
    () => scheduleClose(() => setChipFilter(null)),
    [scheduleClose],
  );

  const previewFindings = React.useMemo(() => {
    const all = latestReviewFindings(reviews);
    return chipFilter ? all.filter((f) => f.severity === chipFilter) : all;
  }, [reviews, chipFilter]);
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div
        style={s.findingsCell}
        onMouseEnter={(e) => openPreview(e.currentTarget)}
        onMouseLeave={closePreview}
      >
        {presentSeverities.length === 0 ? (
          <span style={s.muted}>{counts ? 0 : "—"}</span>
        ) : (
          presentSeverities.map((sev) => {
            const tok = SEV[sev];
            const I = Icon[tok.icon];
            const on = chipFilter === sev;
            return (
              <button
                key={sev}
                type="button"
                aria-pressed={on}
                title={t(on ? "panel.clearSeverityFilter" : "panel.filterBySeverity")}
                onClick={(e) => {
                  // The row navigates on click; filtering the preview must not.
                  e.stopPropagation();
                  openPreview(e.currentTarget.parentElement ?? e.currentTarget);
                  setChipFilter((cur) => (cur === sev ? null : sev));
                }}
                style={s.findingsChip(tok.c, on)}
              >
                <I size={12} />
                <span className="tnum">{counts![sev]}</span>
              </button>
            );
          })
        )}
        {anchor && (
          <FindingsPreviewCard
            findings={previewFindings}
            top={anchor.top}
            left={anchor.left}
            loading={previewLoading}
            onMouseEnter={cancelClose}
            onMouseLeave={closePreview}
          />
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostBadge costUsd={pr.cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
