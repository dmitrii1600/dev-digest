/* BlastGroup — one changed symbol in the Blast Radius tree view: a collapsible
   header (symbol, declaring file, caller count) and, when open, its callers as
   file:line links plus the endpoint and cron chips those callers live in. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, MonoLink, Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/app/repos/[repoId]/pulls/[number]/github-urls";
import { s } from "./styles";

type ChipIcon = "Globe" | "Clock";

export function BlastGroup({
  group,
  declaredIn,
  open,
  onToggle,
  repoFullName,
  headSha,
}: {
  group: DownstreamImpact;
  /** Comma-joined list of files that declare this symbol; empty when unknown. */
  declaredIn: string;
  open: boolean;
  onToggle: () => void;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("blast");

  // Endpoints and crons are rendered by the same block but never merged.
  const chipRows: { key: string; icon: ChipIcon; label: string; items: string[] }[] = [
    { key: "endpoints", icon: "Globe", label: t("endpointsAria"), items: group.endpoints_affected },
    { key: "crons", icon: "Clock", label: t("cronsAria"), items: group.crons_affected },
  ];

  return (
    <div style={s.group}>
      <button
        type="button"
        aria-expanded={open}
        title={open ? t("collapse") : t("expand")}
        style={s.groupHeader}
        onClick={onToggle}
      >
        <div style={s.groupHeaderMain}>
          <span className="mono" style={s.symbolName}>
            {group.symbol}
          </span>
          {declaredIn && <span style={s.declaredIn}>{t("declaredIn", { file: declaredIn })}</span>}
          <span style={s.callerCount}>{t("callerCount", { count: group.callers.length })}</span>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(open)} />
      </button>

      {open && (
        <div style={s.groupBody}>
          <div style={s.callerList}>
            {group.callers.map((c) => (
              <div key={`${c.file}:${c.line}`} style={s.callerRow}>
                <MonoLink href={repoFullName ? githubBlobUrl(repoFullName, headSha, c.file, c.line) : undefined}>
                  {c.file}:{c.line}
                </MonoLink>
                <span style={s.callerName}>{c.name}</span>
              </div>
            ))}
          </div>
          {chipRows
            .filter((row) => row.items.length > 0)
            .map((row) => (
              <div key={row.key} role="group" aria-label={row.label} style={s.chipsRow}>
                {row.items.map((item) => (
                  <Badge key={item} icon={row.icon} mono>
                    {item}
                  </Badge>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
