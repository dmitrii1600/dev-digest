"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, FormField, Icon, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { usePreviewSkillImport, useImportSkill } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { ApiError } from "@/lib/api";
import { SKILL_TYPES } from "@/app/skills/_components/SkillListItem/constants";
import { ACCEPT, DRAWER_WIDTH } from "./constants";
import { arrayBufferToBase64, discardedEntries, isArchive, keptEntries } from "./helpers";
import { s } from "./styles";

/** File/zip picker → preview (name/type editable, body + archive contents
 *  read-only) → confirm. Nothing is written until Confirm: `preview` and
 *  `import` both re-parse the exact same bytes, read once with
 *  `file.arrayBuffer()` and never re-read from disk. */
export function AddSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = usePreviewSkillImport();
  const doImport = useImportSkill();

  const [file, setFile] = React.useState<File | null>(null);
  const [contentBase64, setContentBase64] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const pick = async (f: File) => {
    setFile(f);
    setResult(null);
    const buf = await f.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    setContentBase64(b64);
    const parsed = await preview.mutateAsync({ filename: f.name, content_base64: b64 });
    setResult(parsed);
    setName(parsed.name);
    setType(parsed.type);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void pick(f);
  };

  const archive = file != null && isArchive(file.name);
  const hasCore = result ? keptEntries(result.entries).length > 0 : false;

  const confirm = async () => {
    if (!file || !contentBase64 || !hasCore) return;
    const skill = await doImport.mutateAsync({
      filename: file.name,
      content_base64: contentBase64,
      name: name.trim() || undefined,
      type,
    });
    // Same "Imported … disabled until vetted" copy the (not-yet-built) URL
    // path already promises — the message is transport-agnostic.
    toast.success(t("url.success", { name: skill.name }));
    onClose();
  };

  const failure = preview.isError
    ? preview.error
    : doImport.isError
      ? doImport.error
      : null;

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        result && (
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose}>
              {t("drawer.cancel")}
            </Button>
            <Button kind="primary" icon="Upload" onClick={confirm} disabled={!hasCore || doImport.isPending}>
              {doImport.isPending ? t("file.importing") : t("drawer.confirm")}
            </Button>
          </div>
        )
      }
    >
      {!result && (
        <div style={s.picker}>
          <Icon.Upload size={26} style={{ color: "var(--text-muted)" }} />
          <span style={s.pickerLabel}>{t("page.menu.fromFile")}</span>
          <span style={s.pickerHint}>{ACCEPT}</span>
          <input
            style={s.fileInput}
            type="file"
            accept={ACCEPT}
            aria-label={t("page.menu.fromFile")}
            onChange={onFileChange}
          />
          {preview.isPending && <div style={s.status}>{t("file.importing")}</div>}
        </div>
      )}

      {failure && (
        <div style={s.error} role="alert">
          {t("drawer.importFailed")}
          {failure instanceof ApiError ? `: ${failure.message}` : null}
        </div>
      )}

      {result && (
        <div>
          <div style={s.section}>
            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
              <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
            </FormField>
            <FormField label={t("config.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
              />
            </FormField>
          </div>

          <div style={s.section}>
            <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
              <div style={s.bodyBox} className="mono">
                {result.body || "—"}
              </div>
            </FormField>
          </div>

          {archive && (
            <div style={s.section}>
              <div style={s.entriesTitle}>
                <span>{t("archive.entriesTitle")}</span>
                <Badge color="var(--text-muted)">{result.discarded}</Badge>
              </div>
              {[...keptEntries(result.entries), ...discardedEntries(result.entries)].map((e) => (
                <div key={e.path} style={s.entryRow}>
                  <Badge color={e.kept ? "var(--ok)" : "var(--text-muted)"} icon={e.kept ? "Check" : "X"}>
                    {e.kept ? t("archive.kept") : t("archive.discarded")}
                  </Badge>
                  <span style={s.entryPath}>{e.path}</span>
                  <span style={s.entryReason}>{e.reason}</span>
                </div>
              ))}
              {!hasCore && (
                <div style={s.notice}>
                  <Icon.AlertTriangle size={14} style={{ color: "var(--crit)", flexShrink: 0 }} />
                  <span>{t("archive.noCore")}</span>
                </div>
              )}
              <div style={s.notice}>
                <Icon.Shield size={14} style={{ color: "var(--ok)", flexShrink: 0 }} />
                <span>{t("archive.nothingExecuted")}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
