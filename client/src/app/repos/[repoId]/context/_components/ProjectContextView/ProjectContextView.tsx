/* ProjectContextView — /repos/:repoId/context. The clone's Markdown files on
   the left (with the New file / New folder / Upload / Refresh toolbar), the
   selected document on the right: rendered, or — for an untracked file under
   .devdigest/specs/ — editable with an explicit Save. Unsaved edits are
   guarded on selection here and on navigation by the app-wide blocker. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SpecFile } from "@devdigest/shared";
import { Badge, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ConfirmModal } from "@/components/confirm-modal";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useActiveRepo, useRepoNotFound } from "@/providers/repo-context";
import {
  useContextFile,
  useContextFiles,
  useCreateContextFile,
  useUploadContextFile,
} from "@/lib/hooks/project-context";
import { DocPane, type DocMode } from "./_components/DocPane";
import { NameDialog } from "./_components/NameDialog";
import { SpecsToolbar } from "./_components/SpecsToolbar";
import { bytesToBase64, crumbFor, isPastCap } from "./helpers";
import { useSpecDraft } from "./useSpecDraft";
import { s } from "./styles";

interface PendingSelect {
  path: string;
  mode: DocMode;
  pin: SpecFile | null;
}

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const repoNotFound = useRepoNotFound(repoId);
  const { repos } = useActiveRepo();
  const list = useContextFiles(repoId);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<DocMode>("preview");
  const [pinned, setPinned] = React.useState<SpecFile | null>(null);
  const [dialog, setDialog] = React.useState<"file" | "folder" | null>(null);
  const [pending, setPending] = React.useState<PendingSelect | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const doc = useContextFile(repoId, selected);
  const create = useCreateContextFile(repoId);
  const upload = useUploadContextFile(repoId);
  const draft = useSpecDraft({
    repoId,
    path: selected,
    doc: doc.data,
    refetchDoc: doc.refetch,
    onClear: () => {
      setSelected(null);
      void list.refetch();
    },
  });

  const repoName = repos.find((r) => r.id === repoId)?.full_name ?? repoId;
  const crumb = crumbFor(repoName, t("title"), selected);

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const files = list.data?.files ?? [];
  const total = list.data?.total ?? 0;
  const cloned = !!list.data?.cloned;
  const shownPin = pinned && isPastCap(pinned.path, files) ? pinned : null;
  const selectedFile = files.find((f) => f.path === selected) ?? (shownPin?.path === selected ? shownPin : undefined);
  const rows = [...(shownPin ? [{ file: shownPin, isPinned: true }] : []), ...files.map((file) => ({ file, isPinned: false }))];
  const writeError = (e: unknown, fallback: "create" | "upload") =>
    e instanceof ApiError && e.status === 422 ? t("writeError.invalid") : t(`writeError.${fallback}`);

  const doSelect = (next: PendingSelect) => {
    draft?.discard();
    setSelected(next.path);
    setMode(next.mode);
    setPinned((p) => next.pin ?? (p?.path === next.path ? p : null));
    setPending(null);
  };
  const requestSelect = (next: PendingSelect) => {
    if (next.path === selected) return;
    if (draft?.dirty) setPending(next);
    else doSelect(next);
  };
  const openDialog = (kind: "file" | "folder") => {
    create.reset();
    setDialog(kind);
  };
  const onCreate = (name: string) => {
    if (!dialog) return;
    create.mutate(
      { kind: dialog, name },
      {
        onSuccess: (saved) => {
          setDialog(null);
          requestSelect({ path: saved.path, mode: "edit", pin: saved });
        },
      },
    );
  };
  const onUpload = async (file: File) => {
    setUploadError(null);
    const content_base64 = bytesToBase64(await file.arrayBuffer());
    upload.mutate(
      { name: file.name, content_base64 },
      {
        onSuccess: (saved) => requestSelect({ path: saved.path, mode: "preview", pin: saved }),
        onError: (e) => setUploadError(writeError(e, "upload")),
      },
    );
  };

  let left: React.ReactNode;
  if (list.isError) {
    left = <ErrorState title={t("listError")} onRetry={() => void list.refetch()} />;
  } else if (list.isLoading || !list.data) {
    left = <Skeleton height={200} />;
  } else if (!list.data.cloned) {
    left = <EmptyState icon="Folder" title={t("notCloned.title")} body={t("notCloned.body")} />;
  } else if (files.length === 0) {
    left = (
      <EmptyState
        icon="FileText"
        title={t("emptyRoot.title")}
        body={t("emptyRoot.body")}
        cta={t("emptyRoot.cta")}
        onCta={() => openDialog("file")}
      />
    );
  } else {
    left = rows.map(({ file: f, isPinned }) => (
      <button
        key={f.path}
        type="button"
        style={s.item(f.path === selected)}
        onClick={() => requestSelect({ path: f.path, mode: "preview", pin: null })}
        aria-current={f.path === selected}
      >
        <span className="mono" style={s.itemPath}>
          {f.path}
        </span>
        {isPinned && <Badge color="var(--text-secondary)">{t("pinned")}</Badge>}
        {f.editable === false && <Badge color="var(--text-secondary)">{t("readOnly.label")}</Badge>}
        <Badge color="var(--text-secondary)" style={s.kind}>
          {t(`kind.${f.kind ?? "other"}`)}
        </Badge>
      </button>
    ));
  }

  let right: React.ReactNode;
  if (!selected) {
    right = <div style={s.prompt}>{t("selectPrompt")}</div>;
  } else if (doc.isError) {
    right = <ErrorState title={t("previewError")} onRetry={() => void doc.refetch()} />;
  } else if (doc.isLoading || !doc.data || !draft) {
    right = <Skeleton height={200} />;
  } else {
    right = (
      <DocPane
        path={selected}
        file={doc.data}
        usedBy={selectedFile?.used_by ?? 0}
        mode={mode}
        onModeChange={setMode}
        draft={draft}
      />
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.left}>
          <div style={s.leftHead}>
            <h1 style={s.h1}>{t("title")}</h1>
            <div className="mono" style={s.rootPath}>
              {t("rootPath")}
            </div>
          </div>
          <SpecsToolbar
            canWrite={cloned}
            onNewFile={() => openDialog("file")}
            onNewFolder={() => openDialog("folder")}
            onUpload={(file) => void onUpload(file)}
            onRefresh={() => void list.refetch()}
          />
          <div style={s.note}>{t("localNote")}</div>
          {uploadError && (
            <div role="alert" style={{ ...s.note, color: "var(--crit)" }}>
              {uploadError}
            </div>
          )}
          {total > files.length && <div style={s.note}>{t("showing", { shown: files.length, total })}</div>}
          <div style={s.list}>{left}</div>
          {cloned && <div style={s.count}>{t("fileCount", { count: total })}</div>}
        </div>
        <div style={s.right}>{right}</div>
      </div>
      {dialog && (
        <NameDialog
          kind={dialog}
          busy={create.isPending}
          error={create.isError ? writeError(create.error, "create") : null}
          onConfirm={onCreate}
          onCancel={() => setDialog(null)}
        />
      )}
      {pending && selected && (
        <ConfirmModal
          title={t("confirm.discardTitle")}
          body={t("confirm.discardBody", { path: selected })}
          confirmLabel={t("confirm.discard")}
          cancelLabel={t("confirm.cancel")}
          onCancel={() => setPending(null)}
          onConfirm={() => doSelect(pending)}
        />
      )}
    </AppShell>
  );
}
