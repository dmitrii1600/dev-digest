"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { isUntrustedSource } from "./helpers";
import { s } from "./styles";

/** Read-only rendered Markdown of the skill body — no editing here, that's
 *  the Config tab's job. Shows the untrusted-source notice the body already
 *  carries once it reaches a prompt (delimiter-wrapped, per `prompt.ts`). */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      {isUntrustedSource(skill.source) && (
        <div style={s.notice}>
          <Icon.AlertTriangle size={16} style={{ color: "var(--crit)", flexShrink: 0 }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}
      <div style={s.bodyLabel}>{t("preview.bodyLabel")}</div>
      <div style={s.bodyBox}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
