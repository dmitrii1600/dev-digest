/* FindingsPreviewCard — the hover preview behind the PR list's FINDINGS column.
   Strictly READ-ONLY: severity, title, category, file:line, confidence and a
   two-line rationale, and nothing you can click. Triage actions (Accept /
   Reject) live on the PR page's Review-runs card, where there is room to read a
   finding properly before acting on it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { s, CARD_WIDTH } from "./styles";

/** Viewport margin kept clear when anchoring, so a right-hand column's card
 *  does not hang off-screen. */
const EDGE_GAP = 8;

/**
 * Clamp a preferred left edge so the card stays on screen.
 * Exported for unit tests — jsdom has a window width, so the maths is testable
 * without a real browser.
 */
export function clampLeft(preferredLeft: number, viewportWidth: number): number {
  return Math.max(EDGE_GAP, Math.min(preferredLeft, viewportWidth - CARD_WIDTH - EDGE_GAP));
}

export function FindingsPreviewCard({
  findings,
  top,
  left,
  loading = false,
  titleKey = "title",
  onMouseEnter,
  onMouseLeave,
}: {
  findings: FindingRecord[];
  top: number;
  left: number;
  loading?: boolean;
  /** Which heading to use. The PR list says "N FINDINGS IN THIS RUN" because the
   *  row itself gives no clue which run the counts came from; a timeline row IS
   *  a run, so it uses the shorter "N FINDINGS". */
  titleKey?: "title" | "titleShort";
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const t = useTranslations("prReview");

  return (
    <div
      role="tooltip"
      style={s.card(top, left)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // The row underneath navigates on click; the preview is not part of that
      // target, so a stray click inside it must not open the PR.
      onClick={(e) => e.stopPropagation()}
    >
      <div style={s.header}>
        <Icon.AlertOctagon size={12} />
        {t(`preview.${titleKey}`, { count: findings.length })}
      </div>

      {loading ? (
        <div style={s.empty}>…</div>
      ) : findings.length === 0 ? (
        <div style={s.empty}>{t("preview.empty")}</div>
      ) : (
        findings.map((f) => {
          const tok = SEV[f.severity as Severity];
          const I = Icon[tok.icon];
          return (
            <div key={f.id} style={s.row}>
              <div style={s.titleLine}>
                <I size={13} style={{ color: tok.c, flexShrink: 0 }} />
                <span style={s.title}>{f.title}</span>
                <span style={{ flex: 1 }} />
                <CategoryTag category={f.category} />
              </div>
              <div style={s.metaLine}>
                <span className="mono" style={s.location}>
                  {f.file}:{f.start_line}
                  {f.end_line > f.start_line ? `-${f.end_line}` : ""}
                </span>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div style={s.rationale}>{f.rationale}</div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default FindingsPreviewCard;
