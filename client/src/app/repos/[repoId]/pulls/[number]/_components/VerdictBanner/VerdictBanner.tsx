/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score.
   The PR Brief reuses it through optional props: a null verdict (no review yet),
   an info tooltip, a loading spinner in place of the score, and `actions` /
   `footer` slots. Without them it renders exactly as before. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount = 0,
  blockers = 0,
  agentName,
  info,
  loading,
  actions,
  footer,
}: {
  /** `null` = no review yet: no icon tile, verdict label or findings badge. */
  verdict: Verdict | null;
  summary: string | null;
  score: number | null;
  findingsCount?: number;
  blockers?: number;
  agentName?: string | null;
  /** Tooltip text behind an info icon (also its accessible name). */
  info?: string;
  /** A spinner replaces the score while a brief is being generated. */
  loading?: boolean;
  /** Right-hand controls, before the score (refresh button, Stale marker). */
  actions?: React.ReactNode;
  /** Under the score (cost line). */
  footer?: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const m = verdict ? (VERDICT_META[verdict] ?? VERDICT_META.comment) : null;
  const VIcon = m ? Icon[m.icon] : null;
  const showSide = !!actions || !!footer || !!loading || score != null;
  return (
    <div style={s.wrap}>
      {m && VIcon && (
        <div style={s.iconBox(m.bg, m.c)}>
          <VIcon size={22} />
        </div>
      )}
      <div style={s.main}>
        <div style={s.titleRow}>
          {m && (
            <>
              <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
              <Badge color="var(--text-secondary)">
                {t("verdict.findingsCount", { count: findingsCount })}
                {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
              </Badge>
            </>
          )}
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
          {info && (
            <span role="img" tabIndex={0} title={info} aria-label={info} style={s.info}>
              <Icon.Info size={14} />
            </span>
          )}
        </div>
        {summary && <p style={s.summary}>{summary}</p>}
      </div>
      {showSide && (
        <div style={s.side}>
          {actions && <div style={s.actions}>{actions}</div>}
          {loading ? (
            <div style={s.scoreCol}>
              <span role="status" aria-busy="true" style={s.spinner}>
                <Icon.RefreshCw size={22} style={{ animation: "ddspin 1s linear infinite" }} />
              </span>
            </div>
          ) : (
            score != null && (
              <div style={s.scoreCol}>
                <CircularScore score={score} size={52} stroke={5} />
                <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
              </div>
            )
          )}
          {footer && <div style={s.footer}>{footer}</div>}
        </div>
      )}
    </div>
  );
}
