/* PromoteConfirm — what promoting a past run's configuration would change, before
   the user commits: each configuration field that differs, each skill-set change,
   skills that no longer exist (they will not be restored, EC-2) and skills whose text
   changed since the run (only the link is restored, EC-3). Confirming records the
   configuration as a NEW version; nothing already recorded is rewritten. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { FIELD_LABEL_KEY, type PromotionDiff } from "../../helpers";
import { s } from "./styles";

export function PromoteConfirm({
  version,
  diff,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  version: number;
  diff: PromotionDiff;
  pending: boolean;
  /** Inline failure text (e.g. the agent changed since Compare was opened); `null` when none. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("eval");
  const tAgents = useTranslations("agents");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const { added, removed, reordered } = diff.skillChanges;
  return (
    <Modal
      width={480}
      title={t("compare.promoteTitle", { version })}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel} disabled={pending}>
            {t("compare.promoteCancel")}
          </Button>
          <Button kind="primary" onClick={onConfirm} loading={pending} disabled={pending}>
            {t("compare.promoteConfirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <ul style={s.list}>
          {diff.fieldChanges.map((f) => (
            <li key={f}>{tAgents(`config.${FIELD_LABEL_KEY[f]}`)}</li>
          ))}
          {added.map((sk) => (
            <li key={`add-${sk.skill_id}`}>{t("compare.promoteSkillAdded", { name: sk.name })}</li>
          ))}
          {removed.map((sk) => (
            <li key={`rm-${sk.skill_id}`}>{t("compare.promoteSkillRemoved", { name: sk.name })}</li>
          ))}
          {reordered && <li>{t("compare.promoteSkillOrder")}</li>}
        </ul>
        {diff.missing.length > 0 && (
          <div style={s.warn}>
            {t("compare.promoteMissing", { names: diff.missing.map((m) => m.name).join(", ") })}
          </div>
        )}
        {diff.versionDrift.map((d) => (
          <div key={d.skill_id} style={s.warn}>
            {t("compare.promoteDrift", { skill: d.name, then: d.then, now: d.now })}
          </div>
        ))}
        {error && (
          <div role="alert" style={s.error}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
