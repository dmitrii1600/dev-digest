/* SecurityBanner — the server's on-read injection scan, shown wherever an
   imported body is previewed or edited (the import modal's File and URL tabs,
   the editor's Config tab). Renders nothing unless the report is `flagged`.
   Each finding names the rule, the 1-based line and the offending excerpt so
   the author can go straight to it. Three consumers → lives in
   `app/skills/_components/`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SkillSecurityReport } from "@devdigest/shared";
import { s } from "./styles";

export function SecurityBanner({ report, note }: { report: SkillSecurityReport; note?: string }) {
  const t = useTranslations("skills");
  if (report.status !== "flagged") return null;
  return (
    <div style={s.box} role="alert">
      <div style={s.head}>
        <Icon.AlertOctagon size={15} style={s.icon} />
        <span style={s.title}>{t("security.bannerTitle")}</span>
      </div>
      <div style={s.body}>{t("security.bannerBody", { count: report.findings.length })}</div>
      <ul style={s.list}>
        {report.findings.map((f, i) => (
          <li key={`${f.rule}-${f.line}-${i}`} style={s.item}>
            <span style={s.rule}>
              {t("security.finding", { rule: t(`security.rule.${f.rule}`), line: f.line })}
            </span>
            <code className="mono" style={s.excerpt}>
              {f.excerpt}
            </code>
          </li>
        ))}
      </ul>
      {note && <div style={s.note}>{note}</div>}
    </div>
  );
}
