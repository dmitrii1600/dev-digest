/* CreateTab — hand-typed skill creation inside AddSkillModal. Same form
   idiom as the editor's ConfigTab: one `useState` per field, no form
   library, no client-side zod; validation is the server's and mutation
   errors are toasted by the MutationCache. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { SKILL_TYPES } from "@/app/skills/_components/SkillCard/constants";
import { DEFAULT_TYPE } from "../../constants";
import { s } from "../../styles";

export function CreateTab({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("");

  const canCreate = name.trim().length > 0 && body.trim().length > 0;

  const submit = () => {
    if (!canCreate) return;
    create.mutate(
      { name: name.trim(), description: description.trim(), type, body },
      {
        onSuccess: (skill) => {
          toast.success(t("create.successToast", { name: skill.name }));
          onClose();
        },
      },
    );
  };

  return (
    <div>
      <FormField label={t("create.name")} required>
        <TextInput value={name} onChange={setName} placeholder={t("create.namePlaceholder")} mono />
      </FormField>
      <FormField label={t("create.description")}>
        <TextInput value={description} onChange={setDescription} placeholder={t("create.descriptionPlaceholder")} />
      </FormField>
      <FormField label={t("create.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
      <FormField label={t("create.body")} required>
        <Textarea value={body} onChange={setBody} placeholder={t("create.bodyPlaceholder")} rows={10} mono />
      </FormField>
      <div style={s.actions}>
        <Button kind="ghost" onClick={onClose}>
          {t("create.cancel")}
        </Button>
        <Button kind="primary" icon="Plus" onClick={submit} disabled={!canCreate || create.isPending}>
          {create.isPending ? t("create.creating") : t("create.create")}
        </Button>
      </div>
    </div>
  );
}
