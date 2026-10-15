/* ConfigureStep — step 3: triggers and where results are posted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiPostAs, CiTrigger } from "@devdigest/shared";
import { POST_AS, TRIGGERS } from "../../constants";
import { s } from "../../styles";

export function ConfigureStep({
  triggers,
  onTriggers,
  postAs,
  onPostAs,
  edited,
}: {
  triggers: CiTrigger[];
  onTriggers: (next: CiTrigger[]) => void;
  postAs: CiPostAs;
  onPostAs: (p: CiPostAs) => void;
  edited: boolean;
}) {
  const t = useTranslations("ci");
  const toggle = (tr: CiTrigger) =>
    onTriggers(triggers.includes(tr) ? triggers.filter((x) => x !== tr) : TRIGGERS.filter((x) => x === tr || triggers.includes(x)));
  return (
    <div style={s.group}>
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend style={s.legend}>{t("wizard.configure.triggers")}</legend>
        <div style={s.chips}>
          {TRIGGERS.map((tr) => {
            const on = triggers.includes(tr);
            return (
              <label key={tr} style={s.chip(on)}>
                <input type="checkbox" style={s.srOnly} checked={on} onChange={() => toggle(tr)} />
                {on && <Icon.Check size={13} />}
                {t(`wizard.configure.${tr}`)}
              </label>
            );
          })}
        </div>
        {triggers.length === 0 && <p style={{ ...s.error, marginTop: 8 }}>{t("wizard.configure.triggerRequired")}</p>}
      </fieldset>
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend style={s.legend}>{t("wizard.configure.postAs")}</legend>
        <div style={s.radios}>
          {POST_AS.map((p) => {
            const on = postAs === p.value;
            return (
              <div key={p.value} style={s.row}>
                <label style={s.radioRow}>
                  <input type="radio" name="ci-post-as" style={s.radio(on)} checked={on} onChange={() => onPostAs(p.value)} />
                  <span style={s.radioLabel(on)}>{t(`wizard.configure.${p.key}`)}</span>
                </label>
                {p.value === "github_review" && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("wizard.configure.recommended")}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      {edited && <p style={s.note}>{t("wizard.configure.editedNote")}</p>}
      <p style={s.note}>{t("wizard.configure.secretNote")}</p>
      <p style={s.note}>{t("wizard.configure.tokenNote")}</p>
      <p style={s.note}>{t("wizard.configure.blockNote")}</p>
    </div>
  );
}
