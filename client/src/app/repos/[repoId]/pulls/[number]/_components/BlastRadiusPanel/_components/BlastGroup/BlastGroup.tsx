/* BlastGroup — one changed symbol in the Blast Radius tree view: a compact,
   collapsible row (chevron, code icon, symbol name, caller count) on a
   subtle elevated background and, when open, its callers as file:line links
   drawn along a vertical guide line, plus the endpoint and cron chips those
   callers live in. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, MonoLink, Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/app/repos/[repoId]/pulls/[number]/github-urls";
import { s } from "./styles";

type ChipIcon = "Globe" | "Clock";

/** Symbol kinds that read naturally with a trailing `()` in the tree label. */
const CALLABLE_KINDS = new Set(["function", "method"]);

export function BlastGroup({
  group,
  kind,
  declaredIn,
  open,
  onToggle,
  repoFullName,
  headSha,
}: {
  group: DownstreamImpact;
  /** The changed symbol's `kind` (`function`, `interface`, …), looked up
      from `changed_symbols`. Appends `()` to the label for callable kinds. */
  kind?: string;
  /** Comma-joined list of files that declare this symbol; empty when
      unknown. Shown only as a `title` tooltip on the name, never as its own
      visible line. */
  declaredIn: string;
  open: boolean;
  onToggle: () => void;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const label = kind && CALLABLE_KINDS.has(kind) ? `${group.symbol}()` : group.symbol;

  // Endpoints and crons are rendered by the same block but never merged.
  // Accent colours mark endpoints, warn colours mark crons/jobs.
  const chipRows: { key: string; icon: ChipIcon; label: string; items: string[]; color: string; bg: string }[] = [
    {
      key: "endpoints",
      icon: "Globe",
      label: t("endpointsAria"),
      items: group.endpoints_affected,
      color: "var(--accent-text)",
      bg: "var(--accent-bg)",
    },
    {
      key: "crons",
      icon: "Clock",
      label: t("cronsAria"),
      items: group.crons_affected,
      color: "var(--warn)",
      bg: "var(--warn-bg)",
    },
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
        <span style={s.groupHeaderLeft}>
          <Icon.ChevronDown size={16} style={s.chevron(open)} aria-hidden="true" />
          <Icon.Code size={13} style={s.codeIcon} aria-hidden="true" />
          <span
            className="mono"
            style={s.symbolName}
            title={declaredIn ? t("declaredIn", { file: declaredIn }) : undefined}
          >
            {label}
          </span>
        </span>
        <span style={s.callerCount}>{t("callerCount", { count: group.callers.length })}</span>
      </button>

      {open && (
        <div style={s.groupBody}>
          <div style={s.callerList}>
            {group.callers.map((c) => (
              <div key={`${c.file}:${c.line}`} style={s.callerRow} title={c.name}>
                <Icon.CornerDownRight size={12} style={s.guideGlyph} aria-hidden="true" />
                <MonoLink href={repoFullName ? githubBlobUrl(repoFullName, headSha, c.file, c.line) : undefined}>
                  {c.file}:{c.line}
                </MonoLink>
              </div>
            ))}
          </div>
          {chipRows
            .filter((row) => row.items.length > 0)
            .map((row) => (
              <div key={row.key} role="group" aria-label={row.label} style={s.chipsRow}>
                {row.items.map((item) => (
                  <Badge key={item} icon={row.icon} mono color={row.color} bg={row.bg}>
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
