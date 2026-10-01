/* ProjectContextView — /repos/:repoId/context. Read-only: the clone's Markdown
   files on the left (with Refresh), the selected document rendered on the
   right with the number of agents that use it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useRepoNotFound } from "@/providers/repo-context";
import { useContextFile, useContextFiles } from "@/lib/hooks/project-context";
import { s } from "./styles";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const repoNotFound = useRepoNotFound(repoId);
  const list = useContextFiles(repoId);
  const [selected, setSelected] = React.useState<string | null>(null);
  const doc = useContextFile(repoId, selected);

  const crumb = [{ label: t("crumbWorkspace") }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const files = list.data?.files ?? [];
  const total = list.data?.total ?? 0;
  const selectedFile = files.find((f) => f.path === selected);

  let left: React.ReactNode;
  if (list.isError) {
    left = <ErrorState title={t("listError")} onRetry={() => void list.refetch()} />;
  } else if (list.isLoading || !list.data) {
    left = <Skeleton height={200} />;
  } else if (!list.data.cloned) {
    left = <EmptyState icon="Folder" title={t("notCloned.title")} body={t("notCloned.body")} />;
  } else if (files.length === 0) {
    left = <EmptyState icon="FileText" title={t("noFiles.title")} body={t("noFiles.body")} />;
  } else {
    left = files.map((f) => (
      <button
        key={f.path}
        type="button"
        style={s.item(f.path === selected)}
        onClick={() => setSelected(f.path)}
        aria-current={f.path === selected}
      >
        <span className="mono" style={s.itemPath}>
          {f.path}
        </span>
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
  } else if (doc.isLoading || !doc.data) {
    right = <Skeleton height={200} />;
  } else {
    right = (
      <>
        <div style={s.rightHead}>
          <h2 className="mono" style={s.path}>
            {selected}
          </h2>
          <Badge color="var(--text-secondary)">{t("usedBy", { count: selectedFile?.used_by ?? 0 })}</Badge>
        </div>
        <Markdown>{doc.data.content}</Markdown>
      </>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.left}>
          <div style={s.leftHead}>
            <h1 style={s.h1}>{t("title")}</h1>
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => void list.refetch()}>
              {t("refresh")}
            </Button>
          </div>
          {total > files.length && <div style={s.note}>{t("showing", { shown: files.length, total })}</div>}
          <div style={s.list}>{left}</div>
          {list.data?.cloned && <div style={s.count}>{t("fileCount", { count: total })}</div>}
        </div>
        <div style={s.right}>{right}</div>
      </div>
    </AppShell>
  );
}
