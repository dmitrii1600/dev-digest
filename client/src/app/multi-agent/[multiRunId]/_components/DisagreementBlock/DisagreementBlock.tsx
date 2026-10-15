/* DisagreementBlock — "Where agents disagree": one row per location, one cell per
   selected agent (flagged / did not flag / no result). Grouping is done on the
   client by the pure rules in ../helpers. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, SEV, SectionLabel, Toggle } from "@devdigest/ui";
import type { FindingRecord, MultiReviewAgent } from "@devdigest/shared";
import { AgentAvatar } from "@/components/agent-avatar";
import { disagreementRows, groupFindings } from "../helpers";

const ellipsis: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const s = {
  block: { marginTop: 28 } satisfies React.CSSProperties,
  toggle: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, textTransform: "none" } satisfies React.CSSProperties,
  row: { border: "1px solid var(--border)", borderRadius: 10, marginBottom: 10, background: "var(--bg-surface)" } satisfies React.CSSProperties,
  rowHead: { display: "flex", gap: 10, alignItems: "baseline", padding: "10px 14px", minWidth: 0 } satisfies React.CSSProperties,
  loc: { fontSize: 12.5, color: "var(--text-muted)", flexShrink: 0 } satisfies React.CSSProperties,
  title: { fontSize: 13.5, fontWeight: 600, ...ellipsis } satisfies React.CSSProperties,
  cells: { display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(180px, 1fr)", borderTop: "1px solid var(--border)", overflowX: "auto" } satisfies React.CSSProperties,
  cell: { padding: "10px 14px", fontSize: 13, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies React.CSSProperties,
  who: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", ...ellipsis } satisfies React.CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies React.CSSProperties,
  finding: { all: "unset", cursor: "pointer", display: "block", fontSize: 13, ...ellipsis } satisfies React.CSSProperties,
};

function FlaggedFinding({ finding }: { finding: FindingRecord }) {
  const t = useTranslations("multiReview");
  const [open, setOpen] = React.useState(false);
  const sev = SEV[finding.severity];
  return (
    <div>
      <button type="button" aria-expanded={open} style={s.finding} onClick={() => setOpen((v) => !v)}>
        <span style={{ color: sev.c, fontWeight: 600 }}>{sev.label}</span> {finding.title}
      </button>
      {open && (
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          <div style={s.muted}>
            {t("results.disagree.lines", { start: finding.start_line, end: finding.end_line })}
          </div>
          <Markdown>{finding.rationale}</Markdown>
        </div>
      )}
    </div>
  );
}

export function DisagreementBlock({ agents }: { agents: MultiReviewAgent[] }) {
  const t = useTranslations("multiReview");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const rows = React.useMemo(() => disagreementRows(agents, groupFindings(agents)), [agents]);
  const shown = onlyConflicts ? rows.filter((r) => r.isConflict) : rows;

  return (
    <section style={s.block}>
      <SectionLabel
        right={
          <label style={s.toggle}>
            {t("results.disagree.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} />
          </label>
        }
      >
        {t("results.disagree.title")}
      </SectionLabel>
      {shown.map((row) => (
        <div key={`${row.header.file}:${row.header.line}:${row.header.title}`} style={s.row}>
          <div style={s.rowHead}>
            <span className="mono" style={s.loc}>
              {row.header.file}:{row.header.line}
            </span>
            <span style={s.title}>{row.header.title}</span>
          </div>
          <div style={s.cells}>
            {row.cells.map((cell, i) => (
              <div key={agents[i]!.run.run_id} style={s.cell}>
                <div style={s.who}>
                  <AgentAvatar name={agents[i]!.run.agent_name} size="sm" />
                  {agents[i]!.run.agent_name}
                </div>
                {cell.kind === "flagged" &&
                  cell.findings.map((f) => <FlaggedFinding key={f.id} finding={f} />)}
                {cell.kind === "didNotFlag" && <span style={s.muted}>{t("results.disagree.didNotFlag")}</span>}
                {cell.kind === "noResult" && <span style={s.muted}>{t("results.disagree.noResult")}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
