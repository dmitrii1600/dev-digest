/* PrBrief — the Overview tab's brief section: a banner (verdict from the latest
   review, summary + cost from the brief), the missing/trimmed-input list, and
   four bodies — empty, generating (skeleton), ready, error. Opening the tab
   never calls the model; only Generate / refresh / Retry do. The risk pills and
   the review-focus card are rendered by OverviewTab, next to Intent/Blast. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BriefMissingFact, PrBriefResponse, ReviewRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { VerdictBanner } from "@/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner";
import { missingFactKey } from "./missing-facts";
import {
  blockersOf,
  briefView,
  costLine,
  errorCopyKey,
  latestReviewOf,
  shortSha,
  type BriefMutation,
} from "./helpers";
import { s } from "./styles";

/** One skeleton card: a title bar, four text bars, a divider, two short bars. */
function SkeletonCard() {
  return (
    <div style={s.card}>
      <Skeleton height={14} width="40%" />
      {["92%", "86%", "74%", "60%"].map((w) => (
        <Skeleton key={w} height={10} width={w} />
      ))}
      <div style={s.divider} />
      <Skeleton height={10} width="80%" />
      <Skeleton height={10} width="64%" />
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div style={s.skeletonRow}>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

function MissingFacts({ facts }: { facts: BriefMissingFact[] }) {
  const t = useTranslations("brief");
  if (facts.length === 0) return null;
  return (
    <div>
      <p style={s.factsTitle}>{t("missingFacts.title")}</p>
      <ul style={s.facts}>
        {facts.map((f, i) => {
          const reasonKey = `missingFacts.blastReason.${f.detail}`;
          const reason = f.fact === "blast" && f.detail && t.has(reasonKey) ? t(reasonKey) : (f.detail ?? "");
          return <li key={i}>{t(missingFactKey(f.fact, f.status), { detail: f.detail ?? "", reason })}</li>;
        })}
      </ul>
    </div>
  );
}

function BriefError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations("brief");
  const err = error instanceof ApiError ? error : null;
  const provider = (err?.details as { provider?: unknown } | undefined)?.provider;
  return (
    <ErrorState
      title={t("error.title")}
      body={
        <>
          {t(`error.${errorCopyKey(err?.code, err?.details)}`, {
            provider: typeof provider === "string" ? provider : "",
          })}
          {err?.code === "provider_key_missing" && (
            <>
              {" "}
              <Link href="/settings/api-keys" style={s.errorLink}>
                {t("error.openSettings")}
              </Link>
            </>
          )}
        </>
      }
      onRetry={onRetry}
    />
  );
}

export function PrBrief({
  data,
  isLoading,
  mutation,
  reviews,
}: {
  data: PrBriefResponse | undefined;
  isLoading: boolean;
  mutation: BriefMutation;
  reviews: ReviewRecord[] | undefined;
}) {
  const t = useTranslations("brief");
  const view = briefView({ data, mutation });
  const brief = data?.brief ?? null;
  const review = latestReviewOf(reviews);

  // A 409 from this tab, then the server reporting `generating`: show only the skeleton.
  const { reset, isError } = mutation;
  const generating = !!data?.generating;
  React.useEffect(() => {
    if (generating && isError) reset();
  }, [generating, isError, reset]);

  const generate = () => mutation.mutate();
  const reviewProps = review
    ? {
        verdict: review.verdict,
        score: review.score,
        findingsCount: review.findings.length,
        blockers: blockersOf(review),
        agentName: null,
      }
    : { verdict: null, score: null };

  let body: React.ReactNode;
  if (isLoading && !data) {
    body = <BriefSkeleton />;
  } else if (view === "generating") {
    body = (
      <>
        <VerdictBanner
          {...reviewProps}
          summary={brief?.summary ?? null}
          info={t("tooltip")}
          loading
          actions={
            brief ? (
              <Button kind="ghost" size="sm" icon="RefreshCw" disabled aria-label={t("refresh")} title={t("refresh")} />
            ) : (
              <Button kind="primary" size="sm" icon="FileText" disabled>
                {t("generate")}
              </Button>
            )
          }
        />
        <BriefSkeleton />
      </>
    );
  } else {
    const error =
      view === "error" ? <BriefError error={mutation.error} onRetry={generate} /> : null;
    if (brief && data) {
      body = (
        <>
          {error}
          <VerdictBanner
            {...reviewProps}
            summary={brief.summary}
            info={t("tooltip")}
            actions={
              <>
                {data.stale && (
                  <span style={s.stale}>
                    {t("stale", { generated: shortSha(brief.head_sha), current: shortSha(data.head_sha) })}
                  </span>
                )}
                <Button
                  kind="ghost"
                  size="sm"
                  icon="RefreshCw"
                  aria-label={t("refresh")}
                  title={t("refresh")}
                  onClick={generate}
                />
              </>
            }
            footer={costLine(brief)}
          />
          <MissingFacts facts={brief.missing_facts} />
        </>
      );
    } else if (error) {
      body = error;
    } else {
      body = (
        <div style={s.empty}>
          <div style={s.emptyTile}>
            <Icon.FileText size={22} />
          </div>
          <div style={s.emptyTitle}>{t("empty.title")}</div>
          <p style={s.emptyBody}>{t("empty.body")}</p>
          <Button kind="primary" icon="FileText" onClick={generate}>
            {t("generate")}
          </Button>
        </div>
      );
    }
  }

  return (
    <section style={s.section}>
      <SectionLabel icon="FileText">{t("sectionTitle")}</SectionLabel>
      {body}
    </section>
  );
}
