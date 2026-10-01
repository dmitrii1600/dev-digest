/* ContextDocsPicker — attach / reorder clone Markdown documents. Used by the
   Agent editor's and the Skill editor's Context tabs; it holds no mutation, the
   tabs own the hooks and pass `onChange`. Attached rows come first in
   injection order; only attached rows can be moved (drag, or ArrowUp/Down on
   the handle). The token estimate is derived from the listing: no fetch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import type { ContextFileList } from "@devdigest/shared";
import { DocPreviewModal } from "./DocPreviewModal";
import { estimateTokens, filterDocs, mergeDocRows, moveRow } from "./helpers";
import { s } from "./styles";

const DRAG_HANDLE_GLYPH = "≡";

export interface ContextListState {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function ContextDocsPicker({
  repoId,
  list,
  listState,
  attached,
  onChange,
}: {
  repoId: string | null;
  list: ContextFileList | undefined;
  listState: ContextListState;
  attached: string[];
  onChange: (paths: string[]) => void;
}) {
  const t = useTranslations("context");
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const dragIndex = React.useRef<number | null>(null);

  if (!repoId) {
    return <EmptyState icon="Folder" title={t("picker.title")} body={t("picker.noRepo")} />;
  }
  if (listState.isError) {
    return <ErrorState title={t("listError")} onRetry={listState.onRetry} />;
  }
  if (listState.isLoading || !list) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={160} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={200} />
        </div>
      </div>
    );
  }
  if (!list.cloned) {
    return <EmptyState icon="Folder" title={t("notCloned.title")} body={t("notCloned.body")} />;
  }
  if (list.files.length === 0) {
    return <EmptyState icon="FileText" title={t("noFiles.title")} body={t("noFiles.body")} />;
  }

  const rows = mergeDocRows(list.files, attached);
  const visible = filterDocs(rows, filter);
  const tokens = estimateTokens(rows);

  // Attached rows lead `rows`, so a row's index there is its index in `attached`.
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= attached.length) return;
    onChange(moveRow(attached, from, to));
  };
  const toggle = (path: string, next: boolean) =>
    onChange(next ? [...attached.filter((p) => p !== path), path] : attached.filter((p) => p !== path));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("picker.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("picker.attached", { attached: attached.length, total: list.files.length })}
        </Badge>
        <div style={s.filter}>
          <TextInput value={filter} onChange={setFilter} placeholder={t("picker.filterPlaceholder")} />
        </div>
      </div>
      <p style={s.hint}>{t("picker.orderHint")}</p>
      <div style={s.list}>
        {visible.length === 0 && <div style={s.none}>{t("picker.noMatch")}</div>}
        {visible.map((row) => {
          const index = rows.findIndex((r) => r.path === row.path);
          return (
            <div
              key={row.path}
              style={s.row(row.attached)}
              draggable={row.attached}
              onDragStart={(e) => {
                if (!row.attached) {
                  e.preventDefault();
                  return;
                }
                dragIndex.current = index;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex.current != null && row.attached) reorder(dragIndex.current, index);
                dragIndex.current = null;
              }}
            >
              <button
                type="button"
                style={s.handle(row.attached)}
                aria-label={t("picker.dragHandle", { path: row.path })}
                aria-disabled={!row.attached}
                onKeyDown={(e) => {
                  if (!row.attached) return;
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    reorder(index, index - 1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    reorder(index, index + 1);
                  }
                }}
              >
                {DRAG_HANDLE_GLYPH}
              </button>
              <Checkbox
                checked={row.attached}
                onChange={(next) => toggle(row.path, next)}
                label={
                  <span className="mono" style={s.path}>
                    {row.path}
                  </span>
                }
              />
              <span style={s.grow} />
              {row.missing && <Badge color="var(--text-muted)">{t("picker.missing")}</Badge>}
              <Badge color="var(--text-secondary)" style={s.kindBadge}>
                {t(`kind.${row.kind}`)}
              </Badge>
              {!row.missing && (
                <Button
                  kind="secondary"
                  size="sm"
                  aria-label={t("picker.previewFile", { path: row.path })}
                  onClick={() => setPreviewPath(row.path)}
                >
                  {t("picker.preview")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div style={s.footer}>
        {attached.length > 0 && <div style={s.tokens}>{t("picker.tokens", { tokens })}</div>}
        <p style={s.note}>{t("picker.untrustedNote")}</p>
      </div>
      {previewPath && <DocPreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  );
}
