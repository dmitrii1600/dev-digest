/* SeverityPills — the "2 CRITICAL · 1 WARNING" row inside an expanded review
   run. Each pill toggles a filter on the findings listed below it: click to
   narrow to that severity, click the same pill again to restore the full list.

   Colours, icons and labels come from the canonical SEV token map in
   @devdigest/ui rather than a local copy. The badge LAYOUT is hand-rolled
   instead of reusing <SeverityBadge> because that primitive renders
   label-then-count ("CRITICAL 2"), and this row reads count-first. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity, SeverityCounts } from "@devdigest/shared";
import { PILL_ORDER } from "./helpers";

export function SeverityPills({
  counts,
  active,
  onToggle,
}: {
  counts: SeverityCounts;
  /** Currently filtered severity, or null for "show everything". */
  active: Severity | null;
  onToggle: (severity: Severity) => void;
}) {
  const t = useTranslations("prReview");
  // Only severities that actually occur get a pill — an empty level is noise,
  // not information.
  const present = PILL_ORDER.filter((sev) => counts[sev] > 0);
  if (present.length === 0) return null;

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
    >
      {present.map((sev) => {
        const tok = SEV[sev];
        const I = Icon[tok.icon];
        const on = active === sev;
        return (
          <button
            key={sev}
            type="button"
            aria-pressed={on}
            title={on ? t("panel.clearSeverityFilter") : t("panel.filterBySeverity")}
            onClick={() => onToggle(sev)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              color: tok.c,
              background: tok.bg,
              // The active pill is outlined, not merely tinted: colour alone
              // would not signal "filtered" to a low-vision reader.
              // Longhand per the convention in ../FindingCard/styles.ts.
              borderStyle: "solid",
              borderWidth: 1,
              borderColor: on ? tok.c : "transparent",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              cursor: "pointer",
            }}
          >
            <I size={12.5} />
            <span className="tnum">{counts[sev]}</span>
            {tok.label}
          </button>
        );
      })}
      {active && (
        <button
          type="button"
          onClick={() => onToggle(active)}
          style={{
            background: "none",
            borderStyle: "none",
            padding: 0,
            font: "inherit",
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          {t("panel.showAllSeverities")}
        </button>
      )}
    </div>
  );
}

export default SeverityPills;
