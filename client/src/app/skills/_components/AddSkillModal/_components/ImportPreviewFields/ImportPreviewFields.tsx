/* ImportPreviewFields — the preview step shared by the File and URL tabs:
   editable name and type (the only fields the server takes from the client
   on commit), the parsed body read-only, and the injection-scan banner when
   the server flagged it. Second consumer inside the modal → promoted here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { SecurityBanner } from "@/app/skills/_components/SecurityBanner";
import { SKILL_TYPES } from "@/app/skills/_components/SkillCard/constants";
import { s } from "../../styles";

export function ImportPreviewFields({
  preview,
  name,
  onName,
  type,
  onType,
}: {
  preview: SkillImportPreview;
  name: string;
  onName: (v: string) => void;
  type: SkillType;
  onType: (v: SkillType) => void;
}) {
  const t = useTranslations("skills");
  return (
    <>
      <SecurityBanner report={preview.security} note={t("security.importNote")} />
      <div style={s.section}>
        <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
          <TextInput value={name} onChange={onName} placeholder={t("file.namePlaceholder")} />
        </FormField>
        <FormField label={t("config.type")}>
          <SelectInput
            value={type}
            onChange={(v) => onType(v as SkillType)}
            options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
          />
        </FormField>
      </div>
      <div style={s.section}>
        <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
          <div style={s.bodyBox} className="mono">
            {preview.body || "—"}
          </div>
        </FormField>
      </div>
    </>
  );
}
