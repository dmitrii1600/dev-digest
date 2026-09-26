/* PriorPrs — "Prior PRs touching these files" (spec 09, P3-d): a collapsible
   row under the blast radius listing prior MERGED PRs (from GitHub) that
   touched the same files, each with its overlapping files and a plain,
   code-built note. Collapsed by default. No LLM. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, MonoLink, Skeleton } from "@devdigest/ui";
import { usePrHistory } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/app/repos/[repoId]/pulls/[number]/github-urls";
import { formatMergedDate } from "./helpers";
import { s } from "./styles";

export function PriorPrs({
  prId,
  headSha,
  repoFullName,
}: {
  prId: string;
  headSha: string;
  repoFullName: string | null;
}) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = usePrHistory(prId, headSha);
  const [open, setOpen] = React.useState(false);

  const history = data?.history ?? [];
  const count = history.length;

  return (
    <div style={s.wrap}>
      <button
        type="button"
        aria-expanded={open}
        title={open ? t("collapse") : t("expand")}
        style={s.header}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={s.headerLeft}>
          <Icon.ChevronDown size={16} style={s.chevron(open)} aria-hidden="true" />
          <Icon.History size={14} style={s.historyIcon} aria-hidden="true" />
          <span style={s.headerTitle}>{t("priorPrs.title")}</span>
        </span>
        <Badge>{count}</Badge>
      </button>

      {open && (
        <div style={s.body}>
          {isLoading ? (
            <Skeleton height={48} />
          ) : isError ? (
            <ErrorState title={t("priorPrs.error")} onRetry={() => refetch()} />
          ) : count === 0 ? (
            <div style={s.empty}>{t("priorPrs.empty")}</div>
          ) : (
            history.map((item, idx) => (
              <div key={item.pr_number} style={idx === 0 ? s.item : s.itemDivided}>
                <div style={s.itemHeader}>
                  <MonoLink
                    href={repoFullName ? githubPrUrl(repoFullName, item.pr_number) : undefined}
                  >
                    #{item.pr_number}
                  </MonoLink>
                  <span style={s.itemTitle}>{item.title}</span>
                  <span style={s.itemMeta}>
                    {item.author} · {formatMergedDate(item.merged_at)}
                  </span>
                </div>
                <div style={s.itemNote}>{item.notes}</div>
                {item.files_overlap.length > 0 && (
                  <div role="group" aria-label={t("priorPrs.overlap")} style={s.chipsRow}>
                    {item.files_overlap.map((file) => (
                      <Badge key={file} mono>
                        {file}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
