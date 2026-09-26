/* IntentCard — the Intent Layer (L03) card: the derived intent sentence,
   in-scope / out-of-scope lists, a confidence bar, and a sources row where an
   `unavailable` reference shows its ref and the real reason it wasn't
   retrieved (never hidden, never invented). Five states: loading / empty /
   derived / stale / error — all driven by `usePrIntent` + `useDeriveIntent`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, ProgressBar, SectionLabel, Skeleton } from "@devdigest/ui";
import type { IntentSource, IntentSourceKind } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { s } from "./styles";

const SOURCE_KIND_ORDER: IntentSourceKind[] = [
  "pr_title",
  "pr_body",
  "changed_files",
  "project_context",
  "plan_spec",
  "linked_issue",
];

function sortedSources(sources: IntentSource[]): IntentSource[] {
  return [...sources].sort(
    (a, b) => SOURCE_KIND_ORDER.indexOf(a.kind) - SOURCE_KIND_ORDER.indexOf(b.kind),
  );
}

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("intent");
  const { data, isLoading } = usePrIntent(prId);
  const deriveMutation = useDeriveIntent(prId ?? "_");
  const derived = data?.derived ?? null;

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">{t("card.title")}</SectionLabel>
        <div style={s.card}>
          <Skeleton height={16} width="70%" />
          <Skeleton height={12} width="40%" />
          <Skeleton height={8} width="100%" />
        </div>
      </section>
    );
  }

  if (!derived) {
    return (
      <section>
        <SectionLabel icon="Target">{t("card.title")}</SectionLabel>
        <div style={s.card}>
          <p style={s.emptyBody}>{t("card.empty.body")}</p>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={deriveMutation.isPending}
            disabled={!prId}
            onClick={() => deriveMutation.mutate()}
          >
            {t("card.empty.cta")}
          </Button>
        </div>
      </section>
    );
  }

  const pct = Math.round(derived.confidence * 100);
  const confidenceColor = pct >= 70 ? "var(--ok)" : pct >= 40 ? "var(--warn)" : "var(--text-muted)";
  const available = derived.sources.filter((src) => src.status === "available").length;

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={deriveMutation.isPending}
            onClick={() => deriveMutation.mutate()}
          >
            {t("card.rerun")}
          </Button>
        }
      >
        {t("card.title")}
      </SectionLabel>

      <div style={s.card}>
        {derived.stale && (
          <Badge color="var(--warn)" bg="var(--warn-bg, var(--bg-hover))" icon="Clock">
            {t("card.stale")}
          </Badge>
        )}
        {derived.error && (
          <Badge color="var(--crit)" bg="var(--crit-bg, var(--bg-hover))" icon="AlertTriangle">
            {t("card.error", { message: derived.error })}
          </Badge>
        )}

        <p style={s.intentText}>{derived.intent}</p>

        <div style={s.scopeGrid}>
          <div style={s.scopeCol}>
            <span style={{ ...s.scopeHeader, color: "var(--ok)" }}>
              <Icon.Check size={12} />
              {t("card.inScope")}
            </span>
            {derived.in_scope.length > 0 ? (
              <ul style={s.scopeList}>
                {derived.in_scope.map((item) => (
                  <li key={item} style={s.scopeItem}>
                    <span aria-hidden style={{ ...s.scopeBullet, color: "var(--ok)" }}>
                      &middot;
                    </span>
                    <span style={s.scopeItemText}>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span style={s.notStated}>{t("card.notStated")}</span>
            )}
          </div>
          <div style={s.scopeCol}>
            <span style={{ ...s.scopeHeader, color: "var(--text-muted)" }}>
              <Icon.X size={12} />
              {t("card.outOfScope")}
            </span>
            {derived.out_of_scope.length > 0 ? (
              <ul style={s.scopeList}>
                {derived.out_of_scope.map((item) => (
                  <li key={item} style={{ ...s.scopeItem, color: "var(--text-muted)" }}>
                    <span aria-hidden style={s.scopeBullet}>
                      &middot;
                    </span>
                    <span style={s.scopeItemText}>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span style={s.notStated}>{t("card.notStated")}</span>
            )}
          </div>
        </div>


        <div style={s.confidenceRow}>
          <span style={s.scopeLabel}>{t("card.confidence")}</span>
          <div style={s.confidenceBar}>
            <ProgressBar value={pct} color={confidenceColor} />
          </div>
          <span className="mono tnum" style={s.confidencePct}>
            {pct}%
          </span>
        </div>
        <span style={s.confidenceDetail}>
          {t("card.confidenceDetail", { available, total: derived.sources.length })}
        </span>

        <div style={s.sourcesRow}>
          {sortedSources(derived.sources).map((src, i) => (
            <Badge
              key={`${src.kind}-${src.ref}-${i}`}
              color={src.status === "unavailable" ? "var(--text-muted)" : "var(--text-secondary)"}
              icon={src.status === "unavailable" ? "AlertTriangle" : undefined}
            >
              {t(`card.sourceKind.${src.kind}`)}
              {src.status !== "available" ? ` · ${t(`card.status.${src.status}`)}` : ""}
              {src.status === "unavailable" && src.detail ? ` (${src.detail})` : ""}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
