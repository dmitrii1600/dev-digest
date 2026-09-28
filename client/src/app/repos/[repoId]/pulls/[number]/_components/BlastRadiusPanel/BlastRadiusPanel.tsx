/* BlastRadiusPanel — Overview-tab block for spec 09 (Blast Radius). Reads
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
import { SectionLabel, Badge, EmptyState, ErrorState, Skeleton, Button, Icon, type IconName } from "@devdigest/ui";
import { blastRadiusKey, usePrBlastRadius } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { blastStats, changedSymbolKind, declaringFiles, defaultExpandedIndexes, type BlastStats } from "./helpers";
import { BlastGraph } from "./_components/BlastGraph";
import { BlastGroup } from "./_components/BlastGroup";
import { PriorPrs } from "./_components/PriorPrs";
import { s } from "./styles";

type View = "tree" | "graph";
const VIEWS: View[] = ["tree", "graph"];

/** Icon per stats-row entry: `<>` for symbols, the corner-down-right glyph
    for callers (the same glyph the tree view's caller rows use), globe for
    endpoints, clock for crons/jobs. */
const STAT_ICON: Record<keyof BlastStats, IconName> = {
  symbols: "Code",
  callers: "CornerDownRight",
  endpoints: "Globe",
  crons: "Clock",
};

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
        <div style={s.card}>
          <Skeleton height={72} />
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <div style={s.card}>
          <ErrorState title={t("error")} onRetry={() => refetch()} />
        </div>
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

      <div style={s.card}>
        <div style={s.headerRow}>
          <div role="group" aria-label={t("statsAria")} style={s.statsRow}>
            {(["symbols", "callers", "endpoints", "crons"] as const).map((key) => {
              const StatIcon = Icon[STAT_ICON[key]];
              return (
                <span key={key} style={s.stat}>
                  <StatIcon size={13} style={s.statIcon} aria-hidden="true" />
                  <span style={s.statNum}>{stats[key]}</span> {t(`stat.${key}`)}
                </span>
              );
            })}
          </div>

          {!empty && (
            <div style={s.viewToggle}>
              {VIEWS.map((v) => (
                <button key={v} type="button" aria-pressed={view === v} style={s.toggleBtn(view === v)} onClick={() => setView(v)}>
                  {t(`view.${v}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        {degraded && reason && <div style={s.reasonText}>{t(`reason.${reason}`)}</div>}

        {empty ??
          (view === "graph" ? (
            <BlastGraph changedSymbols={data.changed_symbols} downstream={groups} />
          ) : (
            <div style={s.groupList}>
              {groups.map((group, idx) => (
                <BlastGroup
                  key={group.symbol}
                  group={group}
                  kind={changedSymbolKind(data, group.symbol)}
                  declaredIn={declaringFiles(data, group.symbol).join(", ")}
                  open={isOpen(group.symbol, idx)}
                  onToggle={() => toggle(group.symbol, idx)}
                  repoFullName={repoFullName}
                  headSha={headSha}
                />
              ))}
            </div>
          ))}

        <div style={s.divider} />
        <PriorPrs prId={prId} headSha={headSha} repoFullName={repoFullName} />
      </div>
    </section>
  );
}
