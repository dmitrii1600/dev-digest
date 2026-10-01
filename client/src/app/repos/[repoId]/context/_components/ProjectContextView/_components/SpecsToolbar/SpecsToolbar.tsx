/* SpecsToolbar — New file · New folder · Upload · Refresh, in that order.
   The first three write to the clone, so they are disabled when the repo is
   not cloned. Owns the hidden file input that Upload opens. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { s } from "../../styles";

export function SpecsToolbar({
  canWrite,
  onNewFile,
  onNewFolder,
  onUpload,
  onRefresh,
}: {
  canWrite: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: (file: File) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("context");
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <div style={s.toolbar}>
      <Button kind="secondary" size="sm" icon="Plus" disabled={!canWrite} onClick={onNewFile}>
        {t("toolbar.newFile")}
      </Button>
      <Button kind="secondary" size="sm" icon="Folder" disabled={!canWrite} onClick={onNewFolder}>
        {t("toolbar.newFolder")}
      </Button>
      <Button kind="secondary" size="sm" icon="Upload" disabled={!canWrite} onClick={() => fileRef.current?.click()}>
        {t("toolbar.upload")}
      </Button>
      <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onRefresh}>
        {t("refresh")}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".md,text/markdown"
        aria-label={t("uploadInput")}
        tabIndex={-1}
        style={s.visuallyHidden}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
    </div>
  );
}
