/* FileTab — `.md` / `.zip` picker → preview (name/type editable, body +
   archive contents read-only, injection-scan banner) → confirm. Nothing is
   written until Confirm: `preview` and `import` both re-parse the exact same
   bytes, read once with `file.arrayBuffer()` and never re-read from disk. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { usePreviewSkillImport, useImportSkill } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { ApiError } from "@/lib/api";
import { ImportPreviewFields } from "../ImportPreviewFields";
import { DEFAULT_TYPE } from "../../constants";
import { s as modal } from "../../styles";
import { ACCEPT } from "./constants";
import { arrayBufferToBase64, discardedEntries, isArchive, keptEntries } from "./helpers";
import { s } from "./styles";

export function FileTab({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = usePreviewSkillImport();
  const doImport = useImportSkill();

  const [file, setFile] = React.useState<File | null>(null);
  const [contentBase64, setContentBase64] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);

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
    toast.success(t("file.success", { name: skill.name }));
    onClose();
  };

  const failure = preview.isError ? preview.error : doImport.isError ? doImport.error : null;

  return (
    <div>
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
          {preview.isPending && <div style={modal.status}>{t("file.importing")}</div>}
        </div>
      )}

      {failure && (
        <div style={modal.error} role="alert">
          {t("drawer.importFailed")}
          {failure instanceof ApiError ? `: ${failure.message}` : null}
        </div>
      )}

      {result && (
        <div>
          <ImportPreviewFields preview={result} name={name} onName={setName} type={type} onType={setType} />

          {archive && (
            <div style={modal.section}>
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

          <div style={modal.actions}>
            <Button kind="ghost" onClick={onClose}>
              {t("drawer.cancel")}
            </Button>
            <Button kind="primary" icon="Upload" onClick={confirm} disabled={!hasCore || doImport.isPending}>
              {doImport.isPending ? t("file.importing") : t("drawer.confirm")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
