/* PreviewStep — step 2: the files the server will write; the workflow is the only editable one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CI_MAX_BYTES, type CiFile, type CiPreview } from "@devdigest/shared";
import { s } from "../../styles";
import type { WorkflowCheck } from "../../helpers";

export function PreviewStep({
  preview,
  loading,
  workflowText,
  check,
  onEdit,
}: {
  preview: CiPreview | undefined;
  loading: boolean;
  workflowText: string;
  check: WorkflowCheck;
  onEdit: (text: string) => void;
}) {
  const t = useTranslations("ci");
  const [selected, setSelected] = React.useState<string | null>(null);
  if (loading || !preview) return <p style={s.note}>{t("wizard.preview.loading")}</p>;
  const files: CiFile[] = preview.files;
  const current = files.find((f) => f.path === selected) ?? files.find((f) => f.editable) ?? files[0];
  return (
    <div style={s.group}>
      {preview.bundle_missing && <p style={s.error}>{t("wizard.preview.bundleMissing")}</p>}
      {preview.skipped_skills.map((name) => (
        <p key={name} style={s.note}>
          {t("wizard.preview.skipped", { name })}
        </p>
      ))}
      <span style={s.sectionLabel}>{t("wizard.preview.filesToCreate")}</span>
      <div style={s.files}>
        <ul style={{ ...s.fileList, listStyle: "none", margin: 0, padding: 0 }}>
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                style={s.fileBtn(f.path === current?.path)}
                aria-pressed={f.path === current?.path}
                onClick={() => setSelected(f.path)}
              >
                {f.path}
                {f.editable && <em> · {t("wizard.preview.editable")}</em>}
              </button>
            </li>
          ))}
        </ul>
        {current?.editable ? (
          <textarea
            aria-label={current.path}
            value={workflowText}
            onChange={(e) => onEdit(e.target.value)}
            style={s.textarea}
            spellCheck={false}
          />
        ) : (
          <pre style={s.code}>{current?.contents}</pre>
        )}
      </div>
      {!check.ok && (
        <p style={s.error}>
          {check.reason === "too_large"
            ? t("wizard.preview.tooLarge", { max: CI_MAX_BYTES })
            : t("wizard.preview.yamlError", { error: check.error })}
        </p>
      )}
    </div>
  );
}
