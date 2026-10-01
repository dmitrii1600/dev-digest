/* DocPreviewModal — read-only preview of one clone document. Content goes
   through the Markdown renderer only (never raw HTML). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Markdown, Modal, Skeleton } from "@devdigest/ui";
import { useContextFile } from "@/lib/hooks/project-context";
import { s } from "./styles";

export function DocPreviewModal({ repoId, path, onClose }: { repoId: string; path: string; onClose: () => void }) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextFile(repoId, path);
  return (
    <Modal
      width={800}
      title={t("picker.title")}
      onClose={onClose}
      footer={
        <Button kind="secondary" size="sm" onClick={onClose}>
          {t("picker.close")}
        </Button>
      }
    >
      <div style={s.modalBody}>
        <h3 className="mono" style={s.modalPath}>
          {path}
        </h3>
        {isError ? (
          <ErrorState title={t("previewError")} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <Skeleton height={160} />
        ) : (
          <Markdown>{data.content}</Markdown>
        )}
      </div>
    </Modal>
  );
}
