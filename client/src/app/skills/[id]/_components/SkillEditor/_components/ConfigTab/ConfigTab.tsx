"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { SecurityBanner } from "@/app/skills/_components/SecurityBanner";
import { isFlagged } from "@/app/skills/_components/SkillCard/helpers";
import { s as cardStyles } from "@/app/skills/_components/SkillCard/styles";
import { SKILL_TYPE_VALUES } from "./constants";
import { bodyChanged } from "./helpers";
import { s } from "./styles";

const noop = () => {};

/** Config tab — name/description/type/body + enabled toggle + a "what
 *  changed" note (recorded on the version the save creates, only when the
 *  body actually changed). Same idiom as the agent editor's ConfigTab: one
 *  `useState` per field, a `useEffect` keyed on the skill id to reset on
 *  selection change, one `save()` calling the mutation. */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [note, setNote] = React.useState("");

  // Reset local form when switching skills.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setNote("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const changed = bodyChanged(skill.body, body);
  // The server's on-read scan: while flagged the Enabled toggle is inert and
  // the save never asks to enable (the API would 422). Saving a clean body
  // refetches the skill, which clears the flag — then the toggle works.
  const flagged = isFlagged(skill);

  const save = () =>
    update.mutate(
      {
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          enabled: flagged ? false : enabled,
          ...(changed && note.trim() ? { note: note.trim() } : {}),
        },
      },
      {
        onSuccess: (data) => {
          toast.success(t("config.savedToast", { version: data.version }));
          setNote("");
        },
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label
          style={flagged ? { ...s.enabledLabel, ...cardStyles.toggleDisabled } : s.enabledLabel}
          title={flagged ? t("security.toggleDisabled") : undefined}
          aria-disabled={flagged || undefined}
        >
          {t("config.enabled")}
          <Toggle on={flagged ? false : enabled} onChange={flagged ? noop : setEnabled} size={16} />
        </label>
      </div>
      <SecurityBanner report={skill.security} />
      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("config.description")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
        <Textarea value={body} onChange={setBody} rows={10} mono />
      </FormField>
      <FormField label={t("config.note")} hint={changed ? t("config.noteHint") : undefined}>
        <TextInput
          value={note}
          onChange={setNote}
          placeholder={t("config.notePlaceholder")}
          disabled={!changed}
        />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
