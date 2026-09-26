/* BlastRadiusPanel — Overview-tab block for spec 07 (Blast Radius). Reads
   GET /pulls/:id/blast-radius through usePrBlastRadius: which symbols a PR
   changes, who calls them (file:line), and the endpoints/crons those callers
   live in. No LLM, no re-indexing — a plain index read.

   Named BlastRadiusPanel rather than BlastRadius to avoid shadowing the
   `BlastRadius` contract type imported from @devdigest/shared, with
   FindingsPanel as precedent for the "<Domain>Panel" feature-folder name. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { SectionLabel, Badge, EmptyState, ErrorState, Skeleton, Button } from "@devdigest/ui";
import { blastRadiusKey, usePrBlastRadius } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { blastStats, declaringFiles, defaultExpandedIndexes } from "./helpers";
import { BlastGraph } from "./_components/BlastGraph";
import { BlastGroup } from "./_components/BlastGroup";
import { s } from "./styles";

type View = "tree" | "graph";
const VIEWS: View[] = ["tree", "graph"];

export function BlastRadiusPanel({
  prId,
  repoId,
  repoFullName,
  headSha,
}: {
  prId: string;
  /** Repo uuid — resyncing the index (P3-c) targets the repo, not the PR. */
  repoId: string;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = usePrBlastRadius(prId, headSha);
  const resync = useResyncRepoIntel(repoId);
  const [view, setView] = React.useState<View>("tree");
  // Per-symbol overrides on top of the P3-a auto-expand defaults. Keyed by
  // symbol name rather than index so a toggle survives a reorder.
  const [expandedOverride, setExpandedOverride] = React.useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <Skeleton height={72} />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <ErrorState title={t("error")} onRetry={() => refetch()} />
      </section>
    );
  }

  const degraded = data.degraded === true;
  const reason = data.reason ?? null;
  const stats = blastStats(data);
  const groups = data.downstream;
  const defaults = defaultExpandedIndexes(groups.length);
  const isOpen = (symbol: string, idx: number) => expandedOverride[symbol] ?? defaults[idx] ?? false;
  const toggle = (symbol: string, idx: number) =>
    setExpandedOverride((cur) => ({ ...cur, [symbol]: !(cur[symbol] ?? defaults[idx] ?? false) }));

  // A resync cannot fix a server-side flag, so the button only appears for
  // the reasons a re-index could plausibly resolve.
  const canResync = degraded && reason !== "flag_off";
  const handleResync = () =>
    resync.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: blastRadiusKey(prId) }) });

  const empty =
    stats.symbols === 0 ? (
      <EmptyState icon="Target" title={t("noSymbols")} />
    ) : groups.length === 0 ? (
      <EmptyState icon="CornerDownRight" title={t("noDownstream", { count: stats.symbols })} />
    ) : null;

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          degraded ? (
            <div style={s.degradedRow} aria-live="polite">
              <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
                {t("degraded.badge")}
              </Badge>
              {canResync && (
                <Button kind="secondary" size="sm" icon="RefreshCw" loading={resync.isPending} onClick={handleResync}>
                  {t("resync")}
                </Button>
              )}
              {resync.isSuccess && <span style={s.resyncNote}>{t("resyncStarted")}</span>}
            </div>
          ) : undefined
        }
      >
        {t("title")}
      </SectionLabel>

      <div role="group" aria-label={t("statsAria")} style={s.statsRow}>
        {(["symbols", "callers", "endpoints", "crons"] as const).map((key) => (
          <span key={key} style={s.stat}>
            <span style={s.statNum}>{stats[key]}</span> {t(`stat.${key}`)}
          </span>
        ))}
      </div>

      {degraded && reason && <div style={s.reasonText}>{t(`reason.${reason}`)}</div>}

      {empty ?? (
        <>
          <div style={s.viewToggle}>
            {VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} style={s.toggleBtn(view === v)} onClick={() => setView(v)}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>

          {view === "graph" ? (
            <BlastGraph downstream={groups} />
          ) : (
            <div style={s.groupList}>
              {groups.map((group, idx) => (
                <BlastGroup
                  key={group.symbol}
                  group={group}
                  declaredIn={declaringFiles(data, group.symbol).join(", ")}
                  open={isOpen(group.symbol, idx)}
                  onToggle={() => toggle(group.symbol, idx)}
                  repoFullName={repoFullName}
                  headSha={headSha}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
