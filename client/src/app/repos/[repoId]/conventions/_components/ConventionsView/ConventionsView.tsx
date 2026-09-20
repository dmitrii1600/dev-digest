/* ConventionsView — /repos/:repoId/conventions. Run Scan / ReScan, the
   candidate list with Accept / Reject / Edit, the selection bar, and the
   Create-skill modal. The extract call is synchronous, so "Scanning…" is the
   mutation's pending state and nothing polls. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/providers/repo-context";
import { ApiError } from "@/lib/api";
import {
  useConventions,
  useExtractConventions,
  useUpdateCandidate,
} from "@/lib/hooks/conventions";
import { CandidateCard } from "./_components/CandidateCard";
import { ConventionSkillModal } from "./_components/ConventionSkillModal";
import { acceptedOf, creatableOf, extractErrorKey, timeAgo } from "./helpers";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateCandidate(repoId);
  const [modalOpen, setModalOpen] = React.useState(false);

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const scan = data?.scan ?? null;
  const candidates = data?.candidates ?? [];
  const accepted = acceptedOf(candidates);
  const creatable = creatableOf(candidates);
  const scanning = extract.isPending;

  const runScan = () => extract.mutate();
  const deselectAll = () =>
    Promise.all(
      accepted.map((c) => update.mutateAsync({ id: c.id, patch: { status: "pending" } })),
    );

  const extractError = extract.error instanceof ApiError ? extract.error : null;
  const extractErrorCopy = extractError
    ? (() => {
        const key = extractErrorKey(extractError.code);
        return key ? t(key) : extractError.message;
      })()
    : null;

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {modalOpen && (
        <ConventionSkillModal
          repoId={repoId}
          repoName={repoName}
          candidateCount={creatable.length}
          onClose={() => setModalOpen(false)}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>
              {scan
                ? scan.status === "failed"
                  ? t("page.lastScanFailed", { error: scan.error ?? "" })
                  : t("page.detectedFrom", {
                      count: scan.sampled_files.length,
                      ago: timeAgo(scan.finished_at ?? scan.started_at),
                    })
                : t("page.subtitle")}
            </p>
          </div>
          {scan && (
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={scanning}
              disabled={scanning}
              onClick={runScan}
            >
              {scanning ? t("page.scanning") : t("page.rescan")}
            </Button>
          )}
        </div>

        {extractErrorCopy && (
          <div style={s.errorBox}>
            <ErrorState title={t("page.extractionFailed")} body={extractErrorCopy} onRetry={runScan} />
          </div>
        )}

        {isLoading && (
          <div style={s.list}>
            <Skeleton height={150} />
            <Skeleton height={150} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && !scan && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={scanning ? t("page.scanning") : t("page.empty.cta")}
            ctaLoading={scanning}
            onCta={runScan}
          />
        )}

        {!isLoading && !isError && scan && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.nothingFound.title")}
            body={t("page.nothingFound.body", { dropped: scan.dropped_ungrounded })}
          />
        )}

        {!isLoading && !isError && candidates.length > 0 && (
          <>
            <div style={s.bar}>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                disabled={accepted.length === 0 || update.isPending}
                onClick={deselectAll}
              >
                {t("bar.deselectAll")}
              </Button>
              <span style={s.barText}>
                {t("bar.acceptedCount", { accepted: accepted.length, total: candidates.length })}
              </span>
              {(data?.rejected_count ?? 0) > 0 && (
                <span style={s.barText}>{t("bar.hidden", { count: data!.rejected_count })}</span>
              )}
              <span style={s.barSpacer} />
              {creatable.length > 0 && (
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  disabled={update.isPending}
                  onClick={() => setModalOpen(true)}
                >
                  {t("bar.createSkill")}
                </Button>
              )}
            </div>
            <div style={scanning ? { ...s.list, ...s.dimmed } : s.list}>
              {candidates.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  busy={update.isPending}
                  onPatch={(patch) => update.mutate({ id: c.id, patch })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
