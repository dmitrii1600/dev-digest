/* MetricDelta — a signed change as text, not colour alone (NFR-8):
   "▲ +3.0 pts" / "▼ −2.5 pts" / "= 0.0 pts" / "—". The vendored MetricCard
   delta is icon-only and unsigned, so tiles render this inside their value. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatDeltaCases, formatDeltaPoints, NOT_AVAILABLE } from "../format";

export type MetricDeltaUnit = "points" | "cases";

export function MetricDelta({ value, unit }: { value: number | null | undefined; unit: MetricDeltaUnit }) {
  const t = useTranslations("eval");
  if (value == null) {
    return (
      <span className="tnum" style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {NOT_AVAILABLE}
      </span>
    );
  }
  const text = unit === "points" ? formatDeltaPoints(value) : formatDeltaCases(value);
  const neutral = text === "0.0" || text === "0";
  const glyph = neutral ? "=" : value > 0 ? "▲" : "▼";
  const color = neutral ? "var(--text-muted)" : value > 0 ? "var(--ok)" : "var(--crit)";
  return (
    <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color, whiteSpace: "nowrap" }}>
      {glyph} {t(unit === "points" ? "metrics.points" : "metrics.cases", { value: text })}
    </span>
  );
}
