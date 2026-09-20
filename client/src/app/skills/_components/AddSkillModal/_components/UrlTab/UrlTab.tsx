/* UrlTab — paste a public URL → Fetch (the server fetches through its
   guarded UrlFetcher: public hosts only, size-capped, redirects re-checked)
   → preview (name/type editable, body read-only, injection-scan banner) →
   Import. The server re-fetches and re-parses on commit, so nothing shown
   here is trusted back; the skill lands `imported_url` and disabled. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { usePreviewSkillUrlImport, useImportSkillFromUrl } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { ApiError } from "@/lib/api";
import { ImportPreviewFields } from "../ImportPreviewFields";
import { DEFAULT_TYPE } from "../../constants";
import { s } from "../../styles";

export function UrlTab({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = usePreviewSkillUrlImport();
  const doImport = useImportSkillFromUrl();

  const [url, setUrl] = React.useState("");
  const [result, setResult] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);

  const canFetch = url.trim().length > 0 && !preview.isPending;

  const fetchPreview = async () => {
    if (!canFetch) return;
    setResult(null);
    const parsed = await preview.mutateAsync({ url: url.trim() });
    setResult(parsed);
    setName(parsed.name);
    setType(parsed.type);
  };

  const hasCore = result ? result.entries.some((e) => e.kept) : false;

  const confirm = async () => {
    if (!result || !hasCore) return;
    const skill = await doImport.mutateAsync({ url: url.trim(), name: name.trim() || undefined, type });
    toast.success(t("url.success", { name: skill.name }));
    onClose();
  };

  const failure = preview.isError ? preview.error : doImport.isError ? doImport.error : null;

  return (
    <div>
      {!result && (
        <FormField label={t("url.label")} hint={t("url.hint")} required>
          <div style={s.urlRow}>
            <div style={s.urlInput}>
              <TextInput
                value={url}
                onChange={setUrl}
                placeholder={t("url.placeholder")}
                mono
                onKeyDown={(e) => {
                  if (e.key === "Enter") void fetchPreview();
                }}
              />
            </div>
            <Button kind="primary" icon="Link" onClick={fetchPreview} disabled={!canFetch}>
              {preview.isPending ? t("url.fetching") : t("url.fetch")}
            </Button>
          </div>
        </FormField>
      )}

      {failure && (
        <div style={s.error} role="alert">
          {t("url.fetchFailed")}
          {failure instanceof ApiError ? `: ${failure.message}` : null}
        </div>
      )}

      {result && (
        <div>
          <div style={s.sourceRow}>
            <Icon.Link size={13} />
            <span className="mono" style={s.sourceUrl} title={url}>
              {url.trim()}
            </span>
            <Button kind="ghost" size="sm" onClick={() => setResult(null)}>
              {t("url.changeUrl")}
            </Button>
          </div>
          <ImportPreviewFields preview={result} name={name} onName={setName} type={type} onType={setType} />
          <div style={s.actions}>
            <Button kind="ghost" onClick={onClose}>
              {t("drawer.cancel")}
            </Button>
            <Button kind="primary" icon="Upload" onClick={confirm} disabled={!hasCore || doImport.isPending}>
              {doImport.isPending ? t("file.importing") : t("url.import")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
