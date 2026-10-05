/* OnboardingTourView — /repos/:repoId/tour. The stored five-section tour with
   an "On this page" list, Regenerate and Share link; generation, error, stale
   and empty states. Opening the page and toggling sections never call the
   model — only Generate / Regenerate / Retry do. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Onboarding, OnboardingPage, OnboardingSectionId } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useGenerateOnboarding, useOnboarding } from "@/lib/hooks/onboarding";
import { useRepoNotFound } from "@/providers/repo-context";
import { SECTIONS } from "./constants";
import { errorCopyKey, timeAgo, tourUrl } from "./helpers";
import { useActiveSection } from "./hooks/useActiveSection";
import { useCopyToClipboard } from "./hooks/useCopyToClipboard";
import { ArchitectureOverview } from "./_components/ArchitectureOverview/ArchitectureOverview";
import { CriticalPaths } from "./_components/CriticalPaths/CriticalPaths";
import { FirstTasks } from "./_components/FirstTasks/FirstTasks";
import { OnThisPage } from "./_components/OnThisPage/OnThisPage";
import { ReadingPath } from "./_components/ReadingPath/ReadingPath";
import { RunCommands } from "./_components/RunCommands/RunCommands";
import { TourSection } from "./_components/TourSection/TourSection";
import { s } from "./styles";

type Expanded = Record<OnboardingSectionId, boolean>;

const SECTION_IDS: readonly OnboardingSectionId[] = SECTIONS.map(({ id }) => id);

const allExpanded = (): Expanded =>
  Object.fromEntries(SECTIONS.map(({ id }) => [id, true])) as Expanded;

function SectionBody({
  id,
  tour,
  repo,
}: {
  id: OnboardingSectionId;
  tour: Onboarding;
  repo: OnboardingPage["repo"];
}) {
  const where = { fullName: repo.full_name, branch: repo.default_branch };
  switch (id) {
    case "architecture":
      return <ArchitectureOverview prose={tour.architecture.prose} diagram={tour.architecture.diagram} />;
    case "critical_paths":
      return <CriticalPaths files={tour.critical_paths} {...where} />;
    case "run_locally":
      return <RunCommands commands={tour.run_locally} />;
    case "reading_path":
      return <ReadingPath files={tour.reading_path} {...where} />;
    case "first_tasks":
      return <FirstTasks tasks={tour.first_tasks} {...where} />;
  }
}

export function OnboardingTourView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const repoNotFound = useRepoNotFound(repoId);
  const query = useOnboarding(repoId);
  const gen = useGenerateOnboarding(repoId);
  const copy = useCopyToClipboard();
  const [expanded, setExpanded] = React.useState<Expanded>(allExpanded);

  const page = query.data;
  const tour = page?.tour ?? null;
  const [active, pick] = useActiveSection(SECTION_IDS, !!tour);
  const busy = gen.isPending || !!page?.generating;

  const crumb = [...(page ? [{ label: page.repo.full_name }] : []), { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const toggle = (id: OnboardingSectionId) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const select = (id: OnboardingSectionId) => {
    setExpanded((e) => ({ ...e, [id]: true }));
    pick(id);
    document.getElementById(`tour-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const generate = () => gen.mutate();

  if (query.isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState title={t("loadError.title")} onRetry={() => void query.refetch()} />
      </AppShell>
    );
  }
  if (!page) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.center}>
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  let genError: React.ReactNode = null;
  if (gen.error) {
    const err = gen.error instanceof ApiError ? gen.error : null;
    const provider = (err?.details as { provider?: unknown } | undefined)?.provider;
    genError = (
      <ErrorState
        title={t(errorCopyKey(err?.code, err?.details), { provider: typeof provider === "string" ? provider : "" })}
        body={
          err?.code === "provider_key_missing" ? (
            <Link href="/settings/api-keys" style={s.errorLink}>
              {t("errors.apiKeysLink")}
            </Link>
          ) : undefined
        }
        onRetry={busy ? undefined : generate}
      />
    );
  }

  if (!tour) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.main}>
            {genError}
            <EmptyState
              icon="Workflow"
              title={t("empty.title")}
              body={t("empty.body")}
              cta={busy ? t("generating") : t("empty.cta")}
              onCta={busy ? undefined : generate}
              ctaLoading={busy}
            />
          </div>
        </div>
      </AppShell>
    );
  }

  const ago = timeAgo(tour.generated_at);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <OnThisPage active={active} onSelect={select} />
        <div style={s.main}>
          <div style={s.header}>
            <div style={s.headText}>
              <h1 style={s.h1}>
                {t.rich("heading", {
                  name: page.repo.name,
                  repo: (chunks) => (
                    <span className="mono" style={s.name}>
                      {chunks}
                    </span>
                  ),
                })}
              </h1>
              <div style={s.subtitle}>
                {t("subtitle", { count: tour.files_indexed, ago: t(`ago.${ago.unit}`, { count: ago.count }) })}
                {" · "}
                {t("aiGenerated", { provider: tour.provider, model: tour.model })}
              </div>
            </div>
            <div style={s.actions}>
              {page.stale && <span style={s.stale}>{t("stale")}</span>}
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={generate} disabled={busy}>
                {busy ? t("generating") : t("regenerate")}
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="Link"
                onClick={() => void copy(tourUrl(window.location.origin, repoId), "link")}
              >
                {t("shareLink")}
              </Button>
            </div>
          </div>
          {genError}
          {SECTIONS.map(({ id, icon }) => (
            <TourSection
              key={id}
              id={id}
              title={t(`sections.${id}`)}
              icon={icon}
              expanded={expanded[id]}
              onToggle={() => toggle(id)}
            >
              <SectionBody id={id} tour={tour} repo={page.repo} />
            </TourSection>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
