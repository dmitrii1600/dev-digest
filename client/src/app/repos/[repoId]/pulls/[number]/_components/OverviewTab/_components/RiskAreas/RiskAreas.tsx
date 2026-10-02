/* RiskAreas — the brief's risk pills (Overview, under Intent). Each pill is two
   buttons: the main part jumps to the first ref in Files changed, the expander
   opens the explanation and every ref (one open at a time). Model text renders
   as plain text; severity is always a visible word, never colour alone. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { StoredRisk } from "@devdigest/shared";
import { GENERIC_KIND_ICON, KIND_ICON, SEVERITY_COLOR } from "./constants";
import { s } from "./styles";

export function RiskAreas({
  risks,
  onJump,
}: {
  risks: StoredRisk[];
  onJump: (ref: string) => void;
}) {
  const t = useTranslations("brief");
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  if (risks.length === 0) return <p style={s.empty}>{t("noRisks")}</p>;

  return (
    <ul style={s.list}>
      {risks.map((risk, i) => {
        const open = openIndex === i;
        const color = SEVERITY_COLOR[risk.severity] ?? SEVERITY_COLOR.low;
        const KindIcon = Icon[KIND_ICON[risk.kind] ?? GENERIC_KIND_ICON];
        const first = risk.file_refs[0] ?? "";
        return (
          <li key={i} style={s.pill(open, color)}>
            <div style={s.row}>
              <button type="button" style={s.main} onClick={() => onJump(first)}>
                <span style={{ color, display: "inline-flex" }}>
                  <KindIcon size={14} />
                </span>
                <span style={s.title}>{risk.title}</span>
                <span style={s.severity(color)}>{t(`severity.${risk.severity}`)}</span>
                <span className="mono" style={s.ref}>
                  {first}
                </span>
              </button>
              <button
                type="button"
                aria-expanded={open}
                title={t("risk.why")}
                style={s.expander}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                <span style={s.srOnly}>{t("risk.why")}</span>
                <Icon.ChevronDown
                  size={14}
                  style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .12s" }}
                />
              </button>
            </div>
            {open && (
              <div style={s.panel}>
                <p style={s.explanation}>{risk.explanation}</p>
                <div style={s.refs}>
                  {risk.file_refs.map((ref) => (
                    <button
                      key={ref}
                      type="button"
                      className="mono"
                      style={s.refBtn}
                      onClick={() => onJump(ref)}
                    >
                      {ref}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
