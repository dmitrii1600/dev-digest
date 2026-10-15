/* TargetStep — step 1 of the Export to CI wizard: the one target and the repository. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "../../styles";

export function TargetStep({
  repos,
  repo,
  onRepo,
}: {
  repos: string[];
  repo: string;
  onRepo: (r: string) => void;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.group}>
      <div style={s.card(true)} aria-current="true">
        <strong>{t("wizard.target.gha")}</strong>
        <span style={s.cardDesc}>{t("wizard.target.ghaDesc")}</span>
      </div>
      {repos.length === 0 ? (
        <p style={s.note}>{t("wizard.target.noRepos")}</p>
      ) : (
        <label style={s.label}>
          {t("wizard.target.repoLabel")}
          <select value={repo} onChange={(e) => onRepo(e.target.value)} style={s.select}>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
